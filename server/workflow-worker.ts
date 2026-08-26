import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  executePreparedWorkflowRun,
  markWorkflowRunFailed,
  reconcileDueWorkflowWaits,
  reconcileDueWorkflowTaskSchedules,
  reconcileWorkflowContinuations,
  submitWorkflowRun as persistWorkflowRun,
  type WorkflowCheckpoint,
} from "./workflow-engine";
import { notifyOwner } from "./_core/notification";
import { runDataflowJobOnce, runDataSourceTestJobOnce } from "./p2-service";

type WorkflowUser = { id: number; role: "user" | "admin" };
type JsonRecord = Record<string, unknown>;

type ClaimedJob = {
  id: string;
  runId: string;
  leaseToken: string;
  attempt: number;
  maxAttempts: number;
  checkpoint: WorkflowCheckpoint;
};

type ClaimedOutboxEvent = {
  id: string;
  eventType: string;
  attempt: number;
  maxAttempts: number;
  leaseToken: string;
  payload: JsonRecord;
};

const workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
const pollIntervalMs = Math.max(
  200,
  Number(process.env.WORKFLOW_WORKER_POLL_MS ?? 1000)
);
const leaseSeconds = Math.max(
  30,
  Number(process.env.WORKFLOW_WORKER_LEASE_SECONDS ?? 120)
);
let pool: mysql.Pool | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let processing = false;

const state = {
  workerId,
  started: false,
  processing: false,
  lastPollAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
  processedJobs: 0,
};

export type WorkflowWorkerFaultPoint = "after_execute_before_complete";

class WorkflowWorkerInjectedCrash extends Error {
  constructor(point: WorkflowWorkerFaultPoint) {
    super(`Injected workflow worker crash at ${point}`);
    this.name = "WorkflowWorkerInjectedCrash";
  }
}

export function injectWorkflowWorkerFault(point: WorkflowWorkerFaultPoint) {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.WORKFLOW_WORKER_FAULT_POINT === point
  )
    throw new WorkflowWorkerInjectedCrash(point);
}

