import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSharedPool } from "./db";
import {
  createWorkflow,
  updateWorkflow,
  compileWorkflowDraft,
  type Definition,
} from "./workflow-service";
import {
  controlWorkflowRun,
  deliverDurableChildTerminal,
  pauseWorkflowRun,
  resumeWorkflowRun,
  signalWorkflowMessage,
  getWorkflowRun,
  markWorkflowRunFailed,
  reconcileDueWorkflowWaits,
  resolveDurableChildFailure,
  submitWorkflowRun,
} from "./workflow-engine";
import { drainWorkflowJobs, stopWorkflowWorker } from "./workflow-worker";
import { claimWorkflowTask, completeWorkflowTask } from "./p1-service";
import {
  readDurableRunLinks,
  redactHiddenChildReferences,
} from "./durable-subflow-runtime";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type Actor = { id: number; role: "admin" | "user" };
const workflows: string[] = [];
const users: number[] = [];
let actor: Actor, viewer: Actor, childId: string, childVersion: number;
const pool = () => getSharedPool();
const facts = async (sql: string, args: unknown[]) =>
  (await pool().query<mysql.RowDataPacket[]>(sql, args))[0];
const links = (id: string) =>
  facts(
    "SELECT * FROM workflow_run_link WHERE parentRunId=? ORDER BY callOrdinal",
    [id]
  );

function line(
  items: [
    string,
    Definition["nodes"][number]["type"],
    Record<string, unknown>,
  ][]
): Definition {
  return {
    schemaVersion: 1,
    settings: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: items.map(([id, type, config], i) => ({
      id,
      type,
      config,
      name: id,
      position: { x: i * 240, y: 0 },
    })),
    edges: items.slice(1).map(([id], i) => ({
      id: "e" + i,
      sourceNodeId: items[i][0],
      targetNodeId: id,
      sourceHandle: items[i][1] === "operate" ? "approved" : "default",
    })),
  };
}
function childGraph(version: string) {
  return line([
    ["start", "start", {}],
    [
      "approval",
      "operate",
      {
        nodeDh: "REV",
        czmc: "批准测试",
        assigneeMode: "user",
        assigneeUserId: actor.id,
        bdcz: { hqhqsz: "", hqtgbfb: 100 },
      },
    ],
    [
      "end",
      "end",
      { resultTemplate: { version, receipt: "{{input.receipt}}" } },
    ],
  ]);
}
function parentGraph(options: Record<string, unknown> = {}) {
  return line([
    ["start", "start", {}],
    [
      "call",
      "subflow",
      {
        executionMode: "durable_child",
        subflowId: childId,
        input: "{{input}}",
        ...options,
      },
    ],
    ["end", "end", { resultTemplate: "{{nodes.call}}" }],
  ]);
}
async function publish(name: string, definition: Definition) {
  const draft = await createWorkflow(
    actor,
    name + randomUUID().slice(0, 8),
    undefined,
    { flowType: "control", definition }
  );
  workflows.push(draft.id);
  const published = await updateWorkflow(draft.id, actor, {
    publish: true,
    expectedDefinitionVersion: Number(draft.definitionVersion),
  });
  if (!published) throw Error("fixture publication failed");
  return published;
}
async function newUser(role: "admin" | "user") {
  const name = "g02_" + randomUUID().slice(0, 12);
  const [r] = await pool().query<mysql.ResultSetHeader>(
    "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,'active','internal',NOW())",
    [name, name, name, role]
  );
  users.push(r.insertId);
  return { id: r.insertId, role };
}
function caller(user: Actor) {
  return appRouter.createCaller({
    user,
    req: { headers: {}, protocol: "https" },
    res: {},
  } as unknown as TrpcContext);
}
async function waiting(options: Record<string, unknown> = {}) {
  const parent = await publish("parent", parentGraph(options));
  const r = await submitWorkflowRun({
    workflowId: parent.id,
    triggeredBy: actor,
    workflowInput: { receipt: "测试回执" },
    idempotencyKey: randomUUID(),
  });
  await drainWorkflowJobs(15);
  const [link] = await links(r.runId);
  expect(link).toBeDefined();
  expect((await getWorkflowRun(r.runId))?.status).toBe("waiting");
  return { parentId: parent.id, runId: r.runId, link };
}
async function approve(runId: string) {
  const [task] = await facts(
    "SELECT id FROM workflow_task WHERE runId=? AND status='pending'",
    [runId]
  );
  expect(task).toBeDefined();
  await claimWorkflowTask(actor, task.id);
  await completeWorkflowTask(actor, task.id, {
    decision: "approved",
    comment: "验收通过",
  });
}

