import { CronExpressionParser } from "cron-parser";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type mysql from "mysql2/promise";
import { getSharedPool } from "./db";
import { lockActiveProject } from "./project-lifecycle-lock";

export function validateDataflowScheduleCron(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 6)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "调度表达式必须为 6 段 UTC 格式：秒 分 时 日 月 星期。",
    });
  if (parts[0] !== "0")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "数据流调度最小频率为 60 秒，秒字段必须为 0。",
    });
  if (parts.some(part => !/^[\d*/?,\-]+$/.test(part)))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "调度表达式包含不支持的字符。",
    });
  const cron = parts.join(" ");
  nextDataflowScheduleRun(cron, new Date());
  return cron;
}

export function nextDataflowScheduleRun(cron: string, after: Date | string) {
  try {
    return CronExpressionParser.parse(cron, { currentDate: after, tz: "UTC" })
      .next()
      .toDate()
      .toISOString();
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "调度表达式的范围或日期无效，请检查各段取值。",
    });
  }
}

function sqlTime(instant: string) {
  return instant.slice(0, 19).replace("T", " ");
}
export type NativeScheduleAdmission = {
  id: string;
  revision: number;
  dueAt: string;
};
export class ScheduleSupersededError extends Error {
  constructor() {
    super("调度状态已变化，本次触发已跳过。");
  }
}

export function isTransientScheduleError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return (
    typeof code === "string" &&
    [
      "ER_LOCK_DEADLOCK",
      "ER_LOCK_WAIT_TIMEOUT",
      "ER_CON_COUNT_ERROR",
      "PROTOCOL_CONNECTION_LOST",
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EPIPE",
    ].includes(code)
  );
}

type Schedule = mysql.RowDataPacket & {
  id: string;
  schedulerType: string;
  status: string;
  revision: number;
  cronExpression: string;
  nextRunAtUtc: string | null;
  schedulerNow: string;
};
const projection =
  "s.*,DATE_FORMAT(s.nextRunAt,'%Y-%m-%dT%H:%i:%sZ') AS nextRunAtUtc,DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS schedulerNow";

function conflict(message = "调度已被更新，请刷新后重新确认。") {
  return new TRPCError({ code: "CONFLICT", message });
}

function assertRevision(schedule: Schedule, expected: number | undefined) {
  if (expected === undefined || Number(schedule.revision) !== expected)
    throw conflict();
}

async function audit(
  connection: mysql.PoolConnection,
  userId: number,
  input: { projectId: string; workflowId: string },
  scheduleId: string,
  operation: string
) {
  await connection.query(
    "INSERT INTO authorization_audit_log (id,actorUserId,targetUserId,action,resourceType,resourceId,detailsJson) VALUES (?,?,NULL,'user_updated','dataflow_schedule',?,?)",
    [randomUUID(), userId, scheduleId, JSON.stringify({ operation, ...input })]
  );
}

async function lockedSchedule(
  connection: mysql.PoolConnection,
  input: { projectId: string; workflowId: string },
  allowArchived = false
) {
  await lockActiveProject(connection, input.projectId);
  const [flows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,status,archivedAt FROM workflow WHERE id=? AND projectId=? AND flowType='data' FOR UPDATE",
    [input.workflowId, input.projectId]
  );
  if (!flows[0] || (flows[0].archivedAt && !allowArchived))
    throw conflict("数据流不存在或已归档。");
  const [rows] = await connection.query<Schedule[]>(
    `SELECT ${projection} FROM dataflow_schedule s WHERE s.workflowId=? AND s.projectId=? FOR UPDATE`,
    [input.workflowId, input.projectId]
  );
  return {
    schedule: rows[0],
    published: flows[0].status === "published" && !flows[0].archivedAt,
  };
}

