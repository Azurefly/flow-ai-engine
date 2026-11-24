import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import type { User } from "../drizzle/schema";
import type {
  AssistantJobPayload,
  AssistantJobStatus,
} from "../shared/assistant-job";
import { getSharedPool } from "./db";
import { recordAuthorizationAudit } from "./iam-service";
import {
  appendAssistantChange,
  assertAssistantCanContinue,
  assistantDatabaseUsage,
  assistantOperationHash,
  assistantTransaction,
  readAssistantSessionInTransaction,
  verifyAssistantAdmin,
  type AssistantChange,
  type AssistantUser,
} from "./assistant-store";

const maxAttempts = 3;
// Session and lease rows serialize these DB-only transactions. Reads of empty
// queue ranges need no gap locks while unrelated sessions admit new jobs.
async function jobTransaction<T>(
  fn: (connection: PoolConnection) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await assistantTransaction(fn, true);
    } catch (error) {
      if (
        attempt >= 3 ||
        (error as { code?: string }).code !== "ER_LOCK_DEADLOCK"
      )
        throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * attempt));
    }
  }
}
const leaseSeconds = 30;
const busy = (message: string) => new TRPCError({ code: "CONFLICT", message });
const denied = () =>
  new TRPCError({ code: "FORBIDDEN", message: "当前账号或工具授权已变化。" });
const timestamp = (value: unknown) =>
  value == null ? null : new Date(Number(value)).toISOString();
const publicColumns = "id,sessionId,requestId,payloadHash,baseRevision,status,failureCode,attempts,actionName,actionKey,reviewNote,payloadJson->>'$._target' AS targetRef," +
  "UNIX_TIMESTAMP(createdAt)*1000 AS queuedMs,UNIX_TIMESTAMP(startedAt)*1000 AS startedMs," +
  "UNIX_TIMESTAMP(finishedAt)*1000 AS finishedMs,UNIX_TIMESTAMP(reviewedAt)*1000 AS reviewedMs";

function publicJob(row: RowDataPacket, legacy = false) {
  return {
    id: String(row.id),
    sessionId: String(row.sessionId),
    requestId: String(row.requestId),
    status: row.status as AssistantJobStatus,
    failureCode: (row.failureCode as string | null) ?? null,
    baseRevision: Number(row.baseRevision),
    attempts: Number(row.attempts ?? 0),
    legacy,
    actionName: (row.actionName as string | null) ?? null,
    actionKey: (row.actionKey as string | null) ?? null,
    targetRef: (row.targetRef as string | null) ?? null,
    reviewedAt: timestamp(row.reviewedMs),
    evidence: (row.reviewNote as string | null) ?? null,
    queuedAt: timestamp(row.queuedMs),
    startedAt: timestamp(row.startedMs),
    finishedAt: timestamp(row.finishedMs),
  };
}

async function actorFor(
  connection: PoolConnection,
  userId: number,
  epoch?: number
): Promise<User> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT id,openId,username,name,email,loginMethod,role,status,tokenVersion,createdAt,updatedAt,lastSignedIn,NULL AS passwordHash FROM users WHERE id=? AND status='active' FOR SHARE",
    [userId]
  );
  if (
    !rows[0] ||
    (epoch !== undefined && epoch !== Number(rows[0].tokenVersion))
  )
    throw denied();
  return rows[0] as User;
}

async function priorJob(
  connection: PoolConnection,
  sessionId: string,
  requestId: string,
  expectedHash?: string
) {
  const [jobs] = await connection.query<RowDataPacket[]>(
    "SELECT " + publicColumns + " FROM assistant_turn_job WHERE sessionId=? AND requestId=?",
    [sessionId, requestId]
  );
  let row = jobs[0];
  if (!row) {
    const [turns] = await connection.query<RowDataPacket[]>(
      "SELECT id,sessionId,requestId,payloadHash,revision-1 AS baseRevision,UNIX_TIMESTAMP(createdAt)*1000 AS queuedMs,UNIX_TIMESTAMP(createdAt)*1000 AS finishedMs,IF(taskJson->>'$.status'='failed','failed','completed') AS status FROM assistant_turn WHERE sessionId=? AND requestId=?",
      [sessionId, requestId]
    );
    row = turns[0];
  }
  if (!row) return null;
  if (expectedHash && row.payloadHash !== expectedHash)
    throw busy("同一请求的修订或内容发生了变化。");
  return publicJob(row, !jobs.length);
}

