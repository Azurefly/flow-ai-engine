import mysql from "mysql2/promise";
import { ENV } from "./_core/env";
import { getWorkflowWorkerStatus } from "./workflow-worker";
import { getRuntimeModels } from "./workflow-engine";

export const DATABASE_MIGRATION_VERSION = "0027_dataflow_execution_plan";
export const DATABASE_MIGRATION_EPOCH = 1787662800000;

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
    const [migrationRows] = await db().query<mysql.RowDataPacket[]>(
      "SELECT MAX(created_at) AS latestMigrationAt FROM __drizzle_migrations"
    );
    const [tableRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT table_name) AS count
         FROM information_schema.tables
        WHERE table_schema=DATABASE()
          AND table_name IN ('workflow_run_job','workflow_task_group','workflow_outbox_event','workflow_state_transition','project_service_endpoint','workflow_wait_subscription','workflow_milestone','workflow_task_schedule')`
    );
    const [columnRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count
         FROM information_schema.columns
        WHERE table_schema=DATABASE() AND (
          (table_name='workflow' AND column_name IN ('archivedAt','publishedExecutionPlanJson','publishedExecutionPlanHash')) OR
          (table_name='workflow_run' AND column_name IN ('executionPlanJson','executionPlanHash','requestId','flowType','businessKey','currentStateCode','currentStateNodeId','stateVersion','endReason')) OR
          (table_name='workflow_task' AND column_name IN ('approvalOrder','requestId','operationCode','ownerVersion','outcomeHandlesJson')) OR
          (table_name='dataflow_run' AND column_name IN ('executionPlanJson','executionPlanHash','requestId')) OR
          (table_name='authorization_audit_log' AND column_name='requestId') OR
          (table_name='organization_unit_role' AND column_name IN ('includeDescendants','effectiveFrom','expiresAt'))
        )`
    );
    const [indexRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT CONCAT(table_name,':',index_name)) AS count
         FROM information_schema.statistics
        WHERE table_schema=DATABASE() AND non_unique=0 AND (
          (table_name='workflow_run_job' AND index_name='workflow_run_job_idempotency_unique') OR
          (table_name='workflow_outbox_event' AND index_name='workflow_outbox_dedupe_unique') OR
          (table_name='workflow_state_transition' AND index_name='workflow_state_transition_run_sequence_unique')
          OR (table_name='project_service_endpoint' AND index_name='project_service_endpoint_project_ref_unique')
          OR (table_name='workflow_wait_subscription' AND index_name='workflow_wait_subscription_run_node_unique')
          OR (table_name='workflow_milestone' AND index_name='workflow_milestone_run_node_unique')
          OR (table_name='workflow_task_schedule' AND index_name='workflow_task_schedule_task_event_recipient_unique')
        )`
    );
    const latestMigrationAt = Number(migrationRows[0]?.latestMigrationAt ?? 0);
    const complete =
      latestMigrationAt >= DATABASE_MIGRATION_EPOCH &&
      Number(tableRows[0]?.count ?? 0) === 8 &&
      Number(columnRows[0]?.count ?? 0) === 24 &&
      Number(indexRows[0]?.count ?? 0) === 7;
    checks.migrations = complete
      ? { ok: true, message: DATABASE_MIGRATION_VERSION }
      : {
          ok: false,
          message: `${DATABASE_MIGRATION_VERSION} migration is incomplete`,
        };
  } catch (error) {
    checks.database = { ok: false, message: error instanceof Error ? error.message : String(error) };
    checks.migrations = { ok: false, message: "database check failed" };
  }
  const worker = getWorkflowWorkerStatus();
  checks.worker = worker.started
    ? { ok: true, message: worker.processing ? "processing" : "idle" }
    : { ok: false, message: "worker is not started" };
  if (process.env.LLM_REQUIRED === "true") {
    if (!ENV.llmApiKey) {
      checks.llm = { ok: false, message: "OPENAI_API_KEY is required" };
    } else {
      try {
        const models = await getRuntimeModels();
        checks.llm = models.length
          ? { ok: true, message: `${models.length} model(s) available` }
          : { ok: false, message: "provider returned no models" };
      } catch (error) {
        checks.llm = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return { ready: Object.values(checks).every(check => check.ok), checks, runtime: getRuntimeInfo() };
}
