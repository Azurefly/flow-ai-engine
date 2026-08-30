import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  createProject,
  createProjectWorkflow,
  grantProjectMember,
  setProjectWorkflowAudit,
} from "./project-service";
import { updateWorkflow, type Definition } from "./workflow-service";
import { settleWorkflowCommand } from "./workflow-command-test-support";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8);
let pool: mysql.Pool | undefined;
let owner: any;
let operator: any;
let handoverUser: any;
let outsider: any;
let projectId: string | undefined;
let workflowId: string | undefined;

const manualDefinition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: { initialVariables: { applicant: "{{input.applicant}}" } },
    },
    {
      id: "operate",
      type: "operate",
      name: "人工审批",
      position: { x: 200, y: 0 },
      config: {
        instruction: "核验申请资料",
        assigneeUserId: "{{input.assigneeUserId}}",
      },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 400, y: 0 },
      config: {
        resultTemplate: {
          decision: "{{nodes.operate.result.decision}}",
          applicant: "{{vars.applicant}}",
        },
      },
    },
  ],
  edges: [
    { id: "s-o", sourceNodeId: "start", targetNodeId: "operate" },
    { id: "o-e", sourceNodeId: "operate", targetNodeId: "end" },
  ],
};

function callerFor(user: any) {
  return appRouter.createCaller({
    user,
    req: { headers: {}, protocol: "https" },
    res: { cookie: () => undefined, clearCookie: () => undefined },
  } as unknown as TrpcContext);
}

