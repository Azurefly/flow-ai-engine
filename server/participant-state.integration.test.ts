import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParticipantStateExample } from "../shared/participant-state-example";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  createProject,
  createProjectWorkflow,
  grantProjectMember,
  setProjectWorkflowAudit,
} from "./project-service";
import { updateWorkflow } from "./workflow-service";
import {
  workflowReviewForTest,
  workflowRevisionForTest,
} from "./workflow-revision-test-support";
import { initializeParticipantStateRun } from "./participant-state-runtime";
import { settleWorkflowCommand } from "./workflow-command-test-support";
import { getWorkflowRun } from "./workflow-engine";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("参与人状态真实数据库与正常办理入口", () => {
  const suffix = randomUUID().slice(0, 8);
  let pool: mysql.Pool;
  let users: mysql.RowDataPacket[] = [];
  let projectId: string;
  let workflowId: string;
  const unitIds = [0, 1, 2].map(level => `ps_${suffix}_unit${level}`);
  const caller = (user: any) =>
    appRouter.createCaller({
      user,
      req: { headers: {}, protocol: "https" },
      res: { cookie: () => undefined, clearCookie: () => undefined },
    } as unknown as TrpcContext);
  const parse = (value: any) =>
    typeof value === "string" ? JSON.parse(value) : value;
  async function task(runId: string, nodeId: string) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE runId=? AND nodeId=? AND status IN ('pending','claimed')",
      [runId, nodeId]
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }
  async function start() {
    const result = await settleWorkflowCommand(
      pool,
      await caller(users[1]).workflow.run({ workflowId, input: {} })
    );
    expect(result.status).toBe("waiting");
    return String(result.runId);
  }
  async function execute(runId: string, nodeId: string, user: any, extra = {}) {
    const current = await task(runId, nodeId);
    const result = { decision: "approved" as const, outcome: nodeId, ...extra };
    return {
      task: current,
      result,
      response: await caller(user).task.execute({ taskId: current.id, result }),
    };
  }
  async function cards(runId: string) {
    const detail: any = await getWorkflowRun(runId, users[1].id);
    return Object.fromEntries(
      detail.participantCards.map((card: any) => [card.userId, card.stateName])
    );
  }
  beforeAll(async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    for (let index = 0; index < 4; index++) {
      await pool.query(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,'active','internal',NOW())",
        [
          `test:participant:${suffix}:${index}`,
          `ps_${suffix}_${index}`,
          `参与人${index}`,
          index === 0 ? "admin" : "user",
        ]
      );
    }
    [users] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE username LIKE ? ORDER BY id",
      [`ps_${suffix}_%`]
    );
    projectId = await createProject(users[0] as any, {
      code: `PS${suffix.toUpperCase()}`,
      name: `参与人状态验收${suffix}`,
    });
    for (const user of users.slice(1))
      await grantProjectMember(users[0] as any, {
        projectId,
        userId: user.id,
        role: "operator",
      });
    const definition = createParticipantStateExample();
    definition.nodes.find(
      node => node.id === "start"
    )!.config.initialVariables = { source: "test-initial" };
    definition.nodes.find(
      node => node.id === "handle"
    )!.config.escalationAfterSeconds = 3600;
    const workflow = await createProjectWorkflow(users[0] as any, {
      projectId,
      name: "提交撤回与处理",
      flowType: "state",
      definition,
    });
    workflowId = workflow.id;
    await setProjectWorkflowAudit(users[0] as any, {
      ...(await workflowReviewForTest(workflowId)),
      projectId,
      workflowId,
      auditStatus: "approved",
    });
    await updateWorkflow(workflowId, users[0] as any, { publish: true });
  }, 30000);
  afterAll(async () => {
    if (!pool) return;
    if (workflowId) {
      await pool.query(
        "DELETE FROM workflow_outbox_event WHERE aggregateId IN (SELECT id FROM workflow_run WHERE workflowId=?)",
        [workflowId]
      );
      await pool.query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?",
        [workflowId]
      );
      await pool.query(
        "DELETE FROM workflow_run_job WHERE runId IN (SELECT id FROM workflow_run WHERE workflowId=?)",
        [workflowId]
      );
      for (const table of [
        "workflow_task_schedule",
        "workflow_run_alert",
        "workflow_task",
        "workflow_participant_state",
        "workflow_state_transition",
        "workflow_run",
        "workflow_version",
        "workflow_member",
      ]) {
        await pool.query(`DELETE FROM ${table} WHERE workflowId=?`, [
          workflowId,
        ]);
      }
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (projectId) {
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    if (users.length) {
      await pool.query(
        "DELETE FROM organization_membership WHERE unitId IN (?)",
        [unitIds]
      );
      await pool.query("DELETE FROM organization_unit WHERE id IN (?)", [
        unitIds,
      ]);
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [users.map(user => user.id), users.map(user => user.id)]
      );
      await pool.query("DELETE FROM users WHERE id IN (?)", [
        users.map(user => user.id),
      ]);
    }
    await pool.end();
  });

  it("提交、撤回、换人再提交、完成与重试，旧待办失效", async () => {
    const runId = await start();
    const submitted = await execute(runId, "submit", users[1], {
      receiverUserId: users[2].id,
    });
    expect(await cards(runId)).toEqual({
      [users[1].id]: "已提交",
      [users[2].id]: "待处理",
    });
    const oldTask = await task(runId, "handle");
    await expect(
      caller(users[3]).task.execute({
        taskId: oldTask.id,
        result: { decision: "approved", outcome: "handle" },
      })
    ).rejects.toThrow();
    await caller(users[2]).task.claim({ taskId: oldTask.id });
    const withdrawn = await execute(runId, "withdraw", users[1]);
    expect(await cards(runId)).toEqual({
      [users[1].id]: "已撤回待提交",
      [users[2].id]: "下级已撤回",
    });
    await expect(
      caller(users[2]).task.complete({
        taskId: oldTask.id,
        result: { decision: "approved", outcome: "handle" },
      })
    ).rejects.toThrow();
    const replay: any = await caller(users[1]).task.execute({
      taskId: withdrawn.task.id,
      result: withdrawn.result,
    });
    expect(replay.deduplicated).toBe(true);
    await expect(
      caller(users[1]).task.execute({
        taskId: submitted.task.id,
        result: {
          decision: "approved",
          outcome: "submit",
          receiverUserId: users[3].id,
        },
      })
    ).rejects.toThrow();
    await execute(runId, "submit", users[1], { receiverUserId: users[3].id });
    const nextTask = await task(runId, "handle");
    expect(nextTask.id).not.toBe(oldTask.id);
    expect(parse(nextTask.payloadJson).participantState.relationId).not.toBe(
      parse(oldTask.payloadJson).participantState.relationId
    );
    const handled = await execute(runId, "handle", users[3]);
    expect(handled.response.status).toBe("success");
    expect(await cards(runId)).toEqual({
      [users[1].id]: "已完成",
      [users[2].id]: "下级已撤回",
      [users[3].id]: "已处理",
    });
    const detail: any = await getWorkflowRun(runId);
    expect(detail.stateTransitions).toHaveLength(5);
    expect(parse(detail.stateTransitions[2].payloadJson).changes).toHaveLength(
      2
    );
  }, 30000);

  it("撤回与处理并发只有一个提交成功", async () => {
    const runId = await start();
    await execute(runId, "submit", users[1], { receiverUserId: users[2].id });
    const withdraw = await task(runId, "withdraw");
    const handle = await task(runId, "handle");
    await caller(users[1]).task.claim({ taskId: withdraw.id });
    await caller(users[2]).task.claim({ taskId: handle.id });
    const results = await Promise.allSettled([
      caller(users[1]).task.complete({
        taskId: withdraw.id,
        result: { decision: "approved", outcome: "withdraw" },
      }),
      caller(users[2]).task.complete({
        taskId: handle.id,
        result: { decision: "approved", outcome: "handle" },
      }),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    const detail: any = await getWorkflowRun(runId);
    expect(detail.stateTransitions).toHaveLength(3);
    expect(await cards(runId)).toEqual(
      results[0].status === "fulfilled"
        ? { [users[1].id]: "已撤回待提交", [users[2].id]: "下级已撤回" }
        : { [users[1].id]: "已完成", [users[2].id]: "已处理" }
    );
  }, 30000);

  it("事务中途失败时卡片和任务完成记录一起回滚", async () => {
    const runId = await start();
    const current = await task(runId, "submit");
    await caller(users[1]).task.claim({ taskId: current.id });
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT definitionSnapshotJson FROM workflow_run WHERE id=?",
      [runId]
    );
    const original = parse(rows[0].definitionSnapshotJson);
    const broken = structuredClone(original);
    // Force the late invariant after task/card SQL writes, to exercise transaction rollback.
    broken.edges = broken.edges.filter(
      (edge: any) => !["sent", "pending"].includes(edge.sourceNodeId)
    );
    await pool.query(
      "UPDATE workflow_run SET definitionSnapshotJson=? WHERE id=?",
      [JSON.stringify(broken), runId]
    );
    await expect(
      caller(users[1]).task.complete({
        taskId: current.id,
        result: {
          decision: "approved",
          outcome: "submit",
          receiverUserId: users[2].id,
        },
      })
    ).rejects.toThrow("无可执行操作");
    expect(await cards(runId)).toEqual({ [users[1].id]: "待提交" });
    expect((await task(runId, "submit")).status).toBe("claimed");
    const detail: any = await getWorkflowRun(runId);
    expect(detail.stateTransitions).toHaveLength(1);
    await pool.query(
      "UPDATE workflow_run SET definitionSnapshotJson=? WHERE id=?",
      [JSON.stringify(original), runId]
    );
    await execute(runId, "submit", users[1], { receiverUserId: users[2].id });
  }, 30000);

  it("启动重试不重复创建，草稿修改不改变运行快照，停用接收人被拒绝", async () => {
    const runId = await start();
    const firstTask = await task(runId, "submit");
    await pool.query(
      "UPDATE workflow_run SET status='running',executionLockToken='retry-test' WHERE id=?",
      [runId]
    );
    await initializeParticipantStateRun(runId, "retry-test");
    expect((await task(runId, "submit")).id).toBe(firstTask.id);
    const detail: any = await getWorkflowRun(runId);
    expect(parse(detail.contextJson).vars.source).toBe("test-initial");
    expect(detail.stateTransitions).toHaveLength(1);
    const draft = createParticipantStateExample();
    draft.nodes.find(node => node.id === "sent")!.config.displayName =
      "新草稿状态";
    draft.nodes.find(node => node.id === "sent")!.config.jdmc = "新草稿状态";
    await updateWorkflow(workflowId, users[0] as any, {
      unpublish: true,
      definition: draft,
      expectedDefinitionVersion: await workflowRevisionForTest(workflowId),
    });
    await pool.query("UPDATE users SET status='disabled' WHERE id=?", [
      users[2].id,
    ]);
    try {
      await expect(
        execute(runId, "submit", users[1], { receiverUserId: users[2].id })
      ).rejects.toThrow();
      expect(await cards(runId)).toEqual({ [users[1].id]: "待提交" });
    } finally {
      await pool.query("UPDATE users SET status='active' WHERE id=?", [
        users[2].id,
      ]);
    }
    await execute(runId, "submit", users[1], { receiverUserId: users[2].id });
    expect(await cards(runId)).toEqual({
      [users[1].id]: "已提交",
      [users[2].id]: "待处理",
    });
    const [schedules] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT recipientUserId FROM workflow_task_schedule WHERE runId=? AND eventType='escalation'",
      [runId]
    );
    expect(Number(schedules[0].recipientUserId)).toBe(users[0].id);
    const handle = await task(runId, "handle");
    await caller(users[2]).task.claim({ taskId: handle.id });
    await pool.query("UPDATE users SET status='disabled' WHERE id=?", [
      users[2].id,
    ]);
    try {
      await expect(
        caller(users[2]).task.complete({
          taskId: handle.id,
          result: { decision: "approved", outcome: "handle" },
        })
      ).rejects.toThrow();
    } finally {
      await pool.query("UPDATE users SET status='active' WHERE id=?", [
        users[2].id,
      ]);
    }
  }, 30000);

  it("组合部门深度、主部门和本轮个人结果，经发布与办理入口执行并原子回滚失败", async () => {
    for (let level = 0; level < unitIds.length; level++) {
      await pool.query(
        "INSERT INTO organization_unit (id,code,name,parentUnitId,createdByUserId) VALUES (?,?,?,?,?)",
        [
          unitIds[level],
          unitIds[level],
          `测试部门${level}`,
          unitIds[level - 1] ?? null,
          users[0].id,
        ]
      );
    }
    await pool.query(
      "INSERT INTO organization_membership (id,unitId,userId,isPrimary) VALUES (?,?,?,0)",
      [randomUUID(), unitIds[2], users[2].id]
    );
    const definition = createParticipantStateExample();
    definition.nodes.find(node => node.id === "after-submit")!.config.routes = [
      {
        handle: "sender",
        priority: 100,
        participantCondition: {
          kind: "group",
          match: "all",
          conditions: [
            { kind: "identity", identity: "isInitiator" },
            {
              kind: "data",
              left: "{{participant.results.submit.outcome}}",
              operator: "equals",
              right: "submit",
            },
          ],
        },
      },
      {
        handle: "receiver",
        priority: 50,
        participantCondition: {
          kind: "group",
          match: "all",
          conditions: [
            { kind: "identity", identity: "isInitiator", negate: true },
            {
              kind: "department",
              unitIds: [unitIds[0]],
              minDepth: 2,
              maxDepth: 2,
              membership: "primary",
            },
            {
              kind: "role",
              roleKeys: ["system_admin"],
              match: "any",
              negate: true,
            },
            {
              kind: "data",
              left: `{{participants.${users[1].id}.results.submit.receiverUserId}}`,
              operator: "equals",
              right: "{{participant.userId}}",
            },
          ],
        },
      },
    ];
    await updateWorkflow(workflowId, users[0] as any, {
      definition,
      expectedDefinitionVersion: await workflowRevisionForTest(workflowId),
    });
    await setProjectWorkflowAudit(users[0] as any, {
      ...(await workflowReviewForTest(workflowId)),
      projectId,
      workflowId,
      auditStatus: "approved",
    });
    await updateWorkflow(workflowId, users[0] as any, { publish: true });
    const runId = await start();
    await expect(
      execute(runId, "submit", users[1], { receiverUserId: users[2].id })
    ).rejects.toThrow("未匹配");
    expect(await cards(runId)).toEqual({ [users[1].id]: "待提交" });
    const failed: any = await getWorkflowRun(runId);
    expect(
      parse(failed.contextJson).runtime.participantState.operationResults
    ).toBeUndefined();
    await pool.query(
      "UPDATE organization_membership SET isPrimary=1 WHERE unitId=? AND userId=?",
      [unitIds[2], users[2].id]
    );
    await execute(runId, "submit", users[1], { receiverUserId: users[2].id });
    expect(await cards(runId)).toEqual({
      [users[1].id]: "已提交",
      [users[2].id]: "待处理",
    });
    await execute(runId, "withdraw", users[1]);
    await execute(runId, "submit", users[1], { receiverUserId: users[2].id });
    const resumed: any = await getWorkflowRun(runId);
    const runtime = parse(resumed.contextJson).runtime.participantState;
    expect(
      runtime.operationResults[String(users[1].id)].results.withdraw
    ).toBeUndefined();
    await execute(runId, "handle", users[2]);
    expect((await getWorkflowRun(runId))?.status).toBe("success");
  }, 30000);
  it("多人独立投票保留其他人的待办和期限，新提交轮次隔离旧投票", async () => {
    const definition = createParticipantStateExample();
    definition.nodes.find(
      node => node.id === "start"
    )!.config.initialVariables = {
      reviewers: users.slice(2).map(user => user.id),
    };
    const submit = definition.nodes.find(node => node.id === "submit")!;
    submit.config.assigneeFormField = "vars.reviewers";
    submit.config.formSchema = { fields: [] };
    const handle = definition.nodes.find(node => node.id === "handle")!;
    handle.config.participantOperation = { scope: "all", relation: "none" };
    handle.config.dueAfterSeconds = 7200;
    const completed = {
      kind: "group",
      match: "all",
      conditions: users.slice(2).map(user => ({
        kind: "data",
        left: `{{participants.${user.id}.results.handle.outcome}}`,
        operator: "equals",
        right: "handle",
      })),
    };
    definition.nodes.push({
      id: "voted",
      name: "已投票等待同伴",
      type: "state",
      position: { x: 1200, y: 800 },
      config: {
        nodeDh: "VOTED",
        jdmc: "已投票等待同伴",
        stateType: "business",
      },
    });
    const routes = [
      {
        handle: "completeSender",
        priority: 100,
        roleKeys: ["initiator"],
        participantCondition: completed,
        targetNodeId: "sender-done",
      },
      {
        handle: "completeReceiver",
        priority: 90,
        participantCondition: completed,
        targetNodeId: "receiver-done",
      },
      {
        handle: "voted",
        priority: 80,
        participantCondition: {
          kind: "data",
          left: "{{participant.results.handle.outcome}}",
          operator: "equals",
          right: "handle",
        },
        targetNodeId: "voted",
      },
      {
        handle: "sender",
        priority: 50,
        roleKeys: ["initiator"],
        targetNodeId: "sent",
      },
      { handle: "pending", priority: -1, targetNodeId: "pending" },
    ];
    definition.nodes.find(node => node.id === "after-handle")!.config.routes =
      routes;
    definition.edges = definition.edges.filter(
      edge => edge.sourceNodeId !== "after-handle"
    );
    definition.edges.push(
      ...routes.map(route => ({
        id: `vote-${route.handle}`,
        sourceNodeId: "after-handle",
        sourceHandle: route.handle,
        targetNodeId: route.targetNodeId,
      }))
    );
    await updateWorkflow(workflowId, users[0] as any, {
      unpublish: true,
      definition,
      expectedDefinitionVersion: await workflowRevisionForTest(workflowId),
    });
    await setProjectWorkflowAudit(users[0] as any, {
      ...(await workflowReviewForTest(workflowId)),
      projectId,
      workflowId,
      auditStatus: "approved",
    });
    await updateWorkflow(workflowId, users[0] as any, { publish: true });
    const runId = await start();
    const taskFor = async (userId: number) => {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id,dueAt FROM workflow_task WHERE runId=? AND nodeId='handle' AND assignedUserId=? AND status IN ('pending','claimed')",
        [runId, userId]
      );
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const vote = async (user: any) =>
      caller(user).task.execute({
        taskId: (await taskFor(user.id)).id,
        result: { decision: "approved", outcome: "handle" },
      });
    await execute(runId, "submit", users[1]);
    const otherTask = await taskFor(users[3].id);
    await vote(users[2]);
    expect(await taskFor(users[3].id)).toEqual(otherTask);
    await execute(runId, "withdraw", users[1]);
    await execute(runId, "submit", users[1]);
    await vote(users[3]);
    expect((await getWorkflowRun(runId))?.status).toBe("waiting");
    await vote(users[2]);
    expect((await getWorkflowRun(runId))?.status).toBe("success");

    // More simultaneous transactions than the pool size exercise connection reuse.
    const runs: string[] = [];
    for (let index = 0; index < 24; index++) runs.push(await start());
    await Promise.all(runs.map(id => execute(id, "submit", users[1])));
    expect(
      (await Promise.all(runs.map(cards))).every(
        value => Object.keys(value).length === 3
      )
    ).toBe(true);
  }, 30000);
});