export async function saveNativeDataflowSchedule(
  userId: number,
  input: {
    projectId: string;
    workflowId: string;
    cronExpression: string;
    expectedRevision?: number;
  }
) {
  const cron = validateDataflowScheduleCron(input.cronExpression);
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const { schedule, published } = await lockedSchedule(connection, input);
    if (!published) throw conflict("数据流尚未发布，无法保存定时调度。");
    if (schedule) {
      if (schedule.status !== "deleted" || input.expectedRevision !== undefined)
        assertRevision(schedule, input.expectedRevision);
      if (schedule.status === "active")
        throw conflict("请先暂停当前调度，再修改计划。");
      if (
        schedule.schedulerType !== "internal" &&
        schedule.status !== "deleted" &&
        schedule.scheduleCronTaskUid
      )
        throw conflict(
          "原托管计划仍有关联任务，请先停用并删除后再创建内置调度。"
        );
    } else if (input.expectedRevision !== undefined) throw conflict();
    const scheduleId = schedule?.id ?? randomUUID();
    const revision = Number(schedule?.revision ?? 0) + 1;
    if (schedule)
      await connection.query(
        "UPDATE dataflow_schedule SET cronExpression=?,schedulerType='internal',status='paused',revision=?,scheduleCronTaskUid=NULL,nextRunAt=NULL,lastError=NULL,updatedAt=NOW() WHERE id=?",
        [cron, revision, scheduleId]
      );
    else
      await connection.query(
        "INSERT INTO dataflow_schedule (id,projectId,workflowId,cronExpression,status,schedulerType,revision,createdByUserId) VALUES (?,?,?,?,'paused','internal',?,?)",
        [scheduleId, input.projectId, input.workflowId, cron, revision, userId]
      );
    await audit(connection, userId, input, scheduleId, "draft_saved");
    await connection.commit();
    return {
      id: scheduleId,
      status: "paused" as const,
      cronExpression: cron,
      revision,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function changeNativeDataflowSchedule(
  userId: number,
  input: { projectId: string; workflowId: string; expectedRevision?: number },
  action: "activate" | "pause" | "delete"
) {
  if (action === "activate" && process.env.WORKFLOW_WORKER_ENABLED === "false")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "后台执行器未启用，无法启用定时调度。",
    });
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const { schedule, published } = await lockedSchedule(
      connection,
      input,
      action !== "activate"
    );
    if (
      !schedule ||
      schedule.status === "deleted" ||
      schedule.schedulerType !== "internal"
    )
      throw conflict("内置调度不存在或已被删除，请刷新。");
    assertRevision(schedule, input.expectedRevision);
    if (action === "activate" && !published)
      throw conflict("流程已取消发布，无法启用调度。");
    if (action === "activate" && schedule.status === "active")
      throw conflict("调度已经启用，请刷新查看。");
    const status =
      action === "activate"
        ? "active"
        : action === "pause"
          ? "paused"
          : "deleted";
    const nextRunAt =
      action === "activate"
        ? nextDataflowScheduleRun(
            schedule.cronExpression,
            schedule.schedulerNow
          )
        : null;
    const revision = Number(schedule.revision) + 1;
    await connection.query(
      "UPDATE dataflow_schedule SET status=?,revision=?,nextRunAt=?,lastError=NULL,updatedAt=NOW() WHERE id=?",
      [status, revision, nextRunAt ? sqlTime(nextRunAt) : null, schedule.id]
    );
    await audit(connection, userId, input, schedule.id, action);
    await connection.commit();
    return { id: schedule.id, status, revision, nextRunAt };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Caller already holds project and workflow locks; pause/reconfigure uses the same order. */
export async function lockNativeScheduleAdmission(
  connection: mysql.PoolConnection,
  input: { projectId: string; workflowId: string },
  expected: NativeScheduleAdmission,
  userId: number
) {
  const [rows] = await connection.query<Schedule[]>(
    `SELECT ${projection} FROM dataflow_schedule s WHERE s.id=? AND s.projectId=? AND s.workflowId=? AND s.schedulerType='internal' AND s.status='active' AND s.nextRunAt<=UTC_TIMESTAMP() FOR UPDATE`,
    [expected.id, input.projectId, input.workflowId]
  );
  const schedule = rows[0];
  if (
    !schedule ||
    Number(schedule.revision) !== expected.revision ||
    schedule.nextRunAtUtc !== expected.dueAt
  )
    throw new ScheduleSupersededError();
  const [owners] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT p.ownerUserId,u.status FROM flow_project p JOIN users u ON u.id=p.ownerUserId WHERE p.id=? FOR SHARE",
    [input.projectId]
  );
  if (Number(owners[0]?.ownerUserId) !== userId)
    throw new ScheduleSupersededError();
  if (owners[0]?.status !== "active") throw new Error("业务负责人已停用。");
  return {
    schedule,
    bucket: `native:${schedule.id}:${schedule.revision}:${Date.parse(expected.dueAt)}`,
  };
}

export async function advanceNativeDataflowSchedule(
  connection: mysql.PoolConnection,
  schedule: Schedule,
  runId: string
) {
  // Coalesce downtime into one durable admission, then return to the future calendar.
  const next = nextDataflowScheduleRun(
    schedule.cronExpression,
    schedule.schedulerNow
  );
  const [result] = await connection.query<mysql.ResultSetHeader>(
    "UPDATE dataflow_schedule SET nextRunAt=?,lastTriggeredAt=UTC_TIMESTAMP(),lastRunId=?,lastError=NULL WHERE id=? AND revision=? AND status='active'",
    [sqlTime(next), runId, schedule.id, schedule.revision]
  );
  if (result.affectedRows !== 1) throw new ScheduleSupersededError();
}