describe("P1 人工任务与服务端续跑", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query(
        "DELETE FROM workflow_run_alert WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_wait_subscription WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_participant_state WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_task WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_task_group WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_run_job WHERE runId IN (SELECT r.id FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?",
        [projectId]
      );
      await pool.query(
        "DELETE r FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query(
        "DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)",
        [projectId]
      );
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId IN (?, ?, ?, ?) OR targetUserId IN (?, ?, ?, ?)",
      [
        owner?.id ?? -1,
        operator?.id ?? -1,
        handoverUser?.id ?? -1,
        outsider?.id ?? -1,
        owner?.id ?? -1,
        operator?.id ?? -1,
        handoverUser?.id ?? -1,
        outsider?.id ?? -1,
      ]
    );
    await pool.query("DELETE FROM users WHERE username IN (?,?,?,?)", [
      `p1_owner_${suffix}`,
      `p1_operator_${suffix}`,
      `p1_handover_${suffix}`,
      `p1_outsider_${suffix}`,
    ]);
    await pool.end();
  });

  runIntegration(
    "指定项目运行者可移交、退回、批量领取并完成 operate 任务，外部用户看不到任务，完成后由服务端续跑",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await pool.query(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES ?",
        [
          [
            [
              `test:p1-owner-${suffix}`,
              `p1_owner_${suffix}`,
              "P1 所有者",
              "admin",
              "active",
              "internal",
              new Date(),
            ],
            [
              `test:p1-operator-${suffix}`,
              `p1_operator_${suffix}`,
              "P1 处理人",
              "user",
              "active",
              "internal",
              new Date(),
            ],
            [
              `test:p1-handover-${suffix}`,
              `p1_handover_${suffix}`,
              "P1 移交处理人",
              "user",
              "active",
              "internal",
              new Date(),
            ],
            [
              `test:p1-outsider-${suffix}`,
              `p1_outsider_${suffix}`,
              "P1 外部用户",
              "user",
              "active",
              "internal",
              new Date(),
            ],
          ],
        ]
      );
      const [users] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT * FROM users WHERE username IN (?,?,?,?)",
        [
          `p1_owner_${suffix}`,
          `p1_operator_${suffix}`,
          `p1_handover_${suffix}`,
          `p1_outsider_${suffix}`,
        ]
      );
      owner = users.find(user => user.username === `p1_owner_${suffix}`);
      operator = users.find(user => user.username === `p1_operator_${suffix}`);
      handoverUser = users.find(
        user => user.username === `p1_handover_${suffix}`
      );
      outsider = users.find(user => user.username === `p1_outsider_${suffix}`);
      projectId = await createProject(owner, {
        code: `P1${suffix.slice(0, 6).toUpperCase()}`,
        name: "P1 人工任务验收",
      });
      await grantProjectMember(owner, {
        projectId,
        userId: operator.id,
        role: "operator",
      });
      await grantProjectMember(owner, {
        projectId,
        userId: handoverUser.id,
        role: "operator",
      });
      const workflow = await createProjectWorkflow(owner, {
        projectId,
        name: "人工审批流程",
        flowType: "control",
        definition: manualDefinition,
      });
      workflowId = workflow.id;
      await setProjectWorkflowAudit(owner, {
        projectId,
        workflowId,
        auditStatus: "approved",
      });
      await updateWorkflow(workflowId, owner, { publish: true });

      const waiting: any = await settleWorkflowCommand(pool, await callerFor(owner).workflow.run({
        workflowId,
        input: { applicant: "张三", assigneeUserId: operator.id },
      }));
      expect(waiting).toMatchObject({ status: "waiting" });
      const todo = await callerFor(operator).task.list({ view: "todo" });
      expect(todo).toHaveLength(1);
      expect(todo[0]).toMatchObject({
        id: waiting.taskId,
        nodeName: "人工审批",
        status: "pending",
        assignedUserId: operator.id,
      });
      await expect(
        callerFor(outsider).task.get({ taskId: waiting.taskId })
      ).rejects.toThrow("人工任务不存在或无访问权限");
      const assignees: any[] = await callerFor(operator).task.assignees({
        taskId: waiting.taskId,
      });
      expect(assignees.map(item => item.id)).toEqual(
        expect.arrayContaining([operator.id, handoverUser.id])
      );
      expect(assignees.map(item => item.id)).not.toContain(outsider.id);
      const claimed: any = await callerFor(operator).task.claim({
        taskId: waiting.taskId,
      });
      expect(claimed.status).toBe("claimed");
      const handedOver: any = await callerFor(operator).task.handover({
        taskId: waiting.taskId,
        targetUserId: handoverUser.id,
      });
      expect(handedOver).toMatchObject({
        status: "pending",
        assignedUserId: handoverUser.id,
        claimedByUserId: null,
      });
      const [participantStates] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT userId,sourceNodeId,availableOperationsJson FROM workflow_participant_state WHERE runId=? AND userId IN (?,?) ORDER BY userId",
        [waiting.runId, operator.id, handoverUser.id]
      );
      const operationIds = (value: unknown) => {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        return Array.isArray(parsed)
          ? parsed.map(item => String(item?.taskId ?? item?.id ?? ""))
          : [];
      };
      const previousState = participantStates.find(
        state => Number(state.userId) === Number(operator.id)
      );
      const targetState = participantStates.find(
        state => Number(state.userId) === Number(handoverUser.id)
      );
      expect(operationIds(previousState?.availableOperationsJson)).not.toContain(
        waiting.taskId
      );
      expect(targetState).toMatchObject({ sourceNodeId: "operate" });
      expect(operationIds(targetState?.availableOperationsJson)).toContain(
        waiting.taskId
      );
      await expect(
        callerFor(operator).task.claim({ taskId: waiting.taskId })
      ).rejects.toThrow();
      expect(
        await callerFor(operator).task.list({ view: "todo" })
      ).toHaveLength(0);
      expect(
        await callerFor(handoverUser).task.list({ view: "todo" })
      ).toHaveLength(1);
      const handoverClaimed: any = await callerFor(handoverUser).task.claim({
        taskId: waiting.taskId,
      });
      expect(handoverClaimed.status).toBe("claimed");
      const returned: any = await callerFor(handoverUser).task.returnToPending({
        taskId: waiting.taskId,
      });
      expect(returned).toMatchObject({
        status: "pending",
        assignedUserId: handoverUser.id,
        claimedByUserId: null,
      });
      await expect(
        callerFor(handoverUser).task.complete({
          taskId: waiting.taskId,
          result: { decision: "approved", comment: "绕过领取" },
        })
      ).rejects.toThrow("仅当前领取人");
      const batchCompletedRaw: any[] = await callerFor(
        handoverUser
      ).task.batchComplete({
        taskIds: [waiting.taskId],
        result: { decision: "approved", comment: "资料完整" },
      });
      const batchCompleted: any[] = [await settleWorkflowCommand(pool, batchCompletedRaw[0])];
      expect(batchCompleted).toMatchObject([
        {
          taskId: waiting.taskId,
          success: true,
          runId: waiting.runId,
          status: "success",
        },
      ]);
      const completed: any = await callerFor(owner).workflow.runDetail({
        runId: waiting.runId,
      });
      const done = await callerFor(handoverUser).task.list({ view: "done" });
      expect(done[0]).toMatchObject({
        id: waiting.taskId,
        status: "completed",
        completedByUserId: handoverUser.id,
      });
      expect(completed.status).toBe("success");
      expect(completed.nodeRuns.map((node: any) => node.nodeId).sort()).toEqual(
        ["end", "operate", "start"]
      );
      expect(
        completed.nodeRuns.every((node: any) => node.status === "success")
      ).toBe(true);
      expect(Number(completed.durationMs)).toBeGreaterThanOrEqual(
        Number(
          completed.nodeRuns.find((node: any) => node.nodeId === "operate")
            ?.durationMs ?? 0
        )
      );
      const [audits] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT detailsJson FROM authorization_audit_log WHERE resourceType='workflow_task' AND resourceId=? ORDER BY createdAt",
        [waiting.taskId]
      );
      expect(
        audits.map(
          row =>
            (typeof row.detailsJson === "string"
              ? JSON.parse(row.detailsJson)
              : row.detailsJson
            ).operation
        )
      ).toEqual(
        expect.arrayContaining([
          "task_handover",
          "task_returned_to_pending",
          "task_claimed",
          "task_approved",
        ])
      );

      const rejectedWaiting: any = await settleWorkflowCommand(pool, await callerFor(owner).workflow.run({
        workflowId,
        input: { applicant: "李四", assigneeUserId: operator.id },
      }));
      const rejected: any = await settleWorkflowCommand(pool, await callerFor(operator).task.execute({
        taskId: rejectedWaiting.taskId,
        result: { decision: "rejected", comment: "资料不完整" },
      }));
      expect(rejected).toMatchObject({
        status: "cancelled",
        output: { decision: "rejected" },
      });
      const rejectedRun: any = await callerFor(owner).workflow.runDetail({
        runId: rejectedWaiting.runId,
      });
      expect(rejectedRun.status).toBe("cancelled");
      expect(
        rejectedRun.nodeRuns.map((node: any) => node.nodeId).sort()
      ).toEqual(["operate", "start"]);
      const rejectedDone: any[] = await callerFor(operator).task.list({
        view: "done",
      });
      expect(
        rejectedDone.find(item => item.id === rejectedWaiting.taskId)
      ).toMatchObject({
        displayStatus: "已拒绝",
        result: { decision: "rejected", comment: "资料不完整" },
      });
    },
    120_000
  );
});
