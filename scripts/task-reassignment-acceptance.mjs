import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

// Only the user's designated remote instance is used for real acceptance.
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
        signal: AbortSignal.timeout(30000),
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
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
);
await admin.request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
const stage = process.env.FLOW_REASSIGN_STAGE ?? "normal";
assert(["normal", "browser_prepare"].includes(stage));
const tag = randomBytes(4).toString("hex");
const people = [],
  grants = [],
  runs = [];
const reason = "隔离验收：原处理人停用后交接";
const read = value => (typeof value === "string" ? JSON.parse(value) : value);
const taskList = async (projectId, runId) =>
  (
    await admin.request("task.list", { projectId, view: "all", limit: 200 })
  ).filter(task => task.runId === runId);
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
function definition(flowType, signMode, ownerId) {
  const node = (id, type, config = {}, x = 0) => ({
    id,
    name: id,
    type,
    config,
    position: { x, y: 0 },
  });
  const nodes = [
    node("start", "start"),
    node(
      "review",
      "operate",
      {
        nodeDh: "REVIEW",
        czmc: "人员交接审批",
        instruction: "核对业务编号后办理。",
        ...(signMode === "single"
          ? { assigneeMode: "user", assigneeUserId: ownerId }
          : {
              assigneeMode: "form_user",
              assigneeFormField: "input.approvers",
            }),
        bdcz: { hqhqsz: signMode === "single" ? "" : signMode, hqtgbfb: 100 },
        formSchema: {
          fields: [
            {
              key: "reference",
              label: "业务编号",
              type: "text",
              readOnly: true,
              defaultValue: "{{input.reference}}",
            },
          ],
        },
      },
      500
    ),
    node(
      "end",
      "end",
      { resultTemplate: "{{vars.review.result.reference}}" },
      1000
    ),
  ];
  const edges = [
    { id: "start-review", sourceNodeId: "start", targetNodeId: "review" },
    {
      id: "review-end",
      sourceNodeId: "review",
      targetNodeId: "end",
      sourceHandle: "approved",
    },
  ];
  if (flowType === "state") {
    nodes.push(
      node(
        "pending",
        "state",
        { stateCode: "PENDING", displayName: "待审批", stateType: "business" },
        250
      ),
      node(
        "done",
        "state",
        { stateCode: "DONE", displayName: "审批完成", stateType: "business" },
        750
      )
    );
    edges[0].targetNodeId = "pending";
    edges[1].targetNodeId = "done";
    edges.push(
      { id: "pending-review", sourceNodeId: "pending", targetNodeId: "review" },
      { id: "done-end", sourceNodeId: "done", targetNodeId: "end" }
    );
  }
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes,
    edges,
  };
}
const execute = (session, taskId, reference) =>
  session.request(
    "task.execute",
    {
      taskId,
      result: {
        decision: "approved",
        outcome: "approved",
        reference,
        comment: "人员交接隔离验收",
      },
    },
    true
  );
