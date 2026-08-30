import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createProject, createProjectWorkflow, grantProjectMember, setProjectWorkflowAudit } from "./project-service";
import { updateWorkflow, type Definition } from "./workflow-service";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let projectId: string | undefined;
let workflowId: string | undefined;
let blockedWorkflowId: string | undefined;
let owner: any;
let operator: any;
let viewer: any;
let runId: string | undefined;
let blockedRunId: string | undefined;

const executableDefinition: Definition = {
  schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: { source: "{{input.source}}" } } },
    { id: "milestone", type: "milestone", name: "已接收", position: { x: 180, y: 0 }, config: { milestoneCode: "RECEIVED", displayName: "已接收", category: "business" } },
    { id: "form", type: "form", name: "申请表单", position: { x: 360, y: 0 }, config: { fields: [{ key: "reason", required: true }] } },
    { id: "router", type: "router", name: "默认路由", position: { x: 540, y: 0 }, config: { defaultRoute: "default", routes: [{ code: "default", target: "end" }] } },
    { id: "end", type: "end", name: "结束", position: { x: 720, y: 0 }, config: { resultTemplate: { state: "{{nodes.milestone.milestoneCode}}", source: "{{vars.source}}" } } },
  ],
  edges: [{ id: "s-milestone", sourceNodeId: "start", targetNodeId: "milestone" }, { id: "milestone-form", sourceNodeId: "milestone", targetNodeId: "form" }, { id: "form-router", sourceNodeId: "form", targetNodeId: "router" }, { id: "router-end", sourceNodeId: "router", targetNodeId: "end" }],
};

function callerFor(user: any) {
  return appRouter.createCaller({ user, req: { headers: {}, protocol: "https" }, res: { cookie: () => undefined, clearCookie: () => undefined } } as unknown as TrpcContext);
}

