import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  duplicateProjectCodeMessage,
  parseProjectImport,
  type ImportIssue,
  type ProjectImportRecord,
} from "../shared/project-import";
import { getSharedPool } from "./db";
import { hasSystemPermission } from "./iam-service";
import {
  insertProjectInTransaction,
  type ProjectUser,
} from "./project-service";
import { commitWorkflowMutation } from "./workflow-mutation-transaction";

type ImportRow = {
  rowNumber: number;
  record: ProjectImportRecord;
  projectId: string | null;
  error: string | null;
};
type Database = PoolConnection | ReturnType<typeof getSharedPool>;
const bad = (message: string) => new TRPCError({ code: "CONFLICT", message });
const occupiedMessage = "业务代号已存在，含已归档业务。";
const inactiveDomainMessage = "工作域不存在或已停用。";
function json<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}
async function permission(user: ProjectUser, connection?: PoolConnection) {
  if (!(await hasSystemPermission(user, "workflow:create", connection)))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "当前账号无权导入业务。",
    });
}
async function rowsFor(db: Database, batchId: string): Promise<ImportRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT rowNumber,recordJson,projectId,error FROM project_import_row WHERE batchId=? ORDER BY rowNumber",
    [batchId]
  );
  return rows.map(row => ({
    rowNumber: Number(row.rowNumber),
    record: json<ProjectImportRecord>(row.recordJson),
    projectId: row.projectId,
    error: row.error,
  }));
}
async function getBatch(
  db: Database,
  userId: number,
  batchId?: string,
  lock = false
) {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT id,revision,fileHash,issues FROM project_import_batch WHERE ownerUserId=?" +
      (batchId ? " AND id=?" : " ORDER BY updatedAt DESC,id DESC") +
      " LIMIT 1" +
      (lock ? " FOR UPDATE" : ""),
    batchId ? [userId, batchId] : [userId]
  );
  return rows[0];
}
async function view(db: Database, batch: RowDataPacket) {
  return {
    batchId: String(batch.id),
    revision: Number(batch.revision),
    issues: json<ImportIssue[]>(batch.issues),
    rows: await rowsFor(db, batch.id),
  };
}
export async function projectImportStatus(user: ProjectUser, batchId?: string) {
  return commitWorkflowMutation(user, async (db, actor) => {
    await permission(actor, db);
    const batch = await getBatch(db, actor.id, batchId);
    return batch ? view(db, batch) : null;
  });
}

export async function projectImportHistory(user: ProjectUser) {
  return commitWorkflowMutation(user, async (db, actor) => {
    await permission(actor, db);
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT id,updatedAt,revision FROM project_import_batch WHERE ownerUserId=? ORDER BY updatedAt DESC,id DESC LIMIT 50",
      [actor.id]
    );
    return rows.map(row => ({
      batchId: String(row.id),
      updatedAt: new Date(row.updatedAt).toISOString(),
      revision: Number(row.revision),
    }));
  });
}