try {
  for (const label of [
    "original",
    "replacement",
    "cosigner",
    "manager",
    "viewer",
  ]) {
    const username = `reassign_${tag}_${label}`;
    const password = `Test9_${randomBytes(24).toString("base64url")}`;
    const { userId } = await admin.request(
      "iam.createUser",
      { username, password, name: `交接验收_${tag}_${label}`, role: "user" },
      true
    );
    const session = new Session();
    people.push({ id: userId, session, login: { username, password } });
    await session.request("auth.login", { username, password }, true);
  }
  const [original, replacement, cosigner, manager, viewer] = people;
  const project = await admin.request(
    "project.create",
    { code: `REASSIGN_${tag}`.toUpperCase(), name: `人员交接验证_${tag}` },
    true
  );
  const cases =
    stage === "browser_prepare"
      ? [["control", "single", "claimed"]]
      : ["control", "state"].flatMap(type => [
          [type, "single", "pending"],
          [type, "single", "claimed"],
          [type, "andSignFor", "pending"],
          [type, "sequentialSignFor", "claimed"],
        ]);
  const scopeProbe = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `交接权限范围对照_${tag}`,
      flowType: "control",
      definition: definition("control", "single", original.id),
    },
    true
  );
  const probeGrant = {
    workflowId: scopeProbe.id,
    userId: viewer.id,
    role: "owner",
  };
  await admin.request("workflow.grantMember", probeGrant, true);
  grants.push(probeGrant);
  for (const [flowType, signMode, taskStatus] of cases) {
    await admin.request(
      "iam.updateUserStatus",
      { userId: original.id, status: "active" },
      true
    );
    await original.session.request("auth.login", original.login, true);
    const workflow = await admin.request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: `人员交接_${flowType}_${signMode}_${taskStatus}_${tag}`,
        flowType,
        definition: definition(flowType, signMode, original.id),
      },
      true
    );
    for (const [person, role] of [
      [original, "operator"],
      [replacement, "operator"],
      [cosigner, "operator"],
      [manager, "owner"],
      [viewer, "viewer"],
    ]) {
      const grant = { workflowId: workflow.id, userId: person.id, role };
      await admin.request("workflow.grantMember", grant, true);
      grants.push(grant);
    }
    await admin.request(
      "project.auditWorkflow",
      {
        projectId: project.id,
        workflowId: workflow.id,
        auditStatus: "approved",
      },
      true
    );
    await admin.request("workflow.publish", { id: workflow.id }, true);
    const reference = `REF-${tag}-${flowType}-${signMode}-${taskStatus}`;
    const { runId } = await admin.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        triggerType: "manual",
        input: { reference, approvers: [original.id, cosigner.id] },
        idempotencyKey: `reassign-${reference}`,
      },
      true
    );
    const fixture = { runId, complete: false };
    runs.push(fixture);
    await waitFor(runId, run => run.status === "waiting", "initial human task");
    const initial = (await taskList(project.id, runId)).find(
      task => task.assignedUserId === original.id
    );
    assert(initial);
    const get = session => session.request("task.get", { taskId: initial.id });
    if (taskStatus === "claimed")
      await original.session.request(
        "task.claim",
        { taskId: initial.id },
        true
      );
    assert.equal((await get(manager.session)).canReassign, false);
    await assert.rejects(
      () =>
        manager.session.request(
          "task.reassign",
          {
            taskId: initial.id,
            targetUserId: replacement.id,
            ownerVersion: initial.ownerVersion,
            reason,
          },
          true
        ),
      /权限/
    );
    await admin.request(
      "iam.updateUserStatus",
      { userId: original.id, status: "disabled" },
      true
    );
    const stranded = await get(manager.session);
    assert.equal(stranded.canReassign, true);
    assert.equal(stranded.canAct, false);
    assert.equal(stranded.status, taskStatus);
    const input = {
      taskId: initial.id,
      targetUserId: replacement.id,
      ownerVersion: stranded.ownerVersion,
      reason,
    };
    assert.equal((await get(viewer.session)).canReassign, false);
    await assert.rejects(
      () => viewer.session.request("task.reassign", input, true),
      /权限/
    );
    await assert.rejects(
      () => viewer.session.request("task.assignees", { taskId: initial.id }),
      /权限/
    );
    await assert.rejects(
      () =>
        manager.session.request(
          "task.reassign",
          { ...input, targetUserId: viewer.id },
          true
        ),
      /运行权限/
    );
    await assert.rejects(
      () =>
        manager.session.request(
          "task.reassign",
          { ...input, ownerVersion: stranded.ownerVersion + 1 },
          true
        ),
      /状态已变化/
    );
    await assert.rejects(
      () => execute(manager.session, initial.id, reference),
      /无|领取|处理人|权限|不可执行/
    );
    const candidates = await manager.session.request("task.assignees", {
      taskId: initial.id,
    });
    assert(candidates.some(person => person.id === replacement.id));
    assert(
      !candidates.some(
        person => person.id === original.id || person.id === viewer.id
      )
    );
    if (signMode !== "single")
      await assert.rejects(
        () =>
          manager.session.request(
            "task.reassign",
            { ...input, targetUserId: cosigner.id },
            true
          ),
        /重复移交/
      );
    if (stage === "browser_prepare") {
      fixture.complete = true; // The one owned waiting run is reserved for visible browser acceptance.
      console.log(
        JSON.stringify({
          stage,
          tag,
          projectId: project.id,
          workflowId: workflow.id,
          runId,
          taskId: initial.id,
          reference,
        })
      );
      continue;
    }
    await admin.request(
      "iam.updateUserStatus",
      { userId: replacement.id, status: "disabled" },
      true
    );
    await assert.rejects(
      () => manager.session.request("task.reassign", input, true),
      /停用/
    );
    await admin.request(
      "iam.updateUserStatus",
      { userId: replacement.id, status: "active" },
      true
    );
    await replacement.session.request("auth.login", replacement.login, true);
    assert.equal(
      (await admin.request("workflow.runDetail", { runId })).status,
      "waiting"
    );
    const attempts = await Promise.allSettled([
      manager.session.request("task.reassign", input, true),
      admin.request("task.reassign", input, true),
    ]);
    assert.equal(
      attempts.filter(result => result.status === "fulfilled").length,
      1
    );
    const updated = await get(replacement.session);
    assert.equal(updated.status, "pending");
    assert.equal(updated.assignedUserId, replacement.id);
    assert.equal(updated.claimedByUserId, null);
    assert.equal(updated.ownerVersion, stranded.ownerVersion + 1);
    assert.equal(updated.canAct, true);
    assert.equal(updated.payload.assignmentRecovery.reason, reason);
    assert.deepEqual(updated.payload.context, stranded.payload.context);
    assert.deepEqual(
      updated.payload.config.formSchema,
      stranded.payload.config.formSchema
    );
    assert.equal((await get(manager.session)).canReassign, false);
    if (signMode !== "single") {
      assert.equal(updated.memberVersion, stranded.memberVersion + 1);
      assert.equal(
        updated.approvalProgress.required,
        stranded.approvalProgress.required
      );
    }
    await execute(replacement.session, initial.id, reference);
    if (signMode !== "single") {
      const sibling = (await taskList(project.id, runId)).find(
        task => task.assignedUserId === cosigner.id
      );
      assert(sibling);
      await execute(cosigner.session, sibling.id, reference);
    }
    const result = await waitFor(
      runId,
      run => run.status === "success",
      "reassigned continuation"
    );
    assert.equal(result.executionSource, "published_plan");
    assert.equal(
      result.nodeRuns.filter(
        node => node.nodeId === "end" && node.status === "success"
      ).length,
      1
    );
    if (flowType === "state") {
      assert.equal(result.currentStateCode, "DONE");
      assert.equal(result.stateVersion, 2);
    }
    assert.equal(
      read((await get(replacement.session)).resultJson).reference,
      reference
    );
    fixture.complete = true;
    console.log(
      JSON.stringify({
        workflowId: workflow.id,
        runId,
        flowType,
        signMode,
        taskStatus,
        scopedManager: true,
        concurrentWinnerCount: 1,
        formPreserved: true,
        status: result.status,
      })
    );
  }
} finally {
  const failures = [];
  for (const fixture of runs.filter(run => !run.complete))
    await admin
      .request(
        "workflow.cancelRun",
        { runId: fixture.runId, reason: "人员交接隔离验收清理" },
        true
      )
      .catch(error => failures.push(error.message));
  for (const grant of grants)
    await admin
      .request("workflow.revokeMember", grant, true)
      .catch(error => failures.push(error.message));
  for (const person of people)
    await admin
      .request(
        "iam.updateUserStatus",
        { userId: person.id, status: "disabled" },
        true
      )
      .catch(error => failures.push(error.message));
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(
    JSON.stringify({ ownGrantsRevoked: true, ownAccountsDisabled: true })
  );
}
