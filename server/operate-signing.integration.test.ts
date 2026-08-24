import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { assignRole, createCustomRole } from "./iam-service";
import {
  createProject,
  createProjectWorkflow,
  grantProjectMember,
  setProjectWorkflowAudit,
} from "./project-service";
import { appRouter } from "./routers";
import { updateWorkflow, type Definition } from "./workflow-service";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
const roleCode = `custom_sign_${suffix}`;
let pool: mysql.Pool | undefined;
let owner: any;
let approvers: any[] = [];
let projectId: string | undefined;
const workflowIds: string[] = [];

function callerFor(user: any) {
  return appRouter.createCaller({
    user,
    req: { headers: {}, protocol: "https" },
    res: { cookie: () => undefined, clearCookie: () => undefined },
  } as unknown as TrpcContext);
}

function signingDefinition(
  signMode: "orSignFor" | "andSignFor",
  passPercent = 100
): Definition {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 0, y: 0 },
        config: { initialVariables: {} },
      },
      {
        id: "approve",
        type: "operate",
        name: signMode === "orSignFor" ? "或签审批" : "会签审批",
        position: { x: 200, y: 0 },
        config: {
          nodeDh: signMode === "orSignFor" ? "OR_SIGN" : "AND_SIGN",
          czmc: "审核通过",
          assigneeMode: "role",
          assigneeRoleCode: roleCode,
          instruction: "请完成多人审批",
          bdcz: {
            bdcz: [],
            bdczjs: ["acceptor"],
            hqhqsz: signMode,
            xzdfhq: {},
            hqtgbfb: passPercent,
          },
        },
      },
      {
        id: "approved",
        type: "state",
        name: "审批完成",
        position: { x: 400, y: 0 },
        config: {
          nodeDh: "APPROVED",
          jdmc: "已审核",
          flowStatus: "审批通过",
          stateType: "business",
        },
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 600, y: 0 },
        config: { resultTemplate: { status: "approved" } },
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "approve" },
      { id: "e2", sourceNodeId: "approve", targetNodeId: "approved" },
      { id: "e3", sourceNodeId: "approved", targetNodeId: "end" },
    ],
  };
}

async function createSigningWorkflow(
  signMode: "orSignFor" | "andSignFor",
  passPercent = 100
) {
  const workflow = await createProjectWorkflow(owner, {
    projectId: projectId!,
    name: signMode === "orSignFor" ? "或签回归" : "会签回归",
    flowType: "state",
    definition: signingDefinition(signMode, passPercent),
  });
  workflowIds.push(workflow.id);
  for (const approver of approvers)
    await assignRole({
      userId: Number(approver.id),
      roleCode,
      scopeType: "workflow",
      scopeId: workflow.id,
      grantedByUserId: Number(owner.id),
    });
  await setProjectWorkflowAudit(owner, {
    projectId: projectId!,
    workflowId: workflow.id,
    auditStatus: "approved",
  });
  await updateWorkflow(workflow.id, owner, { publish: true });
  return workflow.id;
}

