import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createProject, createProjectWorkflow, grantProjectMember, setProjectWorkflowAudit } from "./project-service";
import { updateWorkflow, type Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let owner: any;
let operator: any;
let outsider: any;
let projectId: string | undefined;
let workflowId: string | undefined;

const manualDefinition: Definition = {
  schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { applicant: "{{input.applicant}}" } } },
    { id: "operate", type: "operate", name: "人工审批", position: { x: 200, y: 0 }, config: { instruction: "核验申请资料", assigneeUserId: "{{input.assigneeUserId}}" } },
    { id: "end", type: "end", name: "结束", position: { x: 400, y: 0 }, config: { resultTemplate: { decision: "{{nodes.operate.result.decision}}", applicant: "{{vars.applicant}}" } } },
  ],
  edges: [{ id: "s-o", sourceNodeId: "start", targetNodeId: "operate" }, { id: "o-e", sourceNodeId: "operate", targetNodeId: "end" }],
};

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: { cookie: () => undefined, clearCookie: () => undefined } } as unknown as TrpcContext);
}

describe("P1 人工任务与服务端续跑", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_task WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE r FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?, ?, ?) OR targetUserId IN (?, ?, ?)", [owner?.id ?? -1, operator?.id ?? -1, outsider?.id ?? -1, owner?.id ?? -1, operator?.id ?? -1, outsider?.id ?? -1]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?)", [`p1_owner_${suffix}`, `p1_operator_${suffix}`, `p1_outsider_${suffix}`]);
    await pool.end();
  });

  runIntegration("指定项目运行者可领取并完成 operate 任务，外部用户看不到任务，完成后由服务端续跑", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?", [[[`test:p1-owner-${suffix}`, `p1_owner_${suffix}`, "P1 所有者", "admin", "active", "internal", new Date()], [`test:p1-operator-${suffix}`, `p1_operator_${suffix}`, "P1 处理人", "user", "active", "internal", new Date()], [`test:p1-outsider-${suffix}`, `p1_outsider_${suffix}`, "P1 外部用户", "user", "active", "internal", new Date()]]]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?)", [`p1_owner_${suffix}`, `p1_operator_${suffix}`, `p1_outsider_${suffix}`]);
    owner = users.find(user => user.username === `p1_owner_${suffix}`);
    operator = users.find(user => user.username === `p1_operator_${suffix}`);
    outsider = users.find(user => user.username === `p1_outsider_${suffix}`);
    projectId = await createProject(owner, { code: `P1${suffix.slice(0, 6).toUpperCase()}`, name: "P1 人工任务验收" });
    await grantProjectMember(owner, { projectId, userId: operator.id, role: "operator" });
    const workflow = await createProjectWorkflow(owner, { projectId, name: "人工审批流程", flowType: "control", definition: manualDefinition });
    workflowId = workflow.id;
    await setProjectWorkflowAudit(owner, { projectId, workflowId, auditStatus: "approved" });
    await updateWorkflow(workflowId, owner, { publish: true });

    const waiting: any = await callerFor(owner).workflow.run({ workflowId, input: { applicant: "张三", assigneeUserId: operator.id } });
    expect(waiting).toMatchObject({ status: "waiting" });
    const todo = await callerFor(operator).task.list({ view: "todo" });
    expect(todo).toHaveLength(1);
    expect(todo[0]).toMatchObject({ id: waiting.taskId, nodeName: "人工审批", status: "pending", assignedUserId: operator.id });
    await expect(callerFor(outsider).task.get({ taskId: waiting.taskId })).rejects.toThrow("人工任务不存在或无访问权限");
    const claimed: any = await callerFor(operator).task.claim({ taskId: waiting.taskId });
    expect(claimed.status).toBe("claimed");
    const completed: any = await callerFor(operator).task.complete({ taskId: waiting.taskId, result: { decision: "approved", comment: "资料完整" } });
    expect(completed).toMatchObject({ runId: waiting.runId, status: "success", output: { result: { decision: "approved", applicant: "张三" } } });
    const done = await callerFor(operator).task.list({ view: "done" });
    expect(done[0]).toMatchObject({ id: waiting.taskId, status: "completed", completedByUserId: operator.id });
    const run: any = await callerFor(owner).workflow.runDetail({ runId: waiting.runId });
    expect(run.status).toBe("success");
    expect(run.nodeRuns.map((node: any) => node.nodeId).sort()).toEqual(["end", "operate", "start"]);
    expect(run.nodeRuns.every((node: any) => node.status === "success")).toBe(true);
    expect(Number(run.durationMs)).toBeGreaterThanOrEqual(Number(run.nodeRuns.find((node: any) => node.nodeId === "operate")?.durationMs ?? 0));
  }, 60_000);
});