describe("published durable child workflow", () => {
  beforeAll(async () => {
    actor = await newUser("admin");
    viewer = await newUser("user");
    const child = await publish("child", childGraph("first"));
    childId = child.id;
    childVersion = Number(child.definitionVersion);
  }, 30_000);
  afterAll(async () => {
    await stopWorkflowWorker();
    if (workflows.length) {
      const ids = workflows;
      for (const table of [
        "workflow_task_schedule",
        "workflow_task",
        "workflow_task_group",
        "workflow_wait_subscription",
        "workflow_participant_state",
        "workflow_run_alert",
        "workflow_state_transition",
        "workflow_milestone",
      ])
        await pool().query(
          "DELETE FROM " + table + " WHERE workflowId IN (?)",
          [ids]
        );
      await pool().query(
        "DELETE e FROM workflow_outbox_event e JOIN workflow_run r ON r.id=e.aggregateId WHERE r.workflowId IN (?)",
        [ids]
      );
      await pool().query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId IN (?)",
        [ids]
      );
      for (const table of [
        "workflow_run",
        "workflow_member",
        "workflow_version",
      ])
        await pool().query(
          "DELETE FROM " + table + " WHERE workflowId IN (?)",
          [ids]
        );
      await pool().query("DELETE FROM workflow WHERE id IN (?)", [ids]);
    }
    if (users.length) {
      await pool().query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [users, users]
      );
      await pool().query("DELETE FROM users WHERE id IN (?)", [users]);
    }
  }, 30_000);

  it("keeps the published child version across a newer publication, a post-commit worker crash and duplicate settlement", async () => {
    const parent = await publish("crash-parent", parentGraph());
    const submission = await submitWorkflowRun({
      workflowId: parent.id,
      triggeredBy: actor,
      workflowInput: { receipt: "固定版本" },
    });
    process.env.WORKFLOW_WORKER_FAULT_POINT =
      "after_wait_commit_before_checkpoint";
    try {
      await expect(drainWorkflowJobs(1)).rejects.toThrow(
        "Injected workflow execution crash"
      );
    } finally {
      delete process.env.WORKFLOW_WORKER_FAULT_POINT;
    }
    const [link] = await links(submission.runId);
    expect((await getWorkflowRun(submission.runId))?.status).toBe("waiting");
    expect((await getWorkflowRun(link.childRunId))?.status).toBe("queued");
    expect(
      (
        await facts("SELECT status FROM workflow_run_job WHERE runId=?", [
          submission.runId,
        ])
      ).map(r => r.status)
    ).toEqual(["completed"]);
    await stopWorkflowWorker();
    await drainWorkflowJobs(10);
    const recovered = await links(submission.runId);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].childRunId).toBe(link.childRunId);
    const draft = await updateWorkflow(childId, actor, {
      unpublish: true,
      expectedDefinitionVersion: childVersion,
    });
    const updated = await updateWorkflow(childId, actor, {
      definition: childGraph("second"),
      expectedDefinitionVersion: Number(draft!.definitionVersion),
    });
    await updateWorkflow(childId, actor, {
      publish: true,
      expectedDefinitionVersion: Number(updated!.definitionVersion),
    });
    await approve(link.childRunId);
    await drainWorkflowJobs(20);
    await Promise.all([
      reconcileDueWorkflowWaits(),
      reconcileDueWorkflowWaits(),
    ]);
    const events = await facts(
      "SELECT id FROM workflow_outbox_event WHERE eventType='workflow.child.terminal' AND aggregateId=?",
      [link.childRunId]
    );
    expect(events).toHaveLength(1);
    expect(
      await deliverDurableChildTerminal(link.waitId, link.childRunId)
    ).toBe(false);
    const finished = await getWorkflowRun(submission.runId);
    expect(finished?.status).toBe("success");
    expect(finished?.finalOutputJson).toMatchObject({
      result: {
        status: "success",
        result: { version: "first", receipt: "固定版本" },
      },
    });
    expect((await links(submission.runId))[0]).toMatchObject({
      state: "resumed",
      childVersion,
    });
    expect(
      await facts(
        "SELECT id FROM workflow_run_job WHERE runId=? AND jobType='resume'",
        [submission.runId]
      )
    ).toHaveLength(1);
    const replay = await submitWorkflowRun({
      workflowId: parent.id,
      triggeredBy: actor,
    });
    await drainWorkflowJobs(10);
    const [old] = await links(replay.runId);
    expect(old.childVersion).toBe(childVersion);
    await controlWorkflowRun({ runId: replay.runId, action: "cancel" });
    expect((await getWorkflowRun(old.childRunId))?.status).toBe("cancelled");
  }, 60_000);

  it("checks each side independently and strips the hidden binding from parent run projections", async () => {
    const { parentId, runId, link } = await waiting();
    await pool().query(
      "INSERT INTO workflow_member (id,workflowId,userId,role) VALUES (?,?,?,'viewer')",
      [randomUUID(), parentId, viewer.id]
    );
    expect(await readDurableRunLinks(runId, viewer)).toEqual([]);
    const view = await caller(viewer).workflow.runDetail({ runId });
    expect(view.childLinks).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(childId);
    expect(JSON.stringify(view)).not.toContain(link.childRunId);
    await expect(
      caller(viewer).workflow.runDetail({ runId: link.childRunId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await redactHiddenChildReferences(
        { definitionSnapshotJson: parentGraph() },
        actor
      )
    ).toMatchObject({ definitionSnapshotJson: { nodes: expect.any(Array) } });
    await pool().query(
      "UPDATE workflow_member SET workflowId=? WHERE workflowId=? AND userId=?",
      [childId, parentId, viewer.id]
    );
    expect(
      (await caller(viewer).workflow.runDetail({ runId: link.childRunId }))
        .childLinks
    ).toEqual([]);
    const visible = await readDurableRunLinks(runId, actor);
    expect(visible[0]).toMatchObject({
      runId: link.childRunId,
      workflowId: childId,
      direction: "child",
    });
    await controlWorkflowRun({ runId, action: "cancel" });
  }, 30_000);

  it("applies failure policies, creates one retry with the pinned input, and resumes an explicitly accepted failure once", async () => {
    for (const policy of [
      "fail_parent",
      "retry_once",
      "manual",
      "return_result",
    ]) {
      const { runId, link } = await waiting({ failurePolicy: policy });
      await markWorkflowRunFailed(link.childRunId, Error("受控子失败"));
      await drainWorkflowJobs(10);
      if (policy === "retry_once") {
        const attempts = await links(runId);
        expect(attempts).toHaveLength(2);
        expect(attempts[0].state).toBe("retrying");
        expect(
          await deliverDurableChildTerminal(
            attempts[0].waitId,
            attempts[0].childRunId
          )
        ).toBe(false);
        expect(attempts[1].planHash).toBe(attempts[0].planHash);
        await markWorkflowRunFailed(
          attempts[1].childRunId,
          Error("受控二次失败")
        );
        await drainWorkflowJobs(10);
      }
      if (policy === "manual") {
        expect((await links(runId))[0].state).toBe("manual");
        await expect(
          resolveDurableChildFailure(viewer, link.id, "accept_failure")
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(
          (await resolveDurableChildFailure(actor, link.id, "accept_failure"))
            .changed
        ).toBe(true);
        expect(
          (await resolveDurableChildFailure(actor, link.id, "accept_failure"))
            .changed
        ).toBe(false);
        await drainWorkflowJobs(8);
      }
      const finished = await getWorkflowRun(runId);
      if (policy === "fail_parent" || policy === "retry_once")
        expect(finished).toMatchObject({
          status: "failed",
          endReason: "child_failed",
        });
      else
        expect(finished?.finalOutputJson).toMatchObject({
          result: { status: "failed", result: null },
        });
    }
  }, 80_000);

  it("settles concurrent parent cancellation and child completion and retains an explicitly detached child", async () => {
    for (let race = 0; race < 5; race++) {
      const { runId, link } = await waiting();
      await approve(link.childRunId);
      await Promise.all([
        controlWorkflowRun({ runId, action: "cancel" }),
        drainWorkflowJobs(10),
      ]);
      await drainWorkflowJobs(10);
      expect((await getWorkflowRun(runId))?.status).toBe("cancelled");
      expect(["cancelled", "success"]).toContain(
        (await getWorkflowRun(link.childRunId))?.status
      );
      expect(
        await facts(
          "SELECT id FROM workflow_run_job WHERE runId=? AND status IN ('queued','leased')",
          [runId]
        )
      ).toHaveLength(0);
    }
    const detached = await waiting({ cancelPolicy: "detach" });
    await controlWorkflowRun({ runId: detached.runId, action: "terminate" });
    expect((await links(detached.runId))[0].state).toBe("detached");
    await approve(detached.link.childRunId);
    await drainWorkflowJobs(10);
    expect((await getWorkflowRun(detached.link.childRunId))?.status).toBe(
      "success"
    );
  }, 40_000);

  it("rejects a cycle and second-level target with a located compile diagnostic", async () => {
    const parent = await publish("one-level", parentGraph());
    for (const target of [parent.id, childId]) {
      const draft = await compileWorkflowDraft(
        target,
        actor,
        parentGraph({ subflowId: parent.id })
      );
      expect(draft).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "WF_DURABLE_SUBFLOW_TARGET",
            location: { nodeId: "call", field: "config.subflowId" },
          },
        ],
      });
    }
  }, 25_000);

  it("preserves a child's terminal fact while its parent is paused", async () => {
    const { runId, link } = await waiting();
    expect((await pauseWorkflowRun(runId))?.status).toBe("blocked");
    await approve(link.childRunId);
    await drainWorkflowJobs(10);
    expect((await getWorkflowRun(link.childRunId))?.status).toBe("success");
    expect((await getWorkflowRun(runId))?.status).toBe("blocked");
    await resumeWorkflowRun(runId);
    await drainWorkflowJobs(10);
    expect((await getWorkflowRun(runId))?.status).toBe("success");
    expect(
      await facts(
        "SELECT id FROM workflow_run_job WHERE runId=? AND jobType='resume'",
        [runId]
      )
    ).toHaveLength(1);
  }, 30_000);
  it("rechecks both call grants before creating the child or its start job", async () => {
    const parent = await publish("granted-then-revoked", parentGraph());
    await pool().query(
      "INSERT INTO workflow_member (id,workflowId,userId,role) VALUES (?,?,?,'operator'),(?,?,?,'operator')",
      [randomUUID(), parent.id, viewer.id, randomUUID(), childId, viewer.id]
    );
    const run = await caller(viewer).workflow.run({
      workflowId: parent.id,
      idempotencyKey: randomUUID(),
    });
    await pool().query(
      "UPDATE workflow_member SET revokedAt=NOW() WHERE workflowId=? AND userId=? AND role='operator'",
      [childId, viewer.id]
    );
    for (let i = 0; i < 3; i++) {
      await pool().query(
        "UPDATE workflow_run_job SET availableAt=NOW() WHERE runId=? AND status='queued'",
        [run.runId]
      );
      await drainWorkflowJobs(2);
    }
    expect((await getWorkflowRun(run.runId))?.status).toBe("failed");
    expect(await links(run.runId)).toHaveLength(0);
    expect(
      await facts(
        "SELECT id FROM workflow_wait_subscription WHERE runId=? AND waitType='child'",
        [run.runId]
      )
    ).toHaveLength(0);
  }, 30_000);

  it("stops new admissions while preserving an in-flight parent and its existing receipt", async () => {
    const parent = await publish("gate", parentGraph());
    const key = randomUUID();
    const run = await submitWorkflowRun({
      workflowId: parent.id,
      triggeredBy: actor,
      idempotencyKey: key,
    });
    const previous = process.env.FLOW_DURABLE_SUBFLOW_ADMISSION;
    try {
      process.env.FLOW_DURABLE_SUBFLOW_ADMISSION = "false";
      expect(
        (
          await submitWorkflowRun({
            workflowId: parent.id,
            triggeredBy: actor,
            idempotencyKey: key,
          })
        ).runId
      ).toBe(run.runId);
      await expect(
        submitWorkflowRun({
          workflowId: parent.id,
          triggeredBy: actor,
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow("暂停");
      await drainWorkflowJobs(10);
      const [link] = await links(run.runId);
      await approve(link.childRunId);
      await drainWorkflowJobs(10);
      expect((await getWorkflowRun(run.runId))?.status).toBe("success");
    } finally {
      if (previous === undefined)
        delete process.env.FLOW_DURABLE_SUBFLOW_ADMISSION;
      else process.env.FLOW_DURABLE_SUBFLOW_ADMISSION = previous;
    }
  }, 30_000);

  it("waits for two parallel message children in either completion order and joins once", async () => {
    const child = await publish(
      "message-child",
      line([
        ["start", "start", {}],
        [
          "external",
          "message_catch",
          { messageName: "sample.done", correlationKey: "{{input.receipt}}" },
        ],
        ["end", "end", { resultTemplate: "{{nodes.external.payload.value}}" }],
      ])
    );
    const branches = ["left", "right", "fallback"];
    const definition: Definition = {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "start",
          type: "start",
          name: "开始",
          config: {},
          position: { x: 0, y: 0 },
        },
        {
          id: "router",
          type: "router",
          name: "并行",
          position: { x: 160, y: 0 },
          config: {
            broadcast: true,
            parallelJoinNodeId: "end",
            defaultRoute: "fallback",
            routes: branches.map((id, i) => ({
              handle: id,
              label: id,
              priority: id === "fallback" ? -1 : 10 - i,
              targetNodeId: id,
              ...(id === "fallback"
                ? {}
                : {
                    condition: {
                      left: "{{input.count}}",
                      operator: "greaterThan",
                      right: 0,
                    },
                  }),
            })),
          },
        },
        ...branches.map((id, i) => ({
          id,
          type: "subflow" as const,
          name: id,
          position: { x: 320, y: i * 140 },
          config: {
            executionMode: "durable_child",
            subflowId: child.id,
            input: { receipt: id },
          },
        })),
        {
          id: "end",
          type: "end",
          name: "汇聚",
          position: { x: 640, y: 0 },
          config: {
            parallelForNodeId: "router",
            resultTemplate: {
              left: "{{nodes.left.result}}",
              right: "{{nodes.right.result}}",
            },
          },
        },
      ],
      edges: [
        { id: "start-router", sourceNodeId: "start", targetNodeId: "router" },
        ...branches.flatMap(id => [
          {
            id: "to-" + id,
            sourceNodeId: "router",
            targetNodeId: id,
            sourceHandle: id,
          },
          {
            id: "from-" + id,
            sourceNodeId: id,
            targetNodeId: "end",
            sourceHandle: "default",
          },
        ]),
      ],
    };
    const parent = await publish("parallel-parent", definition);
    const run = await submitWorkflowRun({
      workflowId: parent.id,
      triggeredBy: actor,
      workflowInput: { count: 2 },
    });
    await drainWorkflowJobs(15);
    const opened = await links(run.runId);
    expect(opened.map(l => l.nodeId).sort()).toEqual(["left", "right"]);
    for (const nodeId of ["right", "left"]) {
      const link = opened.find(l => l.nodeId === nodeId)!;
      await signalWorkflowMessage({
        runId: link.childRunId,
        messageName: "sample.done",
        correlationKey: nodeId,
        payload: { value: nodeId },
      });
      await drainWorkflowJobs(15);
      if (nodeId === "right")
        expect((await getWorkflowRun(run.runId))?.status).toBe("waiting");
    }
    const complete = await getWorkflowRun(run.runId);
    expect(complete?.finalOutputJson).toMatchObject({
      result: { left: "left", right: "right" },
    });
    expect(
      complete?.nodeRuns.filter(
        item => item.nodeId === "end" && item.status === "success"
      )
    ).toHaveLength(1);
    expect(
      (await links(run.runId)).every(item => item.state === "resumed")
    ).toBe(true);
  }, 35_000);
});
