import mysql from "mysql2/promise";
import { drainWorkflowJobs } from "./workflow-worker";

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * A durable run is moved to `waiting` when the worker creates a human task.
 * During the tiny transition window it may still be `running`, so the test
 * adapter must accept both states when it observes a pending task.
 */
export function waitingTaskIdForRun(run: unknown, task: unknown) {
  if (!task || typeof task !== "object") return undefined;
  if (!run || typeof run !== "object") return undefined;
  const status = (run as { status?: unknown }).status;
  if (status !== "running" && status !== "waiting") return undefined;
  const taskId = (task as { id?: unknown }).id;
  if (taskId === undefined || taskId === null) return undefined;
  return String(taskId);
}

/**
 * Integration-test adapter for the production command API. Production callers
 * receive `queued`; tests explicitly drain the real durable Worker before
 * asserting the resulting run/task state.
 */
export async function settleWorkflowCommand(
  pool: mysql.Pool,
  command: Record<string, any>,
  maxJobs = 50
) {
  if (command.status !== "queued") return command;
  for (let poll = 0; poll < 400; poll += 1) {
    await drainWorkflowJobs(maxJobs);
    const [runs] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT status,finalOutputJson,errorJson FROM workflow_run WHERE id=? LIMIT 1",
      [command.runId]
    );
    const run = runs[0];
    if (!run) throw new Error(`Workflow run ${command.runId} disappeared while settling a command.`);
    if (run.status === "success") {
      return { ...command, status: "success", output: parseJson(run.finalOutputJson) };
    }
    if (run.status === "cancelled") {
      return { ...command, status: "cancelled", output: parseJson(run.finalOutputJson) };
    }
    if (run.status === "failed") {
      const details = parseJson(run.errorJson) as { message?: string } | undefined;
      throw new Error(details?.message || `Workflow run ${command.runId} failed.`);
    }
    const [tasks] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE runId=? AND status IN ('pending','claimed') ORDER BY createdAt DESC,id DESC LIMIT 1",
      [command.runId]
    );
    const taskId = waitingTaskIdForRun(run, tasks[0]);
    if (taskId) {
      return { ...command, status: "waiting", taskId };
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Workflow command did not settle within 10 seconds: run=${command.runId}.`);
}