function db() {
  if (!process.env.DATABASE_URL) throw new Error("数据库连接未配置。");
  return (pool ??= mysql.createPool(process.env.DATABASE_URL));
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function retryDelayMs(attempt: number) {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export function outboxRetryDelaySeconds(attempt: number) {
  return Math.min(3600, 5 * 2 ** Math.max(0, attempt - 1));
}

export function getWorkflowWorkerStatus() {
  return { ...state, processing };
}

async function claimNextJob(): Promise<ClaimedJob | null> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT j.id,j.runId,j.attempt,j.maxAttempts,j.checkpointJson
         FROM workflow_run_job j
         JOIN workflow_run r ON r.id=j.runId
        WHERE j.attempt < j.maxAttempts
          AND r.status IN ('queued','running','waiting')
          AND ((j.status='queued' AND j.availableAt<=NOW())
            OR (j.status='leased' AND j.leaseExpiresAt<NOW()))
        ORDER BY j.availableAt ASC,j.createdAt ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }
    const leaseToken = randomUUID().replaceAll("-", "").slice(0, 48);
    const [claimed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_run_job
          SET status='leased',attempt=attempt+1,leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND),workerId=?,lastErrorJson=NULL
        WHERE id=? AND ((status='queued' AND availableAt<=NOW()) OR (status='leased' AND leaseExpiresAt<NOW()))`,
      [leaseToken, leaseSeconds, workerId, row.id]
    );
    if (!claimed.affectedRows) {
      await connection.rollback();
      return null;
    }
    const [leasedRun] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_run
          SET status='running',startedAt=COALESCE(startedAt,NOW()),executionLockToken=?,executionLockExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND)
        WHERE id=? AND status IN ('queued','running','waiting')`,
      [leaseToken, leaseSeconds, row.runId]
    );
    if (!leasedRun.affectedRows) throw new Error("无法取得工作流运行租约。");
    await connection.commit();
    return {
      id: String(row.id),
      runId: String(row.runId),
      leaseToken,
      attempt: Number(row.attempt ?? 0) + 1,
      maxAttempts: Number(row.maxAttempts ?? 3),
      checkpoint: parseJson<WorkflowCheckpoint>(row.checkpointJson, {
        queue: [],
        context: {},
      }),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function claimNextOutboxEvent(): Promise<ClaimedOutboxEvent | null> {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id,eventType,attempt,maxAttempts,payloadJson
         FROM workflow_outbox_event
        WHERE attempt < maxAttempts
          AND ((status='queued' AND availableAt<=NOW())
            OR (status='leased' AND leaseExpiresAt<NOW()))
        ORDER BY availableAt ASC,createdAt ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }
    const leaseToken = randomUUID().replaceAll("-", "").slice(0, 48);
    const [claimed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_outbox_event
          SET status='leased',attempt=attempt+1,leaseToken=?,leaseExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND),lastErrorJson=NULL
        WHERE id=? AND ((status='queued' AND availableAt<=NOW()) OR (status='leased' AND leaseExpiresAt<NOW()))`,
      [leaseToken, leaseSeconds, row.id]
    );
    if (!claimed.affectedRows) {
      await connection.rollback();
      return null;
    }
    await connection.commit();
    return {
      id: String(row.id),
      eventType: String(row.eventType),
      attempt: Number(row.attempt ?? 0) + 1,
      maxAttempts: Number(row.maxAttempts ?? 8),
      leaseToken,
      payload: parseJson<JsonRecord>(row.payloadJson, {}),
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeOutboxEvent(event: ClaimedOutboxEvent) {
  const [completed] = await db().query<mysql.ResultSetHeader>(
    `UPDATE workflow_outbox_event
        SET status='delivered',leaseToken=NULL,leaseExpiresAt=NULL,deliveredAt=NOW()
      WHERE id=? AND status='leased' AND leaseToken=?`,
    [event.id, event.leaseToken]
  );
  if (!completed.affectedRows) throw new Error("Outbox 事件完成时租约已失效。");
}

async function failOutboxEvent(event: ClaimedOutboxEvent, error: unknown) {
  const details = {
    message: error instanceof Error ? error.message : String(error),
  };
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const retryable = event.attempt < event.maxAttempts;
    const delaySeconds = outboxRetryDelaySeconds(event.attempt);
    const [updated] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_outbox_event
          SET status=?,lastErrorJson=?,availableAt=IF(?='queued',DATE_ADD(NOW(),INTERVAL ? SECOND),availableAt),leaseToken=NULL,leaseExpiresAt=NULL
        WHERE id=? AND status='leased' AND leaseToken=?`,
      [
        retryable ? "queued" : "failed",
        JSON.stringify(details),
        retryable ? "queued" : "failed",
        delaySeconds,
        event.id,
        event.leaseToken,
      ]
    );
    if (!updated.affectedRows)
      throw new Error("Outbox 事件重试排队时租约已失效。");
    await connection.commit();
  } catch (releaseError) {
    await connection.rollback();
    throw releaseError;
  } finally {
    connection.release();
  }
}

async function dispatchWorkflowOutboxOnce() {
  const event = await claimNextOutboxEvent();
  if (!event) return false;
  try {
    if (event.eventType !== "workflow.run.failed.notification") {
      throw new Error(`不支持的 Outbox 事件类型：${event.eventType}`);
    }
    const title = String(event.payload.title ?? "").trim();
    const content = String(event.payload.content ?? "").trim();
    if (!title || !content) throw new Error("Outbox 通知事件缺少标题或内容。");
    if (!(await notifyOwner({ title, content })))
      throw new Error("通知服务未接受 Outbox 事件。");
    await completeOutboxEvent(event);
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    await failOutboxEvent(event, error);
  }
  return true;
}