export async function enqueueAssistantJob(
  user: AssistantUser,
  sessionId: string,
  revision: number,
  requestId: string,
  payload: AssistantJobPayload
) {
  return jobTransaction(async connection => {
    const actor = await actorFor(connection, user.id, user.tokenVersion);
    const session = await readAssistantSessionInTransaction(
      actor,
      sessionId,
      connection,
      true,
      { size: 1 }
    );
    const hash = assistantOperationHash(revision, payload);
    const prior = await priorJob(connection, sessionId, requestId, hash);
    if (prior) return prior;
    assertAssistantCanContinue(session);
    if (process.env.ASSISTANT_JOB_INTAKE === "paused")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "助手正在完成已接收的请求，请稍后发送新消息。",
      });
    if (session.revision !== revision)
      throw busy("对话已在别处更新，请核对最新消息。");
    const [active] = await connection.query<RowDataPacket[]>(
      "SELECT status FROM assistant_turn_job WHERE sessionId=? AND status IN ('queued','running','needs_review') LIMIT 1",
      [sessionId]
    );
    if (active.length)
      throw busy(
        active[0].status === "needs_review"
          ? "先核对本次业务提交，再继续此会话。"
          : "此会话已有另一个回合在处理。"
      );
    const id = randomUUID();
    await connection.execute(
      "INSERT INTO assistant_turn_job (id,sessionId,requestId,payloadHash,payloadJson,baseRevision,actorTokenVersion) VALUES (?,?,?,?,?,?,?)",
      [
        id,
        sessionId,
        requestId,
        hash,
        JSON.stringify(payload),
        revision,
        actor.tokenVersion,
      ]
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT " + publicColumns + " FROM assistant_turn_job WHERE id=?",
      [id]
    );
    return publicJob(rows[0]);
  });
}

export async function getAssistantJob(
  user: AssistantUser,
  sessionId: string,
  requestId?: string
) {
  return jobTransaction(async connection => {
    const actor = await actorFor(connection, user.id, user.tokenVersion);
    await readAssistantSessionInTransaction(
      actor,
      sessionId,
      connection,
      false,
      { size: 1 }
    );
    if (requestId) return priorJob(connection, sessionId, requestId);
    const [jobs] = await connection.query<RowDataPacket[]>(
      "SELECT " + publicColumns + " FROM assistant_turn_job WHERE sessionId=? ORDER BY baseRevision DESC,createdAt DESC,id DESC LIMIT 1",
      [sessionId]
    );
    return jobs.length ? publicJob(jobs[0]) : null;
  });
}

export async function cancelAssistantJob(
  user: AssistantUser,
  sessionId: string,
  requestId: string
) {
  return jobTransaction(async connection => {
    const actor = await actorFor(connection, user.id, user.tokenVersion);
    await readAssistantSessionInTransaction(
      actor,
      sessionId,
      connection,
      true,
      { size: 1 }
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT status FROM assistant_turn_job WHERE sessionId=? AND requestId=? FOR UPDATE",
      [sessionId, requestId]
    );
    if (rows[0]?.status === "cancelled") return;
    if (rows[0]?.status !== "queued")
      throw busy("作业已领取或结束，无法取消排队。");
    await connection.execute(
      "UPDATE assistant_turn_job SET status='cancelled',finishedAt=NOW(3) WHERE sessionId=? AND requestId=?",
      [sessionId, requestId]
    );
  });
}

export type AssistantLease = {
  id: string;
  token: string;
  sessionId: string;
  owner: number;
  epoch: number;
  revision: number;
  requestId: string;
  attempts: number;
  hash: string;
  payload: AssistantJobPayload;
};

