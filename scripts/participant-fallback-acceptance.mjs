import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";

const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    // Fixture writes explicitly submit the revision just inspected; callers may supply an older revision to test conflicts.
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
const administrator = await admin.request("auth.me", null);
const legacy = process.env.FLOW_EXPECT_LEGACY_FALLBACK === "1";
const tag = randomBytes(4).toString("hex"),
  people = [],
  grants = [],
  runs = [];
const read = value => (typeof value === "string" ? JSON.parse(value) : value);
async function waitFor(runId, status) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (run.status === status) return run;
    assert(
      !["failed", "cancelled", "terminated", "success"].includes(run.status),
      `Unexpected run status: ${run.status}; ${JSON.stringify(run.errorJson)}`
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${status}: ${runId}`);
}
function definition(flowType, config) {
  const node = (id, type, options = {}, x = 0) => ({
    id,
    type,
    name: id,
    config: options,
    position: { x, y: 0 },
  });
  const nodes = [
    node("start", "start"),
    node(
      "review",
      "operate",
      {
        nodeDh: "FALLBACK",
        czmc: "人员兜底审批",
        instruction: "核对业务编号后办理。",
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
        ...config,
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
const execute = (session, task, reference) =>
  session.request(
    "task.execute",
    {
      taskId: task.id,
      result: {
        decision: "approved",
        outcome: "approved",
        reference,
        comment: "隔离人员兜底验收",
      },
    },
    true
  );
try {
  for (const label of ["original", "initiator", "viewer"]) {
    const login = {
      username: `fallback_${tag}_${label}`,
      password: `Test9_${randomBytes(24).toString("base64url")}`,
    };
    const { userId } = await admin.request(
      "iam.createUser",
      { ...login, name: `兜底验收_${tag}_${label}`, role: "user" },
      true
    );
    const person = { id: userId, login, session: new Session() };
    people.push(person);
    await person.session.request("auth.login", login, true);
  }
  const [original, initiator, viewer] = people;
  await admin.request(
    "iam.updateUserStatus",
    { userId: original.id, status: "disabled" },
    true
  );
  const project = await admin.request(
    "project.create",
    { code: `FALLBACK_${tag}`.toUpperCase(), name: `人员兜底验证_${tag}` },
    true
  );
  const cases = legacy
    ? [["control", "owner"]]
    : ["control", "state"].flatMap(type =>
        [
          "owner",
          "initiator",
          "error",
          "all_unavailable",
          "partial",
          "selector_partial",
          "active_group",
        ].map(mode => [type, mode])
      );
  for (const [flowType, mode] of cases) {
    const grouped = ["partial", "selector_partial", "active_group"].includes(
      mode
    );
    if (mode === "active_group") {
      await admin.request(
        "iam.updateUserStatus",
        { userId: original.id, status: "active" },
        true
      );
      await original.session.request("auth.login", original.login, true);
    }
    const config = [
      "all_unavailable",
      "partial",
      "selector_partial",
      "active_group",
    ].includes(mode)
      ? {
          assigneeMode: "form_user",
          assigneeFormField: "input.approvers",
          assigneeFallback: "owner",
          ...(grouped
            ? {
                bdcz: {
                  hqhqsz: "andSignFor",
                  hqtgbfb: 100,
                  ...(mode === "selector_partial"
                    ? { xzdfhq: [initiator.id, original.id] }
                    : {}),
                },
              }
            : {}),
        }
      : {
          assigneeMode: "user",
          assigneeUserId: original.id,
          assigneeFallback: mode,
        };
    const workflow = await admin.request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: `人员兜底_${flowType}_${mode}_${tag}`,
        flowType,
        definition: definition(flowType, config),
      },
      true
    );
    for (const [person, role] of [
      [original, "operator"],
      [initiator, "operator"],
      [viewer, "viewer"],
    ]) {
      // An already disabled original needs no fresh resource grant for failed/fallback cases.
      if (person === original && mode !== "active_group") continue;
      const grant = { workflowId: workflow.id, userId: person.id, role };
      await admin.request("workflow.grantMember", grant, true);
      grants.push(grant);
    }
    const selected = String(original.id);
    if (["owner", "initiator", "error"].includes(mode)) {
      const directory = await admin.request("workflow.participantDirectory", {
        workflowId: workflow.id,
        kind: "user",
        query: "",
        selectedIds: [selected],
      });
      if (legacy) assert.equal(directory.selected.length, 0);
      else {
        assert.deepEqual(directory.items, []);
        assert.equal(directory.selected[0].disabled, true);
        assert(directory.selected[0].label.includes("已停用"));
        assert(
          directory.selected[0].label.includes(`兜底验收_${tag}_original`)
        );
        const readonly = await viewer.session.request(
          "workflow.participantDirectory",
          {
            workflowId: workflow.id,
            kind: "user",
            query: "",
            selectedIds: [selected],
            readOnly: true,
          }
        );
        assert.deepEqual(readonly.selected, directory.selected);
        await assert.rejects(
          () =>
            viewer.session.request("workflow.participantDirectory", {
              workflowId: workflow.id,
              kind: "user",
              query: "",
              selectedIds: [String(initiator.id)],
              readOnly: true,
            }),
          /已配置/
        );
        const searched = await admin.request("workflow.participantDirectory", {
          workflowId: workflow.id,
          kind: "user",
          query: original.login.username,
          selectedIds: [],
        });
        assert.deepEqual(searched.items, []);
      }
    }
    const reference = `REF-${tag}-${flowType}-${mode}`;
    const formData = {
      reference,
      approvers:
        mode === "all_unavailable"
          ? [original.id]
          : mode === "selector_partial"
            ? [initiator.id]
            : [initiator.id, original.id],
    };
    const expectFailure =
      legacy || ["error", "partial", "selector_partial"].includes(mode);
    if (!legacy) {
      const preview = {
        workflowId: workflow.id,
        config,
        initiatorUserId: initiator.id,
        formData,
      };
      if (expectFailure)
        await assert.rejects(
          () => admin.request("workflow.previewParticipants", preview, true),
          /兜底|候选人|停用/
        );
      else {
        const result = await admin.request(
          "workflow.previewParticipants",
          preview,
          true
        );
        const expected =
          mode === "initiator"
            ? [initiator.id]
            : mode === "active_group"
              ? [initiator.id, original.id]
              : [administrator.id];
        assert.deepEqual(result.candidateUserIds, expected);
        assert.equal(result.requiredApprovals, expected.length);
        if (mode !== "active_group") {
          assert.equal(result.excluded[0].userId, original.id);
          assert.equal(
            result.fallbackApplied,
            mode === "initiator" ? "initiator" : "owner"
          );
        }
      }
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
    const { runId } = await initiator.session.request(
      "workflow.run",
      {
        workflowId: workflow.id,
        triggerType: "manual",
        input: formData,
        idempotencyKey: `fallback-${reference}`,
      },
      true
    );
    const fixture = { runId, complete: false };
    runs.push(fixture);
    const run = await waitFor(runId, expectFailure ? "failed" : "waiting");
    assert.equal(run.executionSource, "published_plan");
    const tasks = (
      await admin.request("task.list", {
        projectId: project.id,
        view: "all",
        limit: 200,
      })
    ).filter(task => task.runId === runId);
    if (expectFailure) {
      assert.match(
        JSON.stringify(run.errorJson),
        legacy
          ? /停用/
          : mode === "selector_partial"
            ? /未命中当前操作候选人/
            : mode === "partial"
              ? /审批要求不会自动降低/
              : /未解析到有效处理人/
      );
      assert.equal(tasks.length, 0);
      fixture.complete = true;
    } else {
      assert.equal(tasks.length, mode === "active_group" ? 2 : 1);
      for (const task of tasks) {
        const session =
          task.assignedUserId === administrator.id
            ? admin
            : task.assignedUserId === initiator.id
              ? initiator.session
              : original.session;
        const detail = await session.request("task.get", { taskId: task.id });
        assert.equal(
          detail.payload.config.formSchema.fields[0].defaultValue,
          reference
        );
        if (mode !== "active_group")
          assert.equal(
            read(detail.participantSnapshotJson).fallbackApplied,
            mode === "initiator" ? "initiator" : "owner"
          );
        await execute(session, task, reference);
      }
      const result = await waitFor(runId, "success");
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
      fixture.complete = true;
    }
    console.log(
      JSON.stringify({
        flowType,
        mode,
        workflowId: workflow.id,
        runId,
        expectedFailure: expectFailure,
        status: expectFailure ? run.status : "success",
        legacy,
      })
    );
    if (mode === "active_group")
      await admin.request(
        "iam.updateUserStatus",
        { userId: original.id, status: "disabled" },
        true
      );
  }
} finally {
  const failures = [];
  for (const run of runs.filter(item => !item.complete))
    await admin
      .request(
        "workflow.cancelRun",
        { runId: run.runId, reason: "人员兜底隔离验收清理" },
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
