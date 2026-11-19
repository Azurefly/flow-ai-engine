import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import {
  getProjectAccess,
  type ProjectPermission,
  type ProjectUser,
} from "./project-service";
import { assertDataflowJobLease } from "./dataflow-job-lease";
import { canonicalResourcePayload } from "../shared/resource-creation";
import { resolveExternalSecret } from "./external-secret";
import { requestDataExchange } from "./workflow-engine";
import {
  byteLimit,
  connectorEnabled,
  decodeFile,
  hash,
  kinds,
  mapRows,
  parsePage,
  rowsHash,
  validateRowKeys,
  type Contract,
  type Kind,
  type Row,
  type VersionInput,
} from "./data-connector-contract";

type Reader = Pick<mysql.Pool, "query">;
type Version = {
  id: string;
  projectId: string;
  assetId: string;
  kind: Kind;
  contentHash: string;
  contract: Contract;
  fileBase64: string | null;
};
type Ownership = { id: string; leaseToken: string };
const db = getSharedPool;
const parse = <T>(v: T | string): T =>
  typeof v === "string" ? (JSON.parse(v) as T) : v;
const forbidden = () =>
  new TRPCError({ code: "FORBIDDEN", message: "当前账号没有此业务操作权限。" });
async function transaction<T>(
  work: (c: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const c = await db().getConnection();
  try {
    await c.beginTransaction();
    const result = await work(c);
    await c.commit();
    return result;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
async function authorize(
  c: mysql.PoolConnection,
  user: { id: number; tokenVersion?: number },
  projectId: string,
  permission: ProjectPermission,
  archived = false
) {
  const [[actor]] = await c.query<mysql.RowDataPacket[]>(
    "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR SHARE",
    [user.id]
  );
  if (
    !actor ||
    actor.status !== "active" ||
    (user.tokenVersion !== undefined &&
      Number(actor.tokenVersion) !== user.tokenVersion)
  )
    throw forbidden();
  const access = await getProjectAccess(
    { id: Number(actor.id), role: actor.role },
    projectId,
    { connection: c, lock: "shared", includeArchived: archived }
  );
  if (!access.permissions.has(permission)) throw forbidden();
  return access;
}
const endpointFields = "id,refCode,baseUrl,secretRef,authHeaderName,authScheme";
async function endpoint(
  reader: Reader,
  projectId: string,
  ref: string,
  lock = false
) {
  const [[entry]] = await reader.query<mysql.RowDataPacket[]>(
    "SELECT " +
      endpointFields +
      " FROM project_service_endpoint WHERE projectId=? AND refCode=? AND status='active'" +
      (lock ? " FOR SHARE" : ""),
    [projectId, ref]
  );
  if (!entry) throw Error("项目受管服务端点已停用或不存在。");
  return entry;
}
async function call(
  version: Version,
  method: "GET" | "POST",
  suffix = "",
  parameters: Record<string, string> = {},
  body?: string,
  key?: string
) {
  const entry = await endpoint(
    db(),
    version.projectId,
    version.contract.endpointRef!
  );
  if (entry.baseUrl !== version.contract.endpointBase)
    throw Error("项目服务端点地址已改变，请登记新版本。");
  const base = String(entry.baseUrl).replace(/\/?$/, "/");
  const url = new URL(version.contract.path! + suffix, base);
  if (
    url.origin !== new URL(base).origin ||
    !url.pathname.startsWith(new URL(base).pathname)
  )
    throw Error("版本路径超出项目服务端点。");
  for (const [name, value] of Object.entries(parameters))
    url.searchParams.set(name, value);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  if (entry.secretRef) {
    if (url.protocol !== "https:")
      throw Error("含凭据的受管端点必须使用 HTTPS。");
    const header = String(entry.authHeaderName || "Authorization");
    if (
      [
        "host",
        "content-length",
        "content-type",
        "idempotency-key",
        "transfer-encoding",
        "connection",
      ].includes(header.toLowerCase())
    )
      throw Error("端点认证头与数据交换协议冲突。");
    const secret = resolveExternalSecret(String(entry.secretRef));
    headers[header] = entry.authScheme
      ? String(entry.authScheme) + " " + secret
      : secret;
  }
  try {
    return await requestDataExchange(
      url.href,
      method,
      headers,
      version.contract.timeoutMs ?? 8000,
      body
    );
  } catch {
    throw Error(
      version.kind === "api_read"
        ? "API 分页请求未收到响应，请检查连通性、目标网络策略与超时设置。"
        : "数据交换请求未收到可确认的响应，请核对原操作回执。"
    );
  }
}
export async function registerConnectorVersion(
  user: ProjectUser,
  input: VersionInput
) {
  let content: ReturnType<typeof decodeFile> | undefined;
  if (input.kind === "file_read") content = decodeFile(input.base64);
  return transaction(async c => {
    await authorize(c, user, input.projectId, "project:workflow:edit");
    const [[asset]] = await c.query<mysql.RowDataPacket[]>(
      "SELECT a.id,a.sourceId,s.sourceType,s.status FROM data_asset a JOIN data_source s ON s.id=a.sourceId AND s.projectId=a.projectId WHERE a.id=? AND a.projectId=? AND a.status='active' FOR SHARE",
      [input.assetId, input.projectId]
    );
    if (
      !asset ||
      asset.status === "disabled" ||
      asset.sourceType !== (input.kind === "file_read" ? "file" : "api")
    )
      throw Error("请选择本业务已启用且类型匹配的数据资源。");
    if (!connectorEnabled(input.kind))
      throw Error("部署管理员已停用此连接器操作。");
    let contract: Contract;
    if (input.kind === "file_read")
      contract = { fileName: input.fileName, fields: content!.fields };
    else {
      const ep = await endpoint(c, input.projectId, input.endpointRef, true);
      const raw = new URL(String(ep.baseUrl));
      if (raw.search || raw.hash)
        throw Error("数据交换端点基础地址不能包含查询或片段。");
      if (ep.secretRef && raw.protocol !== "https:")
        throw Error("含凭据的受管端点必须使用 HTTPS。");
      contract = {
        endpointBase: String(ep.baseUrl),
        endpointRef: input.endpointRef,
        path: input.path,
        rowKey: input.rowKey,
      };
      if (input.kind === "api_read")
        Object.assign(contract, {
          datasetVersion: input.datasetVersion,
          maxPages: input.maxPages,
          maxRows: input.maxRows,
          maxBytes: input.maxBytes,
          timeoutMs: input.timeoutMs,
          mapping: input.mapping,
        });
    }
    const contentHash = hash(
      content?.bytes ?? canonicalResourcePayload(contract)
    );
    const versionId = hash(
      canonicalResourcePayload({
        projectId: input.projectId,
        assetId: input.assetId,
        sourceId: asset.sourceId,
        kind: input.kind,
        label: input.label,
        contract,
        contentHash,
      })
    );
    await c.query(
      "INSERT INTO data_connector_version (id,projectId,assetId,sourceId,kind,label,contractJson,contentHash,fileBase64,byteCount,createdBy) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=data_connector_version.id",
      [
        versionId,
        input.projectId,
        input.assetId,
        asset.sourceId,
        input.kind,
        input.label,
        JSON.stringify(contract),
        contentHash,
        input.kind === "file_read" ? input.base64 : null,
        content?.bytes.length ?? 0,
        user.id,
      ]
    );
    return { versionId, contentHash, byteCount: content?.bytes.length ?? 0 };
  });
}
export async function connectorVersionList(
  user: ProjectUser,
  projectId: string
) {
  return transaction(async c => {
    await authorize(c, user, projectId, "project:view", true);
    const [rows] = await c.query<mysql.RowDataPacket[]>(
      `SELECT v.id,v.assetId,v.kind,v.label,v.contentHash,v.byteCount,v.createdAt,a.name AS assetName,a.status AS assetStatus,s.status AS sourceStatus,s.id AS activeSource,e.id AS activeEndpoint
         FROM data_connector_version v JOIN data_asset a ON a.id=v.assetId
         LEFT JOIN data_source s ON s.id=a.sourceId AND s.id=v.sourceId AND s.projectId=v.projectId
         LEFT JOIN project_service_endpoint e ON e.projectId=v.projectId AND e.refCode=JSON_UNQUOTE(JSON_EXTRACT(v.contractJson,'$.endpointRef')) AND BINARY e.baseUrl=BINARY JSON_UNQUOTE(JSON_EXTRACT(v.contractJson,'$.endpointBase')) AND e.status='active'
         WHERE v.projectId=? ORDER BY v.createdAt DESC,v.id`,
      [projectId]
    );
    return {
      capabilities: Object.fromEntries(
        kinds.map(kind => [kind, connectorEnabled(kind)])
      ),
      items: rows.map(r => ({
        id: String(r.id),
        assetId: String(r.assetId),
        assetName: String(r.assetName),
        kind: r.kind as Kind,
        label: String(r.label),
        contentHash: String(r.contentHash),
        byteCount: Number(r.byteCount),
        enabled:
          r.assetStatus === "active" &&
          !!r.activeSource &&
          r.sourceStatus !== "disabled" &&
          (r.kind === "file_read" || !!r.activeEndpoint) &&
          connectorEnabled(r.kind),
      })),
    };
  });
}

export async function loadConnectorVersion(
  reader: Reader,
  projectId: string,
  versionId: string,
  assetId: string | undefined,
  expected: readonly Kind[],
  lock = false,
  withFile = false
): Promise<Version> {
  const [[row]] = await reader.query<mysql.RowDataPacket[]>(
    "SELECT v.id,v.projectId,v.assetId,v.kind,v.contractJson,v.contentHash," +
      (withFile ? "v.fileBase64" : "NULL AS fileBase64") +
      " FROM data_connector_version v JOIN data_asset a ON a.id=v.assetId AND a.sourceId=v.sourceId AND a.projectId=v.projectId AND a.status='active' JOIN data_source s ON s.id=v.sourceId AND s.projectId=v.projectId AND s.status<>'disabled' WHERE v.id=? AND v.projectId=?" +
      (lock ? " FOR SHARE" : ""),
    [versionId, projectId]
  );
  if (
    !row ||
    (assetId !== undefined && row.assetId !== assetId) ||
    !expected.includes(row.kind)
  )
    throw Error("所选版本与资源、操作或业务不匹配，或数据源已停用。");
  if (!connectorEnabled(row.kind))
    throw Error("部署管理员已停用此连接器操作。");
  const contract = parse<Contract>(row.contractJson);
  if (contract.endpointRef) {
    const ep = await endpoint(reader, projectId, contract.endpointRef, lock);
    if (ep.baseUrl !== contract.endpointBase)
      throw Error("服务端点地址已经变更，请登记新版本。");
  }
  return {
    id: String(row.id),
    projectId,
    assetId: String(row.assetId),
    kind: row.kind,
    contract,
    contentHash: String(row.contentHash),
    fileBase64: row.fileBase64 ?? null,
  };
}
async function workerGuard(
  c: mysql.PoolConnection,
  runId: string,
  ownership: Ownership,
  projectId: string
) {
  await assertDataflowJobLease(c, ownership);
  const [[run]] = await c.query<mysql.RowDataPacket[]>(
    "SELECT triggeredByUserId,admissionPermission FROM dataflow_run WHERE id=? AND projectId=? AND status='running' FOR SHARE",
    [runId, projectId]
  );
  if (!run) throw Error("数据流程已停止。");
  await authorize(
    c,
    { id: Number(run.triggeredByUserId) },
    projectId,
    run.admissionPermission === "project:workflow:edit"
      ? "project:workflow:edit"
      : "project:workflow:run"
  );
}
type ReadContext = {
  runId: string;
  nodeId: string;
  ownership: Ownership;
  projectId: string;
  assetId: string;
  versionId: string;
  columns: string[];
  limit: number;
};
export async function prepareExternalWrite(
  c: mysql.PoolConnection,
  projectId: string,
  runId: string,
  nodeId: string,
  versionId: string,
  rows: Row[]
) {
  const version = await loadConnectorVersion(
    c,
    projectId,
    versionId,
    undefined,
    ["receipt_write"],
    true
  );
  if (rows.length > 1000 || Buffer.byteLength(JSON.stringify(rows)) > byteLimit)
    throw Error("外部写入预览超过 1000 行或 512 KiB。");
  validateRowKeys(rows, version.contract.rowKey!);
  const payloadHash = rowsHash(rows);
  const operationKey = hash(
    canonicalResourcePayload({ runId, nodeId, versionId })
  );
  await c.query(
    "INSERT INTO data_connector_write (operationKey,projectId,runId,nodeId,versionId,payloadHash,rowsJson,rowCount,status) VALUES (?,?,?,?,?,?,?,?,'preview') ON DUPLICATE KEY UPDATE operationKey=data_connector_write.operationKey",
    [
      operationKey,
      projectId,
      runId,
      nodeId,
      versionId,
      payloadHash,
      JSON.stringify(rows),
      rows.length,
    ]
  );
  const [[saved]] = await c.query<mysql.RowDataPacket[]>(
    "SELECT payloadHash FROM data_connector_write WHERE operationKey=? FOR SHARE",
    [operationKey]
  );
  if (saved.payloadHash !== payloadHash)
    throw Error("当前输出与已保存预览不一致。");
  return { operationKey, payloadHash, rowCount: rows.length, versionId };
}
export async function listWriteReceipts(
  user: ProjectUser,
  projectId: string,
  runId: string
) {
  return transaction(async c => {
    const rights = await authorize(c, user, projectId, "project:view", true);
    const [records] = await c.query<mysql.RowDataPacket[]>(
      `SELECT w.operationKey,w.nodeId,w.versionId,w.payloadHash,w.rowsJson,w.rowCount,w.status,w.receipt,v.label,v.contractJson,r.status AS runStatus,r.executionSource,r.triggerType,r.admissionPermission, s.id AS activeSource,e.id AS activeEndpoint
       FROM data_connector_write w JOIN dataflow_run r ON r.id=w.runId AND r.projectId=w.projectId JOIN data_connector_version v ON v.id=w.versionId
       LEFT JOIN data_asset a ON a.id=v.assetId AND a.projectId=w.projectId AND a.status='active'
       LEFT JOIN data_source s ON s.id=v.sourceId AND s.projectId=w.projectId AND s.id=a.sourceId AND s.status<>'disabled'
       LEFT JOIN project_service_endpoint e ON e.projectId=w.projectId AND e.status='active' AND e.refCode=JSON_UNQUOTE(JSON_EXTRACT(v.contractJson,'$.endpointRef')) AND BINARY e.baseUrl=BINARY JSON_UNQUOTE(JSON_EXTRACT(v.contractJson,'$.endpointBase'))
       WHERE w.projectId=? AND w.runId=? ORDER BY w.nodeId`,
      [projectId, runId]
    );
    return records.map(r => ({
      operationKey: String(r.operationKey),
      nodeId: String(r.nodeId),
      versionId: String(r.versionId),
      label: String(r.label),
      destination:
        String(parse<Contract>(r.contractJson).endpointRef) +
        " / " +
        String(parse<Contract>(r.contractJson).path),
      sample: parse<Row[]>(r.rowsJson).slice(0, 3),
      payloadHash: String(r.payloadHash),
      rowCount: Number(r.rowCount),
      status: String(r.status),
      receipt: r.receipt ? String(r.receipt) : null,
      canConfirm:
        rights.permissions.has("project:manage") &&
        canApply(r) &&
        !!r.activeSource &&
        !!r.activeEndpoint &&
        ["pending", "preview"].includes(r.status) &&
        connectorEnabled("receipt_write"),
    }));
  });
}
function canApply(r: mysql.RowDataPacket) {
  return (
    r.runStatus === "success" &&
    r.executionSource === "published_plan" &&
    r.triggerType === "manual" &&
    r.admissionPermission === "project:workflow:run"
  );
}
export async function confirmExternalWrite(
  user: ProjectUser,
  input: { projectId: string; operationKey: string; payloadHash: string },
  cookie: string | undefined
) {
  const authorizeIntent = () =>
    transaction(async c => {
      await authorize(c, user, input.projectId, "project:manage");
      const [[r]] = await c.query<mysql.RowDataPacket[]>(
        "SELECT w.*,r.status AS runStatus,r.executionSource,r.triggerType,r.admissionPermission FROM data_connector_write w JOIN dataflow_run r ON r.id=w.runId AND r.projectId=w.projectId WHERE w.operationKey=? AND w.projectId=? FOR UPDATE",
        [input.operationKey, input.projectId]
      );
      if (!r || !canApply(r))
        throw Error(
          "仅能确认本业务成功结束的手动正式运行。草稿与调度产生的输出仅供预览。"
        );
      const [[active]] = await c.query<mysql.RowDataPacket[]>(
        "SELECT id FROM auth_session WHERE userId=? AND tokenHash=? AND revokedAt IS NULL AND expiresAt>NOW() FOR SHARE",
        [user.id, hash(cookie ?? "")]
      );
      if (!cookie || !active) throw forbidden();
      if (r.payloadHash !== input.payloadHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "回读预览摘要与本次确认不一致。",
        });
      if (r.status === "committed")
        return {
          done: true as const,
          status: "committed" as const,
          receipt: String(r.receipt),
        };
      if (String(r.status).startsWith("rejected_"))
        return {
          done: true as const,
          status: "rejected" as const,
          receipt: null,
        };
      const version = await loadConnectorVersion(
        c,
        input.projectId,
        r.versionId,
        undefined,
        ["receipt_write"],
        true
      );
      const rows = parse<Row[]>(r.rowsJson);
      if (rowsHash(rows) !== input.payloadHash)
        throw Error("预览数据的摘要不一致。");
      await c.query(
        "UPDATE data_connector_write SET status='pending',confirmedBy=COALESCE(confirmedBy,?) WHERE operationKey=?",
        [user.id, input.operationKey]
      );
      return { done: false as const, version, rows };
    });
  const data = await authorizeIntent();
  if (data.done) return { status: data.status, receipt: data.receipt };
  const suffix = "/" + input.operationKey;
  const request = () => call(data.version, "GET", suffix);
  const decodeReceipt = (response: { status: number; bytes: Uint8Array }) => {
    if (response.status < 200 || response.status >= 300)
      throw Error("目标尚未确认该操作。");
    const receipt = JSON.parse(new TextDecoder().decode(response.bytes));
    if (
      receipt.operationKey !== input.operationKey ||
      receipt.payloadHash !== input.payloadHash ||
      receipt.rowCount !== data.rows.length ||
      typeof receipt.receipt !== "string" ||
      !/^[A-Za-z0-9_.:/-]{1,160}$/.test(receipt.receipt)
    )
      throw Error("目标回执与已确认版本或内容不一致。");
    return receipt.receipt as string;
  };
  let receipt: string;
  try {
    let response = await request();
    if (response.status === 404) {
      // Recheck sessions, grants and the version after waiting for the target and before issuing a write.
      const current = await authorizeIntent();
      if (current.done)
        return { status: current.status, receipt: current.receipt };
      // The target contract requires authoritative receipt lookup and atomic operation-key deduplication.
      const payload = JSON.stringify({
        operationKey: input.operationKey,
        payloadHash: input.payloadHash,
        rows: data.rows,
      });
      try {
        response = await call(
          data.version,
          "POST",
          suffix,
          {},
          payload,
          input.operationKey
        );
        if ([400, 409, 413, 422].includes(response.status)) {
          const rejection = "rejected_" + response.status;
          const [update] = await db().query<mysql.ResultSetHeader>(
            "UPDATE data_connector_write SET status=? WHERE operationKey=? AND status='pending'",
            [rejection, input.operationKey]
          );
          if (update.affectedRows)
            return { status: "rejected" as const, receipt: null };
          const latest = await authorizeIntent();
          if (latest.done)
            return { status: latest.status, receipt: latest.receipt };
          return { status: "pending" as const, receipt: null };
        }
        receipt = decodeReceipt(response);
      } catch {
        receipt = decodeReceipt(await request());
      }
    } else receipt = decodeReceipt(response);
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    return { status: "pending" as const, receipt: null };
  }
  await db().query(
    "UPDATE data_connector_write SET status='committed',receipt=? WHERE operationKey=? AND payloadHash=? AND status='pending'",
    [receipt, input.operationKey, input.payloadHash]
  );
  return { status: "committed" as const, receipt };
}
export async function guardConnectorResult(
  c: mysql.PoolConnection,
  ctx: {
    runId: string;
    ownership: Ownership;
    projectId: string;
    versionId: string;
    assetId?: string;
  }
) {
  await workerGuard(c, ctx.runId, ctx.ownership, ctx.projectId);
  await loadConnectorVersion(
    c,
    ctx.projectId,
    ctx.versionId,
    ctx.assetId,
    ctx.assetId ? ["api_read", "file_read"] : ["receipt_write"],
    true
  );
}

export async function readVersionedAsset(ctx: ReadContext) {
  const prepare = (c: mysql.PoolConnection, withFile = false) =>
    loadConnectorVersion(
      c,
      ctx.projectId,
      ctx.versionId,
      ctx.assetId,
      ["api_read", "file_read"],
      true,
      withFile
    );
  const version = await transaction(async c => {
    await workerGuard(c, ctx.runId, ctx.ownership, ctx.projectId);
    return prepare(c, true);
  });
  const contract = version.contract;
  let sourceRows: Row[] = [],
    pageCount = 0,
    totalBytes = 0;
  if (version.kind === "file_read") {
    const file = decodeFile(version.fileBase64!);
    if (hash(file.bytes) !== version.contentHash)
      throw Error("文件对象摘要与固定版本不一致。");
    sourceRows = file.rows;
    totalBytes = file.bytes.length;
  } else {
    const [saved] = await db().query<mysql.RowDataPacket[]>(
      "SELECT pageNo,cursorIn,cursorOut,versionId,byteCount,rowsJson,digest FROM data_connector_page WHERE runId=? AND nodeId=? ORDER BY pageNo",
      [ctx.runId, ctx.nodeId]
    );
    const seen = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | null = null,
      complete = false;
    for (const s of saved) {
      const rows = parse<Row[]>(s.rowsJson);
      if (
        s.versionId !== version.id ||
        Number(s.pageNo) !== pageCount ||
        s.cursorIn !== cursor ||
        complete ||
        rowsHash(rows) !== s.digest
      )
        throw Error("分页检查点与固定版本不一致。");
      validateRowKeys(rows, contract.rowKey!, seen);
      sourceRows.push(...rows);
      totalBytes += Number(s.byteCount);
      cursor = s.cursorOut;
      complete = cursor === null;
      if (cursor) cursors.add(cursor);
      pageCount++;
    }
    while (!complete && sourceRows.length < ctx.limit) {
      if (pageCount >= contract.maxPages!)
        throw Error("API 分页超过版本页数限额。");
      await transaction(async c => {
        await workerGuard(c, ctx.runId, ctx.ownership, ctx.projectId);
        await prepare(c);
      });
      const params: Record<string, string> = {
        version: contract.datasetVersion!,
      };
      if (cursor) params.cursor = cursor;
      const response = await call(version, "GET", "", params);
      if (response.status !== 200)
        throw Error("API 分页读取返回 HTTP " + response.status + "。");
      if (totalBytes + response.bytes.length > contract.maxBytes!)
        throw Error("API 读取超过版本字节限额。");
      const page = parsePage(response.bytes, contract);
      if (sourceRows.length + page.rows.length > contract.maxRows!)
        throw Error("API 读取超过版本行数限额。");
      if (page.nextCursor && cursors.has(page.nextCursor))
        throw Error("API 返回重复游标。");
      validateRowKeys(page.rows, contract.rowKey!, seen);
      await transaction(async c => {
        await workerGuard(c, ctx.runId, ctx.ownership, ctx.projectId);
        await prepare(c);
        await c.query(
          "INSERT INTO data_connector_page (runId,nodeId,pageNo,versionId,cursorIn,cursorOut,rowsJson,byteCount,digest) VALUES (?,?,?,?,?,?,?,?,?)",
          [
            ctx.runId,
            ctx.nodeId,
            pageCount,
            version.id,
            cursor,
            page.nextCursor,
            JSON.stringify(page.rows),
            response.bytes.length,
            rowsHash(page.rows),
          ]
        );
      });
      sourceRows.push(...page.rows);
      pageCount++;
      totalBytes += response.bytes.length;
      cursor = page.nextCursor;
      complete = cursor === null;
      if (cursor) cursors.add(cursor);
    }
  }
  return {
    rows: mapRows(
      sourceRows.slice(0, ctx.limit),
      contract.mapping ?? {},
      ctx.columns
    ),
    resourceVersion: {
      id: version.id,
      kind: version.kind,
      contentHash: version.contentHash,
      datasetVersion: contract.datasetVersion ?? null,
      pageCount,
      byteCount: totalBytes,
    },
  };
}