function sameRecord(a: ProjectImportRecord, b: ProjectImportRecord) {
  return (
    a.code === b.code &&
    a.name === b.name &&
    a.domainCode === b.domainCode &&
    a.description === b.description
  );
}
export async function previewProjectImport(
  user: ProjectUser,
  input: { batchId: string; expectedRevision: number; csv: string }
) {
  await permission(user);
  const parsed = parseProjectImport(input.csv);
  const hash = createHash("sha256").update(input.csv).digest("hex");
  return commitWorkflowMutation(user, async (db, actor) => {
    await permission(actor, db);
    const previous = await getBatch(db, actor.id, input.batchId, true);
    const references = parsed.rowReferences;
    if (references && (!previous || !input.expectedRevision))
      throw bad("请在原批次中上传修正文件。");
    if (references?.some(ref => ref.revision !== String(input.expectedRevision)))
      throw bad("文件修订与当前批次不一致，请重新下载待修正行。");
    if (previous?.fileHash === hash && !input.expectedRevision)
      return view(db, previous);
    if (Number(previous?.revision ?? 0) !== input.expectedRevision) {
      if (previous?.fileHash === hash && (!references || Number(previous.revision) === input.expectedRevision + 1))
        return view(db, previous);
      throw bad("批次已更新，请重新读取后修改。");
    }
    const priorRows = previous ? await rowsFor(db, previous.id) : [];
    let { records, issues } = parsed;
    const replacements = new Map<number, ProjectImportRecord>();
    if (references) {
      const byKey = new Map(priorRows.map(row => [input.batchId + "/" + row.rowNumber, row]));
      for (const [index, ref] of Array.from(references.entries())) {
        const row = byKey.get(ref.key);
        if (!row) throw bad("修正文件中有不属于本批次的行标识。");
        if (row.projectId) throw bad("第 " + row.record.line + " 行已经创建，不能修改。");
        if (replacements.has(row.rowNumber)) throw bad("第 " + row.record.line + " 行的标识重复。");
        replacements.set(row.rowNumber, { ...records[index], line: row.record.line });
      }
      if (issues.length) {
        const issue = issues[0];
        const index = records.findIndex(row => row.line === issue.line);
        const sourceLine = index < 0 ? issue.line : byKey.get(references[index].key)?.record.line ?? issue.line;
        throw new TRPCError({ code: "BAD_REQUEST", message: "第 " + sourceLine + " 行 · " + issue.field + " · " + issue.message });
      }
      const touched = new Set(Array.from(replacements.values(), row => row.line));
      issues = json<ImportIssue[]>(previous!.issues).filter(issue => !touched.has(issue.line)
        && issue.message !== duplicateProjectCodeMessage && issue.message !== occupiedMessage && issue.message !== inactiveDomainMessage);
      records = priorRows.map(row => replacements.get(row.rowNumber) ?? row.record);
      const codes = new Map<string, number>();
      for (const row of records) {
        const earlier = codes.get(row.code);
        if (earlier !== undefined) {
          if (touched.has(row.line) || touched.has(earlier))
            throw bad("第 " + (touched.has(row.line) ? row.line : earlier) + " 行 · 业务代号 · " + duplicateProjectCodeMessage);
          issues.push({ line: row.line, field: "业务代号", message: duplicateProjectCodeMessage });
        }
        codes.set(row.code, row.line);
      }
    }
    const completed = new Map(
      priorRows
        .filter(r => r.projectId)
        .map(r => [r.rowNumber, r])
    );
    for (const [number, row] of Array.from(completed)) {
      if (!records[number - 1] || !sameRecord(row.record, records[number - 1]))
        throw bad("已创建的行不能删除、移动或修改，请保留这些行后上传纠正版。");
    }
    if (records.length) {
      const codes = records
        .map(r => r.code)
        .filter(c => /^[A-Z][A-Z0-9_-]{1,63}$/.test(c));
      const [existing] = codes.length
        ? await db.query<RowDataPacket[]>(
            "SELECT code FROM flow_project WHERE ownerUserId=? AND code IN (?)",
            [actor.id, codes]
          )
        : [[]];
      const used = new Set(existing.map(r => String(r.code).toUpperCase()));
      const domainCodes = Array.from(
        new Set(
          records
            .map(r => r.domainCode)
            .filter(code => code.length > 0 && code.length <= 64)
        )
      );
      const [domains] = domainCodes.length
        ? await db.query<RowDataPacket[]>(
            "SELECT code FROM work_domain WHERE status='active' AND code IN (?)",
            [domainCodes]
          )
        : [[]];
      const valid = new Set(domains.map(r => String(r.code).toUpperCase()));
      records.forEach((row, i) => {
        if (completed.has(i + 1)) return;
        if (used.has(row.code))
          issues.push({
            line: row.line,
            field: "业务代号",
            message: occupiedMessage,
          });
        if (row.domainCode && !valid.has(row.domainCode))
          issues.push({
            line: row.line,
            field: "工作域代号",
            message: inactiveDomainMessage,
          });
      });
    }
    const revision = input.expectedRevision + 1;
    if (previous) {
      await db.query(
        "UPDATE project_import_batch SET revision=?,fileHash=?,issues=?,updatedAt=NOW(3) WHERE id=?",
        [revision, hash, JSON.stringify(issues), input.batchId]
      );
      if (references) {
        for (const [rowNumber, row] of Array.from(replacements))
          await db.query("UPDATE project_import_row SET recordJson=?,error=NULL WHERE batchId=? AND rowNumber=? AND projectId IS NULL", [
            JSON.stringify(row), input.batchId, rowNumber,
          ]);
      } else {
        await db.query("DELETE FROM project_import_row WHERE batchId=? AND projectId IS NULL", [input.batchId]);
      }
    } else {
      await db.query(
        "INSERT INTO project_import_batch (id,ownerUserId,revision,fileHash,issues) VALUES (?,?,?,?,?)",
        [input.batchId, actor.id, revision, hash, JSON.stringify(issues)]
      );
    }
    const pending = records.flatMap((row, i) =>
      completed.has(i + 1) ? [] : [[input.batchId, i + 1, JSON.stringify(row)]]
    );
    if (!references && pending.length)
      await db.query(
        "INSERT INTO project_import_row (batchId,rowNumber,recordJson) VALUES ?",
        [pending]
      );
    return {
      batchId: input.batchId,
      revision,
      issues,
      rows: await rowsFor(db, input.batchId),
    };
  });
}

