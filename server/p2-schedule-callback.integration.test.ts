import { randomUUID } from "crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { deleteDataflowSchedule, handleDataflowScheduleCallback } from "./p2-service";
import * as heartbeat from "./_core/heartbeat";
import { sdk } from "./_core/sdk";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const username = `schedule_callback_${suffix}`;
const taskUid = `callback-${suffix}`;
let pool: mysql.Pool | undefined;
let user: any;
let projectId: string | undefined;
let workflowId: string | undefined;

function callerFor(identity: any) {
  return appRouter.createCaller({ user: identity, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

function responseCapture() {
  const result: { code: number; body: any } = { code: 200, body: undefined };
  const res = { status: (code: number) => { result.code = code; return res; }, json: (body: unknown) => { result.body = body; return res; } } as any;
  return { result, res };
}

describe("P2 托管计划可信回调", () => {
  afterAll(async () => {
    vi.restoreAllMocks();
    if (!pool) return;
    if (projectId) {
      await pool.query("DELETE FROM dataflow_schedule WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM dataflow_run WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?", [user?.id ?? -1, user?.id ?? -1]);
    await pool.query("DELETE FROM users WHERE username=?", [username]);
    await pool.end();
  });

  runIntegration("仅可信任务 UID 可触发一次数据流运行，非法与重复回调均不重复执行", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())", [`test:${username}`, username, "计划回调验收管理员", "admin", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=?", [username]);
    user = users[0];
    const owner = callerFor(user);
    projectId = (await owner.project.create({ code: `CB${suffix.slice(0, 5).toUpperCase()}`, name: "计划回调验收" })).id;
    workflowId = (await owner.project.createWorkflow({ projectId, name: "计划回调数据流", flowType: "data", definition: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", name: "结束", position: { x: 240, y: 0 }, config: {} }], edges: [{ id: "e", sourceNodeId: "start", targetNodeId: "end" }] } })).id;
    await owner.project.auditWorkflow({ projectId, workflowId, auditStatus: "approved" });
    await owner.workflow.publish({ id: workflowId });
    await pool.query("INSERT INTO dataflow_schedule (id,projectId,workflowId,cronExpression,status,scheduleCronTaskUid,createdByUserId) VALUES (?,?,?,?,?,?,?)", [`schedule-${suffix}`, projectId, workflowId, "0 0 9 * * *", "active", taskUid, user.id]);

    const authenticate = vi.spyOn(sdk, "authenticateRequest");
    authenticate.mockResolvedValue({ isCron: true, taskUid } as any);
    const first = responseCapture();
    await handleDataflowScheduleCallback({ path: "/api/scheduled/dataflow" } as any, first.res);
    expect(first.result).toMatchObject({ code: 200, body: { ok: true } });
    const second = responseCapture();
    await handleDataflowScheduleCallback({ path: "/api/scheduled/dataflow" } as any, second.res);
    expect(second.result).toMatchObject({ code: 200, body: { ok: true, duplicate: true, runId: first.result.body.runId } });
    const [runs] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM dataflow_run WHERE workflowId=? AND triggerType='schedule'", [workflowId]);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    const [scheduleRows] = await pool.query<mysql.RowDataPacket[]>("SELECT lastTriggeredAt,lastRunId FROM dataflow_schedule WHERE workflowId=?", [workflowId]);
    expect(scheduleRows[0].lastTriggeredAt).toBeTruthy();
    expect(scheduleRows[0].lastRunId).toBe(first.result.body.runId);

    authenticate.mockRejectedValueOnce(new Error("not cron"));
    const invalid = responseCapture();
    await handleDataflowScheduleCallback({ path: "/api/scheduled/dataflow" } as any, invalid.res);
    expect(invalid.result).toMatchObject({ code: 403, body: { error: "cron-only" } });
    const [afterInvalid] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM dataflow_run WHERE workflowId=? AND triggerType='schedule'", [workflowId]);
    expect(afterInvalid).toHaveLength(1);

    const deleteJob = vi.spyOn(heartbeat, "deleteHeartbeatJob").mockResolvedValue(undefined);
    await expect(deleteDataflowSchedule(user, { projectId, workflowId })).resolves.toBe(true);
    expect(deleteJob).toHaveBeenCalledWith(taskUid, "");
    const [deletedSchedules] = await pool.query<mysql.RowDataPacket[]>("SELECT status FROM dataflow_schedule WHERE workflowId=?", [workflowId]);
    expect(deletedSchedules[0].status).toBe("deleted");
  }, 90_000);
});