describe("原版操作节点或签和会签运行语义", () => {
  afterAll(async () => {
    if (!pool) return;
    for (const workflowId of workflowIds) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_task WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query(
        "DELETE FROM workflow_participant_state WHERE workflowId=?",
        [workflowId]
      );
      await pool.query("DELETE FROM workflow_task_group WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?",
        [workflowId]
      );
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query(
        "DELETE FROM role_assignment WHERE scopeType='workflow' AND scopeId=?",
        [workflowId]
      );
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (projectId) {
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    const [roles] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM iam_role WHERE code=?",
      [roleCode]
    );
    if (roles[0]) {
      await pool.query("DELETE FROM role_permission WHERE roleId=?", [
        roles[0].id,
      ]);
      await pool.query("DELETE FROM iam_role WHERE id=?", [roles[0].id]);
    }
    const userIds = [owner?.id, ...approvers.map(item => item.id)].filter(
      Boolean
    );
    if (userIds.length)
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [userIds, userIds]
      );
    await pool.query("DELETE FROM users WHERE username LIKE ?", [
      `sign_${suffix}_%`,
    ]);
    await pool.end();
  });

  runIntegration(
    "或签首人完成即取消其他待办，会签达到比例前保持等待且只续跑一次",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await pool.query(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?",
        [
          [
            [
              `test:sign-${suffix}-owner`,
              `sign_${suffix}_owner`,
              "签收流程管理员",
              "admin",
              "active",
              "internal",
              new Date(),
            ],
            ...[1, 2, 3].map(index => [
              `test:sign-${suffix}-${index}`,
              `sign_${suffix}_${index}`,
              `审批人${index}`,
              "user",
              "active",
              "internal",
              new Date(),
            ]),
          ],
        ]
      );
      const [users] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM users WHERE username LIKE ? ORDER BY username",
        [`sign_${suffix}_%`]
      );
      owner = users.find(user => user.username.endsWith("_owner"));
      approvers = users.filter(user => !user.username.endsWith("_owner"));
      await createCustomRole({
        code: roleCode,
        name: "多人签收审批人",
        scope: "workflow",
        permissions: ["workflow:run", "workflow:view"],
        actorUserId: Number(owner.id),
      });
      projectId = await createProject(owner, {
        code: `SG${suffix.slice(0, 6).toUpperCase()}`,
        name: "多人签收回归",
      });
      for (const approver of approvers)
        await grantProjectMember(owner, {
          projectId,
          userId: Number(approver.id),
          role: "operator",
        });

      const orWorkflowId = await createSigningWorkflow("orSignFor");
      const orStarted: any = await settleWorkflowCommand(pool, await callerFor(owner).workflow.run({
        workflowId: orWorkflowId,
        input: {},
      }));
      const orTodos: any[][] = await Promise.all(
        approvers.map(approver =>
          callerFor(approver).task.list({ view: "todo", projectId })
        )
      );
      expect(orTodos.map(items => items.length)).toEqual([1, 1, 1]);
      const orRejected: any = await settleWorkflowCommand(pool, await callerFor(approvers[0]).task.execute({
        taskId: orTodos[0][0].id,
        result: { decision: "rejected", comment: "需要其他审批人复核" },
      }));
      expect(orRejected).toMatchObject({
        status: "waiting",
        approvalProgress: { approved: 0, rejected: 1, required: 1, total: 3 },
      });
      const orResult: any = await settleWorkflowCommand(pool, await callerFor(approvers[1]).task.execute({
        taskId: orTodos[1][0].id,
        result: { decision: "approved" },
      }));
      expect(orResult.status).toBe("success");
      const [orTasks] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT status FROM workflow_task WHERE runId=? ORDER BY status",
        [orStarted.runId]
      );
      expect(orTasks.map(row => row.status).sort()).toEqual([
        "cancelled",
        "completed",
        "completed",
      ]);
      const [orJobs] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT jobType,status FROM workflow_run_job WHERE runId=? ORDER BY createdAt,id",
        [orStarted.runId]
      );
      expect(orJobs).toMatchObject([
        { jobType: "start", status: "completed" },
        { jobType: "resume", status: "completed" },
      ]);

      const andWorkflowId = await createSigningWorkflow("andSignFor", 60);
      const andStarted: any = await settleWorkflowCommand(pool, await callerFor(owner).workflow.run({
        workflowId: andWorkflowId,
        input: {},
      }));
      const andTodos: any[][] = await Promise.all(
        approvers.map(approver =>
          callerFor(approver).task.list({ view: "todo", projectId })
        )
      );
      const first: any = await settleWorkflowCommand(pool, await callerFor(approvers[0]).task.execute({
        taskId: andTodos[0].find(item => item.runId === andStarted.runId).id,
        result: { decision: "approved" },
      }));
      expect(first).toMatchObject({
        status: "waiting",
        approvalProgress: { completed: 1, required: 2, total: 3 },
      });
      const secondTask = andTodos[1].find(
        item => item.runId === andStarted.runId
      );
      const thirdTask = andTodos[2].find(
        item => item.runId === andStarted.runId
      );
      const concurrentResults = await Promise.allSettled([
        callerFor(approvers[1]).task.execute({
          taskId: secondTask.id,
          result: { decision: "approved", comment: "并发审批 A" },
        }).then(command => settleWorkflowCommand(pool!, command)),
        callerFor(approvers[2]).task.execute({
          taskId: thirdTask.id,
          result: { decision: "approved", comment: "并发审批 B" },
        }).then(command => settleWorkflowCommand(pool!, command)),
      ]);
      expect(concurrentResults.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrentResults.filter(result => result.status === "rejected")).toHaveLength(1);
      const completedResult = concurrentResults.find(result => result.status === "fulfilled");
      expect(completedResult?.status === "fulfilled" ? (completedResult.value as any).status : null).toBe("success");
      const [groups] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT status,totalApprovers,requiredApprovals FROM workflow_task_group WHERE runId=?",
        [andStarted.runId]
      );
      expect(groups[0]).toMatchObject({
        status: "completed",
        totalApprovers: 3,
        requiredApprovals: 2,
      });
      const [nodeRuns] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM workflow_node_run WHERE runId=? AND nodeId='approved' AND status='success'",
        [andStarted.runId]
      );
      expect(Number(nodeRuns[0].count)).toBe(1);
      const [andJobs] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT jobType,status FROM workflow_run_job WHERE runId=? ORDER BY createdAt,id",
        [andStarted.runId]
      );
      expect(andJobs).toMatchObject([
        { jobType: "start", status: "completed" },
        { jobType: "resume", status: "completed" },
      ]);
    },
    120_000
  );
});