async function renewLease(job: ClaimedJob) {
  const [renewed] = await db().query<mysql.ResultSetHeader>(
    `UPDATE workflow_run_job j JOIN workflow_run r ON r.id=j.runId
        SET j.leaseExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND),
            r.executionLockExpiresAt=DATE_ADD(NOW(),INTERVAL ? SECOND)
      WHERE j.id=? AND j.leaseToken=? AND j.status='leased' AND r.executionLockToken=?`,
    [leaseSeconds, leaseSeconds, job.id, job.leaseToken, job.leaseToken]
  );
  if (!renewed.affectedRows)
    throw new Error("无法续租工作流任务，当前执行已失去所有权。");
}

async function saveCheckpoint(job: ClaimedJob, checkpoint: WorkflowCheckpoint) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [ownedRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT j.id
         FROM workflow_run_job j
         JOIN workflow_run r ON r.id=j.runId
        WHERE j.id=? AND j.status='leased' AND j.leaseToken=?
          AND r.id=? AND r.status='running' AND r.executionLockToken=?
        FOR UPDATE`,
      [job.id, job.leaseToken, job.runId, job.leaseToken]
    );
    if (!ownedRows[0])
      throw new Error("工作流任务租约已失效，Checkpoint 未写入。");
    await connection.query(
      "UPDATE workflow_run_job SET checkpointJson=? WHERE id=? AND status='leased' AND leaseToken=?",
      [JSON.stringify(checkpoint), job.id, job.leaseToken]
    );
    await connection.query(
      "UPDATE workflow_run SET contextJson=? WHERE id=? AND executionLockToken=? AND status='running'",
      [JSON.stringify(checkpoint.context), job.runId, job.leaseToken]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeJob(job: ClaimedJob, result: unknown) {
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [completed] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE workflow_run_job
          SET status='completed',resultJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW()
        WHERE id=? AND status='leased' AND leaseToken=?`,
      [JSON.stringify(result), job.id, job.leaseToken]
    );
    if (!completed.affectedRows)
      throw new Error("工作流任务完成时租约已失效。");
    await connection.query(
      "UPDATE workflow_run SET executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=? AND executionLockToken=?",
      [job.runId, job.leaseToken]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Closes the narrow crash window where workflow_run reached a terminal state
 * but the owning durable job did not get its terminal update.
 */
export async function reconcileTerminalWorkflowJobs() {
  const [result] = await db().query<mysql.ResultSetHeader>(
    `UPDATE workflow_run_job j
       JOIN workflow_run r ON r.id=j.runId
        SET j.status=CASE
              WHEN r.status='success' THEN 'completed'
              WHEN r.status='failed' THEN 'failed'
              ELSE 'cancelled'
            END,
            j.resultJson=CASE WHEN r.status='success' THEN r.finalOutputJson ELSE j.resultJson END,
            j.lastErrorJson=CASE WHEN r.status='failed' THEN r.errorJson ELSE j.lastErrorJson END,
            j.leaseToken=NULL,
            j.leaseExpiresAt=NULL,
            j.finishedAt=COALESCE(j.finishedAt,NOW())
      WHERE j.status IN ('queued','leased')
        AND r.status IN ('success','failed','cancelled','terminated')`
  );
  return Number(result.affectedRows ?? 0);
}

async function handleJobFailure(job: ClaimedJob, error: unknown) {
  const details = {
    message: error instanceof Error ? error.message : String(error),
  };
  if (job.attempt < job.maxAttempts) {
    const delaySeconds = Math.max(
      1,
      Math.ceil(retryDelayMs(job.attempt) / 1000)
    );
    const connection = await db().getConnection();
    try {
      await connection.beginTransaction();
      const [released] = await connection.query<mysql.ResultSetHeader>(
        `UPDATE workflow_run_job
            SET status='queued',lastErrorJson=?,availableAt=DATE_ADD(NOW(),INTERVAL ? SECOND),leaseToken=NULL,leaseExpiresAt=NULL,workerId=NULL
          WHERE id=? AND status='leased' AND leaseToken=?`,
        [JSON.stringify(details), delaySeconds, job.id, job.leaseToken]
      );
      if (!released.affectedRows)
        throw new Error("工作流重试排队时租约已失效。");
      await connection.query(
        "UPDATE workflow_run SET status='queued',errorJson=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=? AND executionLockToken=?",
        [JSON.stringify(details), job.runId, job.leaseToken]
      );
      await connection.commit();
    } catch (releaseError) {
      await connection.rollback();
      throw releaseError;
    } finally {
      connection.release();
    }
    return;
  }

  await markWorkflowRunFailed(job.runId, error, job.leaseToken);
  await db().query(
    `UPDATE workflow_run_job
        SET status='failed',lastErrorJson=?,leaseToken=NULL,leaseExpiresAt=NULL,finishedAt=NOW()
      WHERE id=? AND status='leased' AND leaseToken=?`,
    [JSON.stringify(details), job.id, job.leaseToken]
  );
}

async function processJob(job: ClaimedJob) {
  const heartbeat = setInterval(
    () => {
      void renewLease(job).catch(error => {
        state.lastError =
          error instanceof Error ? error.message : String(error);
      });
    },
    Math.max(10_000, Math.floor((leaseSeconds * 1000) / 3))
  );
  heartbeat.unref?.();
  try {
    const result = await executePreparedWorkflowRun({
      runId: job.runId,
      leaseToken: job.leaseToken,
      checkpoint: job.checkpoint,
      onCheckpoint: checkpoint => saveCheckpoint(job, checkpoint),
    });
    injectWorkflowWorkerFault("after_execute_before_complete");
    await completeJob(job, result);
    state.lastSuccessAt = new Date().toISOString();
    state.processedJobs += 1;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    if (error instanceof WorkflowWorkerInjectedCrash) throw error;
    await handleJobFailure(job, error);
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runWorkflowWorkerOnce() {
  if (processing) return false;
  processing = true;
  state.processing = true;
  state.lastPollAt = new Date().toISOString();
  try {
    const outboxProcessed = await dispatchWorkflowOutboxOnce();
    const waitsTriggered = await reconcileDueWorkflowWaits();
    const taskSchedulesFired = await reconcileDueWorkflowTaskSchedules();
    await reconcileWorkflowContinuations();
    const terminalJobsReconciled = await reconcileTerminalWorkflowJobs();
    const dataflowProcessed = await runDataflowJobOnce();
    const dataSourceTestProcessed = await runDataSourceTestJobOnce();
    const job = await claimNextJob();
    if (!job)
      return (
        outboxProcessed ||
        waitsTriggered > 0 ||
        taskSchedulesFired > 0 ||
        dataflowProcessed ||
        dataSourceTestProcessed ||
        terminalJobsReconciled > 0
      );
    await processJob(job);
    return true;
  } finally {
    processing = false;
    state.processing = false;
  }
}

export async function drainWorkflowJobs(maxJobs = 100) {
  let processed = 0;
  while (processed < maxJobs && (await runWorkflowWorkerOnce())) processed += 1;
  return processed;
}

export function wakeWorkflowWorker() {
  if (process.env.WORKFLOW_WORKER_ENABLED === "false") return;
  queueMicrotask(
    () =>
      void runWorkflowWorkerOnce().catch(error => {
        state.lastError =
          error instanceof Error ? error.message : String(error);
      })
  );
}

export function startWorkflowWorker() {
  if (
    state.started ||
    process.env.WORKFLOW_WORKER_ENABLED === "false" ||
    !process.env.DATABASE_URL
  )
    return;
  state.started = true;
  timer = setInterval(() => wakeWorkflowWorker(), pollIntervalMs);
  timer.unref?.();
  wakeWorkflowWorker();
}

export async function stopWorkflowWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  state.started = false;
  await pool?.end();
  pool = undefined;
}

export async function submitWorkflowRun(input: {
  workflowId: string;
  triggeredBy: WorkflowUser;
  workflowInput?: JsonRecord;
  idempotencyKey?: string;
  requestId?: string;
}) {
  const submitted = await persistWorkflowRun(input);
  wakeWorkflowWorker();
  return submitted;
}