export async function commitProjectImport(
  user: ProjectUser,
  input: { batchId: string; expectedRevision: number }
) {
  for (let i = 0; i < 25; i++) {
    const advanced = await commitWorkflowMutation(user, async (db, actor) => {
      await permission(actor, db);
      if (process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED?.trim().toLowerCase() === "false")
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "业务批量导入已暂停执行。可继续查看批次，恢复后按原批次继续。",
        });
      const batch = await getBatch(db, actor.id, input.batchId, true);
      if (!batch || Number(batch.revision) !== input.expectedRevision)
        throw bad("批次不存在或已变化，请重新读取。");
      if (json<ImportIssue[]>(batch.issues).length)
        throw bad("请先纠正预检错误。");
      const [rows] = await db.query<RowDataPacket[]>(
        "SELECT rowNumber,recordJson,error FROM project_import_row WHERE batchId=? AND projectId IS NULL ORDER BY rowNumber LIMIT 1 FOR UPDATE",
        [input.batchId]
      );
      const row = rows[0];
      if (!row || row.error) return false;
      const record = json<ProjectImportRecord>(row.recordJson);
      await db.query("SAVEPOINT before_import_row");
      try {
        let domainId: string | null = null;
        if (record.domainCode) {
          const [domains] = await db.query<RowDataPacket[]>(
            "SELECT id FROM work_domain WHERE code=? AND status='active' FOR SHARE",
            [record.domainCode]
          );
          if (!domains[0]) throw bad("工作域已停用，请上传纠正版。");
          domainId = domains[0].id;
        }
        const projectId = await insertProjectInTransaction(db, actor, {
          ...record,
          domainId,
        });
        await db.query(
          "UPDATE project_import_row SET projectId=? WHERE batchId=? AND rowNumber=?",
          [projectId, input.batchId, row.rowNumber]
        );
      } catch (error) {
        const duplicate = (error as { code?: string }).code === "ER_DUP_ENTRY";
        if (
          !duplicate &&
          !(error instanceof TRPCError && error.code === "CONFLICT")
        )
          throw error;
        await db.query("ROLLBACK TO SAVEPOINT before_import_row");
        await db.query(
          "UPDATE project_import_row SET error=? WHERE batchId=? AND rowNumber=?",
          [
            duplicate
              ? "业务代号已被占用，请上传纠正版。"
              : (error as Error).message,
            input.batchId,
            row.rowNumber,
          ]
        );
        return false;
      }
      return true;
    });
    if (!advanced) break;
  }
  return projectImportStatus(user, input.batchId);
}
