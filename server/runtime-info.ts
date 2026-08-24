import mysql from "mysql2/promise";
import { ENV } from "./_core/env";
import { getWorkflowWorkerStatus } from "./workflow-worker";

export const DATABASE_MIGRATION_VERSION = "0014_tidy_bucky";

let pool: mysql.Pool | undefined;

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return (pool ??= mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2 }));
}

export function getCapabilityStatus() {
  const worker = getWorkflowWorkerStatus();
  return [
    {
      id: "state-control-workflow",
      label: "状态/控制流程",
      status: worker.started ? "beta" : "disabled",
      reason: worker.started ? "持久化 Worker 已启动，仍需完成故障注入验收。" : "持久化 Worker 未启动。",
    },
    {
      id: "human-approval",
      label: "人工审批与或签/会签",
      status: "beta",
      reason: "决定和票数语义已接入，真实 MySQL 并发验收尚未完成。",
    },
    {
      id: "llm-node",
      label: "LLM 节点",
      status: ENV.llmApiKey ? "beta" : "disabled",
      reason: ENV.llmApiKey ? "Provider 已配置，仍需真实模型 E2E。" : "OPENAI_API_KEY 未配置。",
    },
    {
      id: "dataflow",
      label: "数据流",
      status: "experimental",
      reason: "当前仅适合样例和受控试验，尚无生产 Connector/Checkpoint 验收。",
    },
  ] as const;
}

export function getRuntimeInfo() {
  return {
    gitSha: process.env.BUILD_SHA || process.env.GIT_SHA || "development",
    buildTime: process.env.BUILD_TIME || "unknown",
    imageDigest: process.env.IMAGE_DIGEST || "unknown",
    migrationVersion: DATABASE_MIGRATION_VERSION,
    nodeEnv: process.env.NODE_ENV || "development",
    worker: getWorkflowWorkerStatus(),
    capabilities: getCapabilityStatus(),
  };
}

export async function checkReadiness() {
  const checks = {
    database: { ok: false, message: "not checked" },
    migrations: { ok: false, message: "not checked" },
    worker: { ok: false, message: "not checked" },
    llm: { ok: true, message: "optional" },
  };
  try {
    await db().query("SELECT 1");
    checks.database = { ok: true, message: "connected" };
    const [columnRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count
         FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name='workflow_run_job'
          AND column_name IN ('idempotencyKey','checkpointJson','leaseToken','leaseExpiresAt','maxAttempts')`
    );
    const [indexRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count
         FROM information_schema.statistics
        WHERE table_schema=DATABASE() AND table_name='workflow_run_job'
          AND index_name='workflow_run_job_idempotency_unique' AND non_unique=0`
    );
    checks.migrations = Number(columnRows[0]?.count ?? 0) === 5 && Number(indexRows[0]?.count ?? 0) >= 1
      ? { ok: true, message: DATABASE_MIGRATION_VERSION }
      : { ok: false, message: "workflow_run_job migration is incomplete" };
  } catch (error) {
    checks.database = { ok: false, message: error instanceof Error ? error.message : String(error) };
    checks.migrations = { ok: false, message: "database check failed" };
  }
  const worker = getWorkflowWorkerStatus();
  checks.worker = worker.started
    ? { ok: true, message: worker.processing ? "processing" : "idle" }
    : { ok: false, message: "worker is not started" };
  if (process.env.LLM_REQUIRED === "true") {
    checks.llm = ENV.llmApiKey
      ? { ok: true, message: "configured" }
      : { ok: false, message: "OPENAI_API_KEY is required" };
  }
  return { ready: Object.values(checks).every(check => check.ok), checks, runtime: getRuntimeInfo() };
}