export async function claimAssistantJob(
  jobId?: string
): Promise<AssistantLease | null> {
  return jobTransaction(async connection => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM assistant_turn_job WHERE (status='queued' OR (status='running' AND leaseUntil<=NOW(3)))" +
        (jobId ? " AND id=?" : "") +
        " ORDER BY createdAt,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      jobId ? [jobId] : []
    );
    const row = rows[0];
    if (!row) return null;
    if (Number(row.attempts) >= maxAttempts) {
      await connection.execute(
        "UPDATE assistant_turn_job SET status=IF(dispatchedAt IS NULL,'failed','needs_review'),failureCode=IF(dispatchedAt IS NULL,'worker_interrupted','outcome_unknown'),finishedAt=NOW(3),leaseToken=NULL,leaseUntil=NULL WHERE id=?",
        [row.id]
      );
      return null;
    }
    const [owners] = await connection.query<RowDataPacket[]>(
      "SELECT ownerUserId FROM assistant_session WHERE id=?",
      [row.sessionId]
    );
    const token = randomUUID();
    await connection.execute(
      "UPDATE assistant_turn_job SET status='running',startedAt=COALESCE(startedAt,NOW(3)),leaseToken=?,leaseUntil=TIMESTAMPADD(SECOND,?,NOW(3)),attempts=attempts+1 WHERE id=?",
      [token, leaseSeconds, row.id]
    );
    return {
      id: row.id,
      token,
      sessionId: row.sessionId,
      owner: Number(owners[0].ownerUserId),
      epoch: Number(row.actorTokenVersion),
      revision: Number(row.baseRevision),
      requestId: row.requestId,
      attempts: Number(row.attempts) + 1,
      hash: row.payloadHash,
      payload:
        typeof row.payloadJson === "string"
          ? JSON.parse(row.payloadJson)
          : row.payloadJson,
    };
  });
}

export async function renewAssistantLease(lease: AssistantLease) {
  const [updated] = await getSharedPool().execute<ResultSetHeader>(
    "UPDATE assistant_turn_job SET leaseUntil=TIMESTAMPADD(SECOND,?,NOW(3)) WHERE id=? AND status='running' AND leaseToken=? AND leaseUntil>NOW(3)",
    [leaseSeconds, lease.id, lease.token]
  );
  return updated.affectedRows === 1;
}

export class LostAssistantLease extends Error {}

async function ownedSession(
  connection: PoolConnection,
  lease: AssistantLease,
  tool?: string
) {
  const actor = await actorFor(connection, lease.owner, lease.epoch);
  const session = await readAssistantSessionInTransaction(
    actor,
    lease.sessionId,
    connection,
    true,
    { size: 32 }
  );
  const [owned] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM assistant_turn_job WHERE id=? AND status='running' AND leaseToken=? AND leaseUntil>NOW(3) FOR UPDATE",
    [lease.id, lease.token]
  );
  if (!owned.length) throw new LostAssistantLease();
  assertAssistantCanContinue(session);
  if (session.revision !== lease.revision) throw busy("会话修订已变化。");
  if (tool && !session.config.tools.some(allowed => allowed === tool))
    throw denied();
  return { actor, session };
}

export function assistantJobContext(
  lease: AssistantLease,
  tool?: string,
  dispatch?: { key: string; action: string; target?: string }
) {
  return jobTransaction(async connection => {
    const context = await ownedSession(connection, lease, tool);
    if (dispatch)
      await connection.execute(
        "UPDATE assistant_turn_job SET dispatchedAt=COALESCE(dispatchedAt,NOW(3)),actionKey=?,actionName=?,payloadJson=JSON_SET(payloadJson,'$._target',?) WHERE id=?",
        [dispatch.key, dispatch.action, dispatch.target ?? "工作台", lease.id]
      );
    return context;
  });
}

