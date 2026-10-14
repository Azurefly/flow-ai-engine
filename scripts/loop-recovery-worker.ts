import assert from "node:assert/strict";
import { processClaimedWorkflowJob } from "../server/workflow-worker";
import { WorkflowExecutionInjectedCrash } from "../server/workflow-engine";
import { getSharedPool } from "../server/db";
import type mysql from "mysql2/promise";

const input = JSON.parse(process.env.FLOW_RECOVERY_JOB ?? "null");
assert(input && /^recover_[a-f0-9]{12}$/.test(input.tag));
assert(typeof input.workflowName === "string" && input.workflowName.endsWith("_" + input.tag));
assert(process.env.NODE_ENV === "test");
const pool = getSharedPool();
const [rows] = await pool.query<mysql.RowDataPacket[]>(
  "SELECT j.*,r.workflowId,r.ownerUserId,w.ownerUserId AS workflowOwner,w.projectId,w.name FROM workflow_run_job j JOIN workflow_run r ON r.id=j.runId JOIN workflow w ON w.id=r.workflowId WHERE j.id=? AND j.runId=? AND j.status='leased' AND j.leaseToken=? AND r.executionLockToken=?",
  [input.jobId, input.runId, input.leaseToken, input.leaseToken]
);
const job = rows[0];
assert(job && job.ownerUserId === input.ownerUserId && job.workflowOwner === input.ownerUserId && job.projectId === input.projectId && job.name === input.workflowName);
try {
  await processClaimedWorkflowJob({ id: job.id, runId: job.runId, leaseToken: job.leaseToken, attempt: job.attempt, maxAttempts: job.maxAttempts, checkpoint: typeof job.checkpointJson === "string" ? JSON.parse(job.checkpointJson) : job.checkpointJson });
  throw new Error("指定故障边界未触发，不能视为中断恢复通过。");
} catch (error) {
  if (!(error instanceof WorkflowExecutionInjectedCrash)) throw error;
  process.stdout.write(JSON.stringify({ faultReached: true, runId: input.runId }) + "\n", () => process.kill(process.pid, "SIGKILL"));
}
