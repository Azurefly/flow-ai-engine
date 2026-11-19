import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import {
  directoryKey,
  orderDirectoryRows,
  type DirectoryManifest,
  type DirectoryRecord,
} from "../shared/directory-import";
import { getSharedPool } from "./db";
import {
  ensureIamCatalog,
  hasSystemPermission,
  recordAuthorizationAudit,
} from "./iam-service";
import { hashPassword, validateInternalPassword } from "./internal-auth";
import { changeOrganization } from "./organization-write-service";
import { organizationUnitToken } from "./organization-configuration";

type Actor = { id: number; role: "admin" | "user"; tokenVersion: number };
type Connection = mysql.Pool | mysql.PoolConnection;
type Image = {
  id: string;
  status: string;
  name?: string;
  email?: string | null;
  role?: string;
  accountVersion?: number;
  parentCode?: string | null;
  title?: string | null;
  primaryMember?: number;
  configurationToken?: string;
};
type Reference = { key: string; id: string | null };
type Entry = {
  record: DirectoryRecord;
  key: string;
  before: Image | null;
  after?: Image | null;
  refs: Reference[];
  action: "create" | "update" | "unchanged";
  state: "ready" | "blocked" | "applied" | "conflict" | "reverted";
  message?: string;
  requiresPassword: boolean;
};
const db = getSharedPool;
const conflict = (message: string): never => {
  throw new TRPCError({ code: "CONFLICT", message });
};
const denied = (): never => {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "当前账号没有这项内部目录权限。",
  });
};