export async function finishAssistantJob(
  lease: AssistantLease,
  change: AssistantChange,
  usedTools: ReadonlySet<string>
) {
  await jobTransaction(async connection => {
    const { session } = await ownedSession(connection, lease);
    if (
      Array.from(usedTools).some(
        tool => !session.config.tools.some(current => current === tool)
      )
    )
      throw denied();
    await appendAssistantChange(
      connection,
      session,
      lease.requestId,
      lease.hash,
      change
    );
    const code =
      typeof change.task?.failureCode === "string"
        ? change.task.failureCode
        : null;
    const status =
      code === "outcome_unknown"
        ? "needs_review"
        : change.task?.status === "failed"
          ? "failed"
          : "completed";
    await connection.execute(
      "UPDATE assistant_turn_job SET status=?,failureCode=?,finishedAt=NOW(3),leaseToken=NULL,leaseUntil=NULL,payloadJson=JSON_REMOVE(payloadJson,'$.text','$.timeZone','$.proposalId','$.approve','$.kind','$.focus') WHERE id=?",
      [status, code, lease.id]
    );
  });
}

export async function failAssistantJob(lease: AssistantLease, error: unknown) {
  if (error instanceof LostAssistantLease) return;
  const reason = error instanceof TRPCError ? error.code : null;
  const permanent =
    reason === "FORBIDDEN" ||
    reason === "NOT_FOUND" ||
    reason === "UNAUTHORIZED" ||
    reason === "CONFLICT";
  const code =
    reason === "CONFLICT"
      ? "revision_changed"
      : permanent
        ? "permission_changed"
        : "worker_interrupted";
  if (permanent || lease.attempts >= maxAttempts) {
    await getSharedPool().execute(
      "UPDATE assistant_turn_job SET status=IF(dispatchedAt IS NULL,'failed','needs_review'),failureCode=IF(dispatchedAt IS NULL,?,'outcome_unknown'),leaseToken=NULL,leaseUntil=NULL,finishedAt=NOW(3) WHERE id=? AND status='running' AND leaseToken=? AND leaseUntil>NOW(3)",
      [code, lease.id, lease.token]
    );
  } else {
    // Another worker can only take ownership after this token expires.
    await getSharedPool().execute(
      "UPDATE assistant_turn_job SET leaseUntil=TIMESTAMPADD(SECOND,1,NOW(3)) WHERE id=? AND status='running' AND leaseToken=? AND leaseUntil>NOW(3)",
      [lease.id, lease.token]
    );
  }
}

export async function assistantJobOperations(user: AssistantUser) {
  return jobTransaction(async connection => {
    await verifyAssistantAdmin(user, connection);
    const [counts] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(IF(status='queued',1,NULL)) AS queued,COUNT(IF(status='running' AND leaseUntil>NOW(3),1,NULL)) AS leased,COUNT(IF(status='running' AND leaseUntil<=NOW(3),1,NULL)) AS expired,COUNT(IF(status='needs_review',1,NULL)) AS needsReview,COALESCE(MAX(IF(status='queued',TIMESTAMPDIFF(SECOND,createdAt,NOW(3)),0)),0) AS oldestQueuedSeconds FROM assistant_turn_job"
    );
    const [samples] = await connection.query<RowDataPacket[]>(
      "SELECT status,attempts,TIMESTAMPDIFF(MICROSECOND,createdAt,finishedAt)/1000 AS durationMs,TIMESTAMPDIFF(MICROSECOND,createdAt,startedAt)/1000 AS queueMs FROM assistant_turn_job WHERE finishedAt IS NOT NULL AND createdAt>=TIMESTAMPADD(DAY,-1,NOW(3)) ORDER BY finishedAt DESC,id DESC LIMIT 1000"
    );
    const [review] = await connection.query<RowDataPacket[]>(
      "SELECT " + publicColumns + " FROM assistant_turn_job WHERE status='needs_review' ORDER BY finishedAt,id LIMIT 50"
    );
    const times = samples
      .map(row => Number(row.durationMs))
      .sort((a, b) => a - b);
    const waits = samples
      .filter(row => row.queueMs != null)
      .map(row => Number(row.queueMs))
      .sort((a, b) => a - b);
    const percentile = (values: number[], p: number) =>
      values.length ? values[Math.ceil(values.length * p) - 1] : null;
    return {
      queued: Number(counts[0].queued),
      leased: Number(counts[0].leased),
      expired: Number(counts[0].expired),
      needsReview: Number(counts[0].needsReview),
      oldestQueuedSeconds: Number(counts[0].oldestQueuedSeconds),
      samples: times.length,
      failures: samples.filter(row =>
        ["failed", "needs_review"].includes(row.status)
      ).length,
      retries: samples.reduce(
        (total, row) => total + Math.max(0, Number(row.attempts) - 1),
        0
      ),
      p95Ms: percentile(times, 0.95),
      p99Ms: percentile(times, 0.99),
      p95QueueMs: percentile(waits, 0.95),
      connections: assistantDatabaseUsage(),
      review: review.map(row => publicJob(row)),
    };
  });
}

