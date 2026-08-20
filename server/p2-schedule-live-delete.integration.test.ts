import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { deleteHeartbeatJob, listHeartbeatJobs } from "./_core/heartbeat";
import { activateDataflowSchedule, deleteDataflowSchedule, saveDataflowScheduleDraft } from "./p2-service";

const runLive = process.env.RUN_LIVE_SCHEDULE_TEST === "1" && process.env.DATABASE_URL ? it : it.skip;
const suffix = crypto.randomUUID().slice(0, 8);
const username = `live_schedule_delete_${suffix}`;
let pool: mysql.Pool | undefined;
let user: any;
let projectId: string | undefined;
let workflowId: string | undefined;
let taskUid: string | undefined;

function callerFor(identity: any) {
  return appRouter.createCaller({ user: identity, req: { headers: {}, protocol: "https" }, res: {} } as unknown as TrpcContext);
}

async function cleanup() {
  if (taskUid) await deleteHeartbeatJob(taskUid, "").catch(() => undefined);
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
}

describe("P2 应用级隔离计划删除闭环", () => {
  afterAll(cleanup);

  runLive("应用数据流计划激活后删除，同时移除平台任务且不触及生产计划", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())", [`test:${username}`, username, "隔离计划删除验收管理员", "admin", "active", "internal"]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=?", [username]);
    user = users[0];
    const owner = callerFor(user);
    projectId = (await owner.project.create({ code: `LD${suffix.slice(0, 5).toUpperCase()}`, name: "隔离计划删除验收" })).id;
    workflowId = (await owner.project.createWorkflow({ projectId, name: "隔离删除数据流", flowType: "data", definition: { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", name: "结束", position: { x: 240, y: 0 }, config: {} }], edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }] } })).id;
    await owner.project.auditWorkflow({ projectId, workflowId, auditStatus: "approved" });
    await owner.workflow.publish({ id: workflowId });

    await saveDataflowScheduleDraft(user, { projectId, workflowId, cronExpression: "0 59 23 31 12 *" });
    await expect(activateDataflowSchedule(user, { projectId, workflowId })).resolves.toMatchObject({ status: "active" });
    const [created] = await pool.query<mysql.RowDataPacket[]>("SELECT status,scheduleCronTaskUid FROM dataflow_schedule WHERE projectId=? AND workflowId=?", [projectId, workflowId]);
    expect(created[0].status).toBe("active");
    taskUid = String(created[0].scheduleCronTaskUid);
    expect(taskUid).not.toBe("");
    const beforeDelete = await listHeartbeatJobs("", { pageSize: 200 });
    expect(beforeDelete.jobs.some(job => job.taskUid === taskUid)).toBe(true);

    await expect(deleteDataflowSchedule(user, { projectId, workflowId })).resolves.toBe(true);
    const [deleted] = await pool.query<mysql.RowDataPacket[]>("SELECT status FROM dataflow_schedule WHERE projectId=? AND workflowId=?", [projectId, workflowId]);
    expect(deleted[0].status).toBe("deleted");
    const afterDelete = await listHeartbeatJobs("", { pageSize: 200 });
    expect(afterDelete.jobs.some(job => job.taskUid === taskUid)).toBe(false);
    taskUid = undefined;
  }, 120_000);
});