export async function directoryAccess(actor: Actor) {
  const apply = await hasSystemPermission(actor, "iam:manage");
  return {
    apply,
    preview: apply || (await hasSystemPermission(actor, "directory:preview")),
  };
}
async function one(
  conn: Connection,
  query: string,
  params: Array<string | number>
) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(query, params);
  return rows[0];
}
async function snapshot(
  conn: Connection,
  key: string,
  lock = false
): Promise<Image | null> {
  const [kind, first, second] = key.split("/");
  const suffix = lock ? " FOR UPDATE" : "";
  let r;
  if (kind === "user") {
    r = await one(
      conn,
      "SELECT id,name,email,role,status,tokenVersion FROM users WHERE username=?" + suffix,
      [first]
    );
    return r
      ? {
          id: String(r.id),
          status: r.status,
          name: r.name,
          email: r.email,
          role: r.role,
          accountVersion: Number(r.tokenVersion),
        }
      : null;
  }
  if (kind === "unit") {
    r = await one(
      conn,
      "SELECT o.*,p.code AS parentCode FROM organization_unit o LEFT JOIN organization_unit p ON p.id=o.parentUnitId WHERE o.code=?" +
        suffix,
      [first]
    );
    return r
      ? {
          id: r.id,
          status: r.status,
          name: r.name,
          parentCode: r.parentCode,
          configurationToken: organizationUnitToken(r),
        }
      : null;
  }
  r = await one(
    conn,
    "SELECT m.id,m.title,m.isPrimary FROM organization_membership m JOIN users u ON m.userId=u.id JOIN organization_unit o ON m.unitId=o.id WHERE u.username=? AND o.code=?" +
      suffix,
    [first, second]
  );
  return r
    ? {
        id: r.id,
        status: "active",
        title: r.title,
        primaryMember: Number(r.isPrimary),
      }
    : null;
}
function references(row: DirectoryRecord) {
  if (row.kind === "membership")
    return ["user/" + row.username, "unit/" + row.unitCode];
  if (row.kind === "unit" && row.parentCode) return ["unit/" + row.parentCode];
  return [];
}
function unchanged(row: DirectoryRecord, old: Image) {
  if (row.kind === "user")
    return (
      old.name === row.name &&
      (row.email === undefined || row.email === old.email)
    );
  if (row.kind === "unit") return row.name === old.name;
  return row.title === undefined || (row.title || null) === old.title;
}
function same(left: Image | null | undefined, right: Image | null | undefined) {
  if (!left || !right) return left === right;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(
      ([key, value]) => right[key as keyof Image] === value
    )
  );
}
type Batch = {
  id: string;
  ownerUserId: number;
  filename: string;
  rows: Entry[];
};
async function load(
  conn: Connection,
  id: string,
  lock = false
): Promise<Batch> {
  const r = await one(
    conn,
    "SELECT id,ownerUserId,filename,rowsJson FROM directory_import_batch WHERE id=?" +
      (lock ? " FOR UPDATE" : ""),
    [id]
  );
  if (!r)
    throw new TRPCError({ code: "NOT_FOUND", message: "目录导入批次不存在。" });
  return {
    id: r.id,
    ownerUserId: Number(r.ownerUserId),
    filename: r.filename,
    rows: typeof r.rowsJson === "string" ? JSON.parse(r.rowsJson) : r.rowsJson,
  };
}
export async function previewDirectory(
  actor: Actor,
  filename: string,
  manifest: DirectoryManifest
) {
  if (!(await directoryAccess(actor)).preview) denied();
  await ensureIamCatalog();
  const { rows, issues } = orderDirectoryRows(manifest);
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const current = await one(
      conn,
      "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE",
      [actor.id]
    );
    if (
      !current ||
      current.status !== "active" ||
      Number(current.tokenVersion) !== actor.tokenVersion ||
      !(
        (await hasSystemPermission(actor, "iam:manage", conn)) ||
        (await hasSystemPermission(actor, "directory:preview", conn))
      )
    )
      denied();
    const batch: Batch = {
      id: randomUUID(),
      ownerUserId: actor.id,
      filename,
      rows: [],
    };
    const planned = new Map<string, Entry>();
    for (const record of rows) {
      const key = directoryKey(record);
      const before = await snapshot(conn, key);
      const action = !before
        ? "create"
        : unchanged(record, before)
          ? "unchanged"
          : "update";
      let problem = issues.get(key);
      if (before?.status === "disabled")
        problem = "对象已停用，请先在组织或账号管理中处理。";
      if (
        record.kind === "user" &&
        before?.role === "admin" &&
        action === "update"
      )
        problem = "管理员资料须在账号管理中单独处理。";
      if (
        record.kind === "unit" &&
        before &&
        record.parentCode &&
        before.parentCode !== record.parentCode
      )
        problem = "移动现有部门须在组织架构中审核其子树。";
      const refs: Reference[] = [];
      for (const dep of references(record)) {
        const ref = await snapshot(conn, dep);
        const anticipated = planned.get(dep);
        if (
          anticipated?.state === "blocked" ||
          (!ref && !anticipated) ||
          (ref && ref.status !== "active")
        )
          problem = "引用的账号或部门缺失、已停用或存在冲突。";
        refs.push({ key: dep, id: ref?.id ?? null });
      }
      const item: Entry = {
        record,
        key,
        before,
        refs,
        action,
        state: problem ? "blocked" : "ready",
        message: problem,
        requiresPassword: record.kind === "user" && !before,
      };
      planned.set(key, item);
      batch.rows.push(item);
    }
    await conn.query(
      "INSERT INTO directory_import_batch (id,ownerUserId,filename,rowsJson) VALUES (?,?,?,?)",
      [batch.id, actor.id, filename, JSON.stringify(batch.rows)]
    );
    await recordAuthorizationAudit(
      {
        actorUserId: actor.id,
        action: "user_updated",
        resourceType: "directory_import",
        resourceId: batch.id,
        details: { operation: "directory_preview", rows: rows.length },
      },
      conn
    );
    await conn.commit();
    return batch;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
export async function readDirectoryBatch(actor: Actor, id: string) {
  const access = await directoryAccess(actor);
  if (!access.preview) denied();
  const batch = await load(db(), id);
  if (!access.apply && actor.id !== batch.ownerUserId) denied();
  return batch;
}
export async function listDirectoryBatches(actor: Actor) {
  const access = await directoryAccess(actor);
  if (!access.preview) denied();
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,filename,ownerUserId,createdAt FROM directory_import_batch " +
      (access.apply ? "" : "WHERE ownerUserId=? ") +
      "ORDER BY createdAt DESC,id DESC LIMIT 50",
    access.apply ? [] : [actor.id]
  );
  return rows.map(r => ({
    id: String(r.id),
    filename: String(r.filename),
    ownerUserId: Number(r.ownerUserId),
    createdAt: new Date(r.createdAt),
  }));
}
async function resolveRefs(conn: Connection, item: Entry, batch: Batch) {
  const ids = new Map<string, string>();
  for (const ref of item.refs) {
    const prerequisite = batch.rows.find(r => r.key === ref.key);
    if (prerequisite?.state === "ready") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "请先应用同批前置行 " + ref.key + "，完成后可继续本行。",
      });
    }
    if (prerequisite && prerequisite.state !== "applied") return null;
    const expected = prerequisite ? prerequisite.after?.id : ref.id;
    const actual = await snapshot(conn, ref.key, true);
    if (
      !expected ||
      !actual ||
      actual.id !== expected ||
      actual.status !== "active" ||
      (prerequisite && !same(actual, prerequisite.after))
    )
      return null;
    ids.set(ref.key, actual.id);
  }
  return ids;
}
async function applyFields(
  conn: mysql.PoolConnection,
  actor: Actor,
  item: Entry,
  refs: Map<string, string>,
  passwordHash?: string
) {
  const r = item.record,
    exists = item.before;
  if (r.kind === "user") {
    if (exists)
      await conn.query("UPDATE users SET name=?,email=? WHERE id=?", [
        r.name,
        r.email === undefined ? exists.email : r.email,
        exists.id,
      ]);
    else {
      if (!passwordHash)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新增账号须在应用时单独输入初始口令。",
        });
      await conn.query(
        "INSERT INTO users(openId,username,name,email,passwordHash,role,status,loginMethod) VALUES (?,?,?,?,?,'user','active','internal')",
        [
          "internal:" + r.username,
          r.username,
          r.name,
          r.email ?? null,
          passwordHash,
        ]
      );
    }
  } else if (r.kind === "unit") {
    if (exists)
      await conn.query("UPDATE organization_unit SET name=? WHERE id=?", [
        r.name,
        exists.id,
      ]);
    else {
      const parent = r.parentCode ? refs.get("unit/" + r.parentCode) : null;
      const depth = parent
        ? Number(
            (
              await one(
                conn,
                "SELECT unitLevel FROM organization_unit WHERE id=?",
                [parent]
              )
            )?.unitLevel ?? 1
          ) + 1
        : 1;
      if (depth > 99) conflict("部门层级超过 99 层。");
      await conn.query(
        "INSERT INTO organization_unit(id,code,name,parentUnitId,unitLevel,createdByUserId) VALUES (?,?,?,?,?,?)",
        [randomUUID(), r.code, r.name, parent ?? null, depth, actor.id]
      );
    }
  } else if (exists) {
    await conn.query("UPDATE organization_membership SET title=? WHERE id=?", [
      r.title === undefined ? exists.title : r.title || null,
      exists.id,
    ]);
  } else {
    await conn.query(
      "INSERT INTO organization_membership(id,userId,unitId,title,isPrimary) VALUES (?,?,?,?,0)",
      [
        randomUUID(),
        refs.get("user/" + r.username),
        refs.get("unit/" + r.unitCode),
        r.title || null,
      ]
    );
  }
}
async function undoFields(
  conn: mysql.PoolConnection,
  item: Entry
): Promise<string | null> {
  const id = item.after!.id,
    old = item.before;
  if (item.record.kind === "user") {
    if (old)
      await conn.query("UPDATE users SET name=?,email=? WHERE id=?", [
        old.name,
        old.email,
        id,
      ]);
    else {
      const used = await one(
        conn,
        `SELECT EXISTS(SELECT 1 FROM auth_session WHERE userId=?) OR
          EXISTS(SELECT 1 FROM role_assignment WHERE userId=?) OR
          EXISTS(SELECT 1 FROM organization_membership WHERE userId=?) OR
          EXISTS(SELECT 1 FROM flow_project_member WHERE userId=?) OR
          EXISTS(SELECT 1 FROM organization_unit WHERE managerUserId=?) OR
          EXISTS(SELECT 1 FROM workflow_member WHERE userId=?) OR
          EXISTS(SELECT 1 FROM flow_project WHERE ownerUserId=?) OR
          EXISTS(SELECT 1 FROM workflow WHERE ownerUserId=?) OR
          EXISTS(SELECT 1 FROM workflow_task WHERE assignedUserId=? OR claimedByUserId=? OR completedByUserId=?
            OR JSON_CONTAINS(candidateUserIdsJson,CAST(? AS JSON))) AS used`,
        Array(12).fill(id)
      );
      if (Number(used?.used))
        return "新增账号已有登录、授权、业务任务或组织归属，请在账号管理中核对。";
      await conn.query(
        "UPDATE users SET status='disabled',tokenVersion=tokenVersion+1 WHERE id=?",
        [id]
      );
    }
  } else if (item.record.kind === "unit") {
    if (old)
      await conn.query("UPDATE organization_unit SET name=? WHERE id=?", [
        old.name,
        id,
      ]);
    else {
      const used = await one(
        conn,
        "SELECT EXISTS(SELECT 1 FROM organization_unit WHERE parentUnitId=? AND status='active') OR EXISTS(SELECT 1 FROM organization_membership WHERE unitId=?) OR EXISTS(SELECT 1 FROM organization_unit_role WHERE unitId=?) OR EXISTS(SELECT 1 FROM flow_project_unit WHERE unitId=?) AS used",
        Array(4).fill(id)
      );
      if (Number(used?.used)) return "新增部门仍有关联，请先回退相关行。";
      await conn.query(
        "UPDATE organization_unit SET status='disabled' WHERE id=?",
        [id]
      );
    }
  } else if (old)
    await conn.query("UPDATE organization_membership SET title=? WHERE id=?", [
      old.title,
      id,
    ]);
  else await conn.query("DELETE FROM organization_membership WHERE id=?", [id]);
  return null;
}
export async function changeDirectoryRow(
  actor: Actor,
  id: string,
  index: number,
  mode: "apply" | "revert",
  password?: string
) {
  if (!(await directoryAccess(actor)).apply) denied();
  let hash: string | undefined;
  if (mode === "apply" && password !== undefined) {
    try {
      validateInternalPassword(password);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: (error as Error).message,
      });
    }
    hash = await hashPassword(password);
  }
  return changeOrganization(actor, [], async ({ connection, recheck }) => {
    const batch = await load(connection, id, true);
    const item = batch.rows[index];
    if (!item)
      throw new TRPCError({ code: "BAD_REQUEST", message: "找不到该批次行。" });
    if (
      (mode === "apply" && item.state !== "ready") ||
      (mode === "revert" && item.state !== "applied")
    )
      return batch;
    const live = await snapshot(connection, item.key, true);
    const target = mode === "apply" ? item.before : item.after;
    let reason: string | null = same(live, target)
      ? null
      : "目录在预览或应用后发生变化，已保留人工修改。";
    await recheck();
    if (mode === "apply") {
      const refs = await resolveRefs(connection, item, batch);
      if (!refs)
        reason = "引用对象尚未按预览应用或已变化。请核对前置行并重新预览。";
      if (!reason && refs) {
        if (item.action !== "unchanged")
          await applyFields(connection, actor, item, refs, hash);
        item.after = await snapshot(connection, item.key, true);
        item.state = "applied";
      } else item.state = "conflict";
    } else {
      if (!reason && item.action !== "unchanged")
        reason = await undoFields(connection, item);
      if (!reason) item.state = "reverted";
    }
    if (reason) item.message = reason;
    else delete item.message;
    await connection.query(
      "UPDATE directory_import_batch SET rowsJson=?,updatedAt=CURRENT_TIMESTAMP(3) WHERE id=?",
      [JSON.stringify(batch.rows), id]
    );
    await recordAuthorizationAudit(
      {
        actorUserId: actor.id,
        action: "user_updated",
        resourceType: "directory_import",
        resourceId: id,
        details: {
          operation: "directory_" + mode,
          index,
          key: item.key,
          state: item.state,
          conflict: Boolean(reason),
        },
      },
      connection
    );
    return batch;
  });
}
