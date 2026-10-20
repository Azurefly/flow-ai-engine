import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    // Fixture writes explicitly submit the revision just inspected; callers may supply an older revision to test conflicts.

    // Fixture maintenance supplies its inspected review baseline; explicit stale baselines are preserved.
    if (["project.auditWorkflow", "project.resetWorkflowAudit"].includes(path) && input?.workflowId && input.expectedDefinitionVersion === undefined && input.expectedAuditStatus === undefined) {
      const current = await this.request("workflow.get", { id: input.workflowId });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion), expectedAuditStatus: current.auditStatus };
    }
if (["workflow.update", "workflow.publish", "workflow.unpublish"].includes(path) && input?.id && input.expectedDefinitionVersion === undefined) {
      const current = await this.request("workflow.get", { id: input.id });
      input = { ...input, expectedDefinitionVersion: Number(current.definitionVersion) };
    }

    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body } : {}),
      }
    );
    const nextCookie = response.headers.getSetCookie()[0];
    if (nextCookie) this.cookie = nextCookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        `${path}: ${payload.error?.json?.message ?? response.status}`
      );
    return superjson.deserialize(payload.result.data);
  }
}
const admin = new Session();
assert(
  process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  "Missing existing login configuration"
);
await admin.request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
const actor = await admin.request("auth.me", null);
const read = value => (typeof value === "string" ? JSON.parse(value) : value);
const stage = process.env.FLOW_SHARED_SIGN_STAGE ?? "normal";
assert(["normal", "legacy_prepare", "legacy_resume"].includes(stage));
const node = (id, type, config = {}, x = 0, y = 0) => ({
  id,
  type,
  name: id,
  config,
  position: { x, y },
});
const edge = (sourceNodeId, targetNodeId, sourceHandle) => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  ...(sourceHandle ? { sourceHandle } : {}),
});
async function waitFor(runId, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (accept(run)) return run;
    assert(
      !["failed", "cancelled", "terminated"].includes(run.status),
      `${label}: ${JSON.stringify(run.errorJson)}`
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const taskBranch = task =>
  task.payload.config.formSchema.fields.find(field => field.key === "branch")
    .defaultValue;
const taskList = async (session, projectId, runId, view = "todo") =>
  (await session.request("task.list", { projectId, view, limit: 200 })).filter(
    task => task.runId === runId
  );
const execute = (session, task) =>
  session.request(
    "task.execute",
    {
      taskId: task.id,
      result: {
        decision: "approved",
        outcome: "approved",
        branch: taskBranch(task),
        comment: "隔离并行签署验收",
      },
    },
    true
  );
function definition(flowType, signMode, users, legacy = false) {
  const approve = {
    nodeDh: "REVIEW",
    czmc: "并行审批",
    instruction: "请审核本分支业务数据。",
    ...(legacy || signMode === "single"
      ? { assigneeMode: "user", assigneeUserId: users[0] }
      : { assigneeMode: "form_user", assigneeFormField: "input.approvers" }),
    formSchema: {
      fields: [
        {
          key: "branch",
          label: "业务分支",
          type: "text",
          readOnly: true,
          defaultValue: "{{vars.a.marker}}{{vars.b.marker}}",
        },
      ],
    },
    bdcz: { hqhqsz: signMode === "single" ? "" : signMode, hqtgbfb: 100 },
  };
  const nodes = [
    node("start", "start"),
    node(
      "router",
      "router",
      {
        nodeDh: "R1",
        lymc: "并行分流",
        gbms: true,
        parallelJoinNodeId: "join",
        defaultRoute: "a",
        routes: ["a", "b"].map(target => ({
          handle: target,
          label: target,
          targetNodeId: target,
          conditions: [],
        })),
      },
      250
    ),
    node("a", "transform", { mappings: { marker: "A" } }, 500, -100),
    node("b", "transform", { mappings: { marker: "B" } }, 500, 100),
    node(
      "aDone",
      "transform",
      {
        mappings: {
          value: `{{vars.${legacy ? "aReview" : "shared"}.result.branch}}`,
          otherSeen: "{{vars.b.marker}}",
        },
      },
      1250,
      -100
    ),
    node(
      "bDone",
      "transform",
      {
        mappings: {
          value: `{{vars.${legacy ? "bReview" : "shared"}.result.branch}}`,
          otherSeen: "{{vars.a.marker}}",
        },
      },
      1250,
      100
    ),
    node(
      "join",
      "transform",
      {
        parallelForNodeId: "router",
        mappings: { a: "{{vars.aDone.value}}", b: "{{vars.bDone.value}}" },
      },
      1500
    ),
    node("end", "end", { resultTemplate: "{{vars.join}}" }, 2000),
  ];
  const edges = [
    edge("start", "router"),
    edge("router", "a", "a"),
    edge("router", "b", "b"),
    edge("aDone", "join"),
    edge("bDone", "join"),
    edge("join", "end"),
  ];
  if (legacy) {
    nodes.push(
      node("aReview", "operate", approve, 750, -100),
      node("bReview", "operate", approve, 750, 100)
    );
    edges.push(
      edge("a", "aReview"),
      edge("b", "bReview"),
      edge("aReview", "aDone", "approved"),
      edge("bReview", "bDone", "approved")
    );
  } else {
    nodes.push(
      node("shared", "operate", approve, 750),
      node(
        "dispatch",
        "router",
        {
          nodeDh: "R2",
          lymc: "继续本分支",
          defaultRoute: "b",
          routes: ["a", "b"].map(branch => ({
            handle: branch,
            label: branch,
            targetNodeId: `${branch}Done`,
            conditions: [
              {
                left: "{{vars.shared.result.branch}}",
                operator: "equals",
                right: branch.toUpperCase(),
              },
            ],
          })),
        },
        1000
      )
    );
    edges.push(
      edge("a", "shared"),
      edge("b", "shared"),
      edge("shared", "dispatch", "approved"),
      edge("dispatch", "aDone", "a"),
      edge("dispatch", "bDone", "b")
    );
  }
  if (flowType === "state") {
    nodes.push(
      node(
        "pending",
        "state",
        { stateCode: "PENDING", displayName: "待审批", stateType: "business" },
        120
      ),
      node(
        "done",
        "state",
        { stateCode: "DONE", displayName: "审批完成", stateType: "business" },
        1750
      )
    );
    edges.find(item => item.sourceNodeId === "start").targetNodeId = "pending";
    edges.push(edge("pending", "router"));
    edges.find(item => item.sourceNodeId === "join").targetNodeId = "done";
    edges.push(edge("done", "end"));
  }
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes,
    edges,
  };
}
async function create(
  project,
  name,
  flowType,
  signMode,
  users,
  legacy = false
) {
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name,
      flowType,
      definition: definition(flowType, signMode, users, legacy),
    },
    true
  );
  await admin.request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
    true
  );
  await admin.request("workflow.publish", { id: workflow.id }, true);
  return workflow;
}
function assertResult(run, flowType, shared = true) {
  assert.equal(run.executionSource, "published_plan");
  const outputs = id =>
    run.nodeRuns
      .filter(item => item.nodeId === id && item.status === "success")
      .map(item => read(item.outputJson));
  if (shared) assert.equal(outputs("shared").length, 2);
  assert.deepEqual(outputs("aDone"), [{ value: "A" }]);
  assert.deepEqual(outputs("bDone"), [{ value: "B" }]);
  assert.deepEqual(outputs("join"), [{ a: "A", b: "B" }]);
  assert.equal(outputs("end").length, 1);
  if (flowType === "state") {
    assert.equal(run.currentStateCode, "DONE");
    assert.equal(run.stateVersion, 2);
  }
}
if (stage !== "normal") {
  let workflow, projectId, runId;
  if (stage === "legacy_prepare") {
    const tag = randomBytes(4).toString("hex");
    const project = await admin.request(
      "project.create",
      { code: `LEGSIGN_${tag}`.toUpperCase(), name: `旧审批组验证_${tag}` },
      true
    );
    workflow = await create(
      project,
      `旧审批组兼容_${tag}`,
      "control",
      "andSignFor",
      [actor.id],
      true
    );
    projectId = project.id;
    ({ runId } = await admin.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        triggerType: "manual",
        idempotencyKey: `legacy-sign-${tag}`,
      },
      true
    ));
  } else {
    assert(
      process.env.FLOW_SHARED_SIGN_WORKFLOW_ID &&
        process.env.FLOW_SHARED_SIGN_RUN_ID
    );
    workflow = await admin.request("workflow.get", {
      id: process.env.FLOW_SHARED_SIGN_WORKFLOW_ID,
    });
    assert(/^旧审批组兼容_[a-f0-9]{8}$/.test(workflow.name));
    assert.equal(workflow.ownerUserId, actor.id);
    projectId = workflow.projectId;
    runId = process.env.FLOW_SHARED_SIGN_RUN_ID;
  }
  let complete = false;
  try {
    const waiting = await waitFor(
      runId,
      run =>
        run.status === "waiting" &&
        run.nodeRuns.filter(
          item =>
            item.status === "waiting" &&
            ["aReview", "bReview"].includes(item.nodeId)
        ).length === 2,
      "legacy approval groups"
    );
    assert.equal(waiting.workflowId, workflow.id);
    assert.equal(
      read(waiting.nodeRuns.find(item => item.nodeId === "start").inputJson)
        .context.runtime.durableTaskVersion,
      undefined
    );
    const tasks = await taskList(admin, projectId, runId);
    assert.equal(tasks.length, 2);
    if (stage === "legacy_prepare") {
      complete = true;
      console.log(
        JSON.stringify({
          stage,
          projectId,
          workflowId: workflow.id,
          runId,
          waitingGroups: 2,
        })
      );
    } else {
      assert(tasks.every(task => task.executionKey === "legacy"));
      for (const task of tasks) await execute(admin, task);
      const result = await waitFor(
        runId,
        run => run.status === "success",
        "legacy group continuation"
      );
      assertResult(result, "control", false);
      complete = true;
      console.log(
        JSON.stringify({
          stage,
          workflowId: workflow.id,
          runId,
          legacySnapshot: true,
          joinCount: 1,
          status: result.status,
        })
      );
    }
  } finally {
    if (!complete)
      await admin
        .request(
          "workflow.cancelRun",
          { runId, reason: "旧审批组隔离验收清理" },
          true
        )
        .catch(() => {});
  }
} else {
  const tag = randomBytes(4).toString("hex");
  const people = [],
    grants = [];
  try {
    for (let index = 0; index < 3; index++) {
      const username = `shared_sign_${tag}_${index}`;
      const password = `Test9_${randomBytes(24).toString("base64url")}`;
      const { userId } = await admin.request(
        "iam.createUser",
        {
          username,
          name: `共享签署验收_${tag}_${index}`,
          password,
          role: "user",
        },
        true
      );
      const session = new Session();
      people.push({ id: userId, session });
      await session.request("auth.login", { username, password }, true);
    }
    const project = await admin.request(
      "project.create",
      { code: `SHSIGN_${tag}`.toUpperCase(), name: `共享签署验证_${tag}` },
      true
    );
    for (const flowType of ["control", "state"])
      for (const signMode of [
        "single",
        "orSignFor",
        "andSignFor",
        "sequentialSignFor",
      ]) {
        const workflow = await create(
          project,
          `共享签署_${flowType}_${signMode}_${tag}`,
          flowType,
          signMode,
          people.map(person => person.id)
        );
        for (const person of people) {
          await admin.request(
            "workflow.grantMember",
            { workflowId: workflow.id, userId: person.id, role: "operator" },
            true
          );
          grants.push({ workflowId: workflow.id, userId: person.id });
        }
        const { runId } = await admin.request(
          "workflow.run",
          {
            workflowId: workflow.id,
            triggerType: "manual",
            input: { approvers: people.slice(0, 2).map(person => person.id) },
            idempotencyKey: `sign-${flowType}-${signMode}-${tag}`,
          },
          true
        );
        console.log(
          JSON.stringify({
            stage: "created",
            workflowId: workflow.id,
            runId,
            flowType,
            signMode,
          })
        );
        let complete = false;
        try {
          const waiting = await waitFor(
            runId,
            run =>
              run.status === "waiting" &&
              run.nodeRuns.filter(
                item => item.nodeId === "shared" && item.status === "waiting"
              ).length === 2,
            "shared signing nodes"
          );
          assert.equal(
            read(
              waiting.nodeRuns.find(item => item.nodeId === "start").inputJson
            ).context.runtime.durableTaskVersion,
            1
          );
          const first = await taskList(people[0].session, project.id, runId);
          assert.equal(first.length, 2);
          assert.equal(new Set(first.map(task => task.executionKey)).size, 2);
          const a = first.find(task => taskBranch(task) === "A"),
            b = first.find(task => taskBranch(task) === "B");
          assert(a && b);
          let second = await taskList(people[1].session, project.id, runId);
          if (signMode === "single") {
            assert.equal(second.length, 0);
            await assert.rejects(
              () => execute(people[1].session, a),
              /无|不存在|领取|处理人/
            );
          } else {
            assert.equal(second.length, 2);
            assert.equal(
              new Set(first.map(task => task.approvalGroupId)).size,
              2
            );
            await assert.rejects(
              () =>
                execute(
                  people[0].session,
                  second.find(task => taskBranch(task) === "A")
                ),
              /无|不存在|领取|处理人/
            );
          }
          if (signMode === "andSignFor") {
            for (const task of first)
              await people[0].session.request(
                "task.addSigner",
                {
                  taskId: task.id,
                  targetUserId: people[2].id,
                  memberVersion: 0,
                },
                true
              );
            const added = await taskList(people[2].session, project.id, runId);
            assert.equal(added.length, 2);
            assert.deepEqual(
              new Set(added.map(task => task.executionKey)),
              new Set(first.map(task => task.executionKey))
            );
            for (const task of first) {
              const detail = await people[0].session.request("task.get", {
                taskId: task.id,
              });
              assert.equal(detail.memberVersion, 1);
              assert.equal(detail.approvalProgress.required, 3);
            }
          }
          const secondA = second.find(task => taskBranch(task) === "A"),
            secondB = second.find(task => taskBranch(task) === "B");
          if (signMode === "sequentialSignFor")
            await assert.rejects(
              () => execute(people[1].session, secondA),
              /顺序|轮到|操作权/
            );
          await execute(people[0].session, a);
          await assert.rejects(
            () => execute(people[0].session, a),
            /已|状态|任务|操作/
          );
          if (signMode === "andSignFor") {
            const addedA = (
              await taskList(people[2].session, project.id, runId)
            ).find(task => taskBranch(task) === "A");
            const detail = await people[0].session.request("task.get", {
              taskId: a.id,
            });
            assert.equal(detail.approvalProgress.approved, 1);
            await Promise.all([
              execute(people[1].session, secondA),
              execute(people[2].session, addedA),
            ]);
          } else if (signMode === "sequentialSignFor") {
            await assert.rejects(
              () => execute(people[1].session, secondB),
              /顺序|轮到|操作权/
            );
            await execute(people[1].session, secondA);
          } else if (signMode === "orSignFor") {
            assert.equal(
              (
                await people[1].session.request("task.get", {
                  taskId: secondA.id,
                })
              ).status,
              "cancelled"
            );
          }
          await waitFor(
            runId,
            run =>
              run.status === "waiting" &&
              run.nodeRuns.some(
                item => item.nodeId === "aDone" && item.status === "success"
              ),
            "first approval branch completed"
          );
          const pendingB = await people[0].session.request("task.get", {
            taskId: b.id,
          });
          assert.equal(pendingB.status, "pending");
          if (pendingB.approvalProgress)
            assert.equal(pendingB.approvalProgress.approved, 0);
          if (signMode === "orSignFor")
            await execute(people[1].session, secondB);
          else {
            await execute(people[0].session, b);
            if (signMode === "andSignFor") {
              const addedB = (
                await taskList(people[2].session, project.id, runId)
              ).find(task => taskBranch(task) === "B");
              await Promise.all([
                execute(people[1].session, secondB),
                execute(people[2].session, addedB),
              ]);
            } else if (signMode === "sequentialSignFor")
              await execute(people[1].session, secondB);
          }
          const result = await waitFor(
            runId,
            run => run.status === "success",
            "shared signing join"
          );
          assertResult(result, flowType);
          complete = true;
          console.log(
            JSON.stringify({
              workflowId: workflow.id,
              runId,
              flowType,
              signMode,
              sharedTasks: 2,
              groupIsolation: true,
              normalUsersHandled: true,
              wrongOwnerDenied: true,
              duplicateDenied: true,
              dynamicSigners: signMode === "andSignFor",
              joinCount: 1,
              status: result.status,
            })
          );
        } finally {
          if (!complete)
            await admin
              .request(
                "workflow.cancelRun",
                { runId, reason: "共享签署隔离验收清理" },
                true
              )
              .catch(() => {});
        }
      }
  } finally {
    const cleanupFailures = [];
    for (const grant of grants)
      await admin
        .request("workflow.revokeMember", { ...grant, role: "operator" }, true)
        .catch(error => cleanupFailures.push(error.message));
    for (const person of people)
      await admin
        .request(
          "iam.updateUserStatus",
          { userId: person.id, status: "disabled" },
          true
        )
        .catch(error => cleanupFailures.push(error.message));
    assert.equal(cleanupFailures.length, 0, cleanupFailures.join("\n"));
    console.log(
      JSON.stringify({ ownGrantsRevoked: true, ownAccountsDisabled: true })
    );
  }
}