export async function reviewAssistantJob(
  user: AssistantUser,
  jobId: string,
  applied: boolean,
  evidence: string
) {
  const code = applied ? "manual_applied" : "manual_not_applied";
  return jobTransaction(async connection => {
    await verifyAssistantAdmin(user, connection);
    const [targets] = await connection.query<RowDataPacket[]>(
      "SELECT sessionId FROM assistant_turn_job WHERE id=?",
      [jobId]
    );
    if (!targets.length) throw busy("未找到待核对请求。");
    const [sessions] = await connection.query<RowDataPacket[]>(
      "SELECT revision FROM assistant_session WHERE id=? FOR UPDATE",
      [targets[0].sessionId]
    );
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM assistant_turn_job WHERE id=? FOR UPDATE",
      [jobId]
    );
    const row = rows[0];
    if (
      row?.failureCode === code &&
      row.reviewNote === evidence &&
      Number(row.reviewedBy) === user.id
    )
      return;
    if (row?.status !== "needs_review")
      throw busy("此请求已核对或尚未进入待核对状态。");
    const [prior] = await connection.query<RowDataPacket[]>(
      "SELECT 1 FROM assistant_turn WHERE sessionId=? AND requestId=?",
      [row.sessionId, row.requestId]
    );
    const revision = Number(sessions[0].revision) + 1;
    const reviewRequestId = prior.length ? "review-" + row.id : row.requestId;
    const hash = prior.length
      ? assistantOperationHash(revision - 1, { applied, evidence })
      : row.payloadHash;
    const task = JSON.stringify({
      status: applied ? "completed" : "failed",
      failureCode: code,
    });
    const messages = JSON.stringify([
      {
        role: "assistant",
        content:
          (applied ? "业务操作已核实生效。" : "业务操作已核实未生效。") +
          "核对记录 " +
          evidence,
        createdAt: new Date().toISOString(),
      },
    ]);
    await connection.execute(
      "INSERT INTO assistant_turn (id,sessionId,requestId,payloadHash,revision,messagesJson,taskJson) VALUES (?,?,?,?,?,?,?)",
      [
        randomUUID(),
        row.sessionId,
        reviewRequestId,
        hash,
        revision,
        messages,
        task,
      ]
    );
    await connection.execute(
      "UPDATE assistant_session SET taskJson=?,revision=?,updatedAt=NOW() WHERE id=?",
      [task, revision, row.sessionId]
    );
    await connection.execute(
      "UPDATE assistant_turn_job SET status=?,failureCode=?,reviewNote=?,reviewedBy=?,reviewedAt=NOW(3) WHERE id=?",
      [applied ? "completed" : "failed", code, evidence, user.id, jobId]
    );
    await recordAuthorizationAudit(
      {
        actorUserId: user.id,
        action: "user_updated",
        resourceType: "assistant_turn_job",
        resourceId: jobId,
        requestId: row.requestId,
        details: {
          operation: "receipt_reviewed",
          applied,
          evidence,
          actionKey: row.actionKey,
        },
      },
      connection
    );
  });
}