describe("P0 原始流程类型与项目发起", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_wait_subscription WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_participant_state WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_task WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_task_group WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_run_job WHERE runId IN (SELECT r.id FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?)", [projectId]);
      await pool.query("DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE r FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?", [projectId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId IN (?, ?, ?) OR targetUserId IN (?, ?, ?)", [owner?.id ?? -1, operator?.id ?? -1, viewer?.id ?? -1, owner?.id ?? -1, operator?.id ?? -1, viewer?.id ?? -1]);
    await pool.query("DELETE FROM users WHERE username IN (?,?,?)", [`p0_owner_${suffix}`, `p0_operator_${suffix}`, `p0_viewer_${suffix}`]);
    await pool.end();
  });

  runIntegration("项目运行者可发起已发布流程，查看者和未发布流程均被拒绝，原始声明节点安全落库", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    await pool.query("INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?", [[[`test:p0-owner-${suffix}`, `p0_owner_${suffix}`, "P0 所有者", "admin", "active", "internal", new Date()], [`test:p0-operator-${suffix}`, `p0_operator_${suffix}`, "P0 运行者", "user", "active", "internal", new Date()], [`test:p0-viewer-${suffix}`, `p0_viewer_${suffix}`, "P0 查看者", "user", "active", "internal", new Date()]]]);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username IN (?,?,?)", [`p0_owner_${suffix}`, `p0_operator_${suffix}`, `p0_viewer_${suffix}`]);
    owner = users.find(row => row.username === `p0_owner_${suffix}`); operator = users.find(row => row.username === `p0_operator_${suffix}`); viewer = users.find(row => row.username === `p0_viewer_${suffix}`);
    projectId = await createProject(owner, { code: `P0${suffix.slice(0, 6).toUpperCase()}`, name: "P0 原始流程验收" });
    await grantProjectMember(owner, { projectId, userId: operator.id, role: "operator" });
    await grantProjectMember(owner, { projectId, userId: viewer.id, role: "viewer" });
    const workflow = await createProjectWorkflow(owner, { projectId, name: "状态控制流程", flowType: "control", definition: executableDefinition });
    workflowId = workflow.id;
    await setProjectWorkflowAudit(owner, { projectId, workflowId, auditStatus: "approved" });
    await updateWorkflow(workflowId, owner, { publish: true });
    const operatorRun = await settleWorkflowCommand(pool, await callerFor(operator).workflow.run({ workflowId, input: { source: "project-launch", reason: "项目验收" } }));
    runId = operatorRun.runId;
    expect(operatorRun.status).toBe("success");
    expect(operatorRun.output).toEqual({ result: { state: "RECEIVED", source: "project-launch" } });
    const routerDefinition: Definition = {
      schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
      nodes: [
        { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: {} } },
        { id: "router", type: "router", name: "路由", position: { x: 160, y: 0 }, config: { defaultRoute: "approved", routes: [{ code: "approved" }, { code: "rejected" }] } },
        { id: "approved", type: "milestone", name: "通过分支", position: { x: 320, y: 0 }, config: { milestoneCode: "APPROVED", displayName: "通过分支", category: "business" } },
        { id: "rejected", type: "milestone", name: "拒绝分支", position: { x: 320, y: 130 }, config: { milestoneCode: "REJECTED", displayName: "拒绝分支", category: "business" } },
        { id: "end", type: "end", name: "结束", position: { x: 500, y: 0 }, config: { resultTemplate: { route: "{{nodes.approved.milestoneCode}}" } } },
      ],
      edges: [
        { id: "start-router", sourceNodeId: "start", targetNodeId: "router" },
        { id: "router-approved", sourceNodeId: "router", sourceHandle: "approved", targetNodeId: "approved" },
        { id: "router-rejected", sourceNodeId: "router", sourceHandle: "rejected", targetNodeId: "rejected" },
        { id: "approved-end", sourceNodeId: "approved", targetNodeId: "end" },
        { id: "rejected-end", sourceNodeId: "rejected", targetNodeId: "end" },
      ],
    };
    await updateWorkflow(workflowId, owner, { unpublish: true });
    await updateWorkflow(workflowId, owner, { definition: routerDefinition });
    await setProjectWorkflowAudit(owner, { projectId, workflowId, auditStatus: "approved" });
    await updateWorkflow(workflowId, owner, { publish: true });
    const routerRun = await settleWorkflowCommand(pool, await callerFor(operator).workflow.run({ workflowId, input: {} }));
    expect(routerRun.output).toEqual({ result: { route: "APPROVED" } });
    const [routerNodeRuns] = await pool.query<mysql.RowDataPacket[]>("SELECT nodeId,status FROM workflow_node_run WHERE runId=? ORDER BY startedAt", [routerRun.runId]);
    expect(routerNodeRuns.map(row => row.nodeId).sort()).toEqual(["approved", "end", "router", "start"]);
    expect(routerNodeRuns.some(row => row.nodeId === "rejected")).toBe(false);
    expect(routerNodeRuns.every(row => row.status === "success")).toBe(true);
    await expect(callerFor(viewer).workflow.run({ workflowId, input: {} })).rejects.toThrow("无权运行此流程");
    const blockedDefinition: Definition = { ...executableDefinition, nodes: [executableDefinition.nodes[0], { id: "operate", type: "operate", name: "人工审批", position: { x: 180, y: 0 }, config: { nodeDh: "MANUAL_APPROVE", assigneeMode: "initiator", instruction: "请完成项目验收" } }, { id: "end", type: "end", name: "结束", position: { x: 360, y: 0 }, config: { resultTemplate: "{{vars}}" } }], edges: [{ id: "s-o", sourceNodeId: "start", targetNodeId: "operate" }, { id: "o-e", sourceNodeId: "operate", targetNodeId: "end" }] };
    const blocked = await createProjectWorkflow(owner, { projectId, name: "未发布流程", flowType: "control", definition: blockedDefinition });
    blockedWorkflowId = blocked.id;
    await expect(callerFor(operator).workflow.run({ workflowId: blockedWorkflowId, input: {} })).rejects.toThrow("流程尚未发布");
    await setProjectWorkflowAudit(owner, { projectId, workflowId: blockedWorkflowId, auditStatus: "approved" });
    await updateWorkflow(blockedWorkflowId, owner, { publish: true });
    const manualRun: any = await settleWorkflowCommand(pool, await callerFor(operator).workflow.run({ workflowId: blockedWorkflowId, input: {} }));
    expect(manualRun).toMatchObject({ status: "waiting" });
    const [waitingRuns] = await pool.query<mysql.RowDataPacket[]>("SELECT id,status FROM workflow_run WHERE id=?", [manualRun.runId]);
    blockedRunId = waitingRuns[0]?.id;
    expect(waitingRuns[0]).toMatchObject({ status: "waiting" });
    const [manualTasks] = await pool.query<mysql.RowDataPacket[]>("SELECT id,status,nodeName FROM workflow_task WHERE runId=?", [manualRun.runId]);
    expect(manualTasks[0]).toMatchObject({ id: manualRun.taskId, status: "pending", nodeName: "人工审批" });
  }, 60_000);
});
