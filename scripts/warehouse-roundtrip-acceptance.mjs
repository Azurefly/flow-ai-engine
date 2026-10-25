// Explicitly authorized: one isolated business/user/folder, at most seven flows, no global grants.
// Writes are never retried automatically. finally revokes, disables and archives only this fixture.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
const base = "http://124.223.198.84:1180/",
  tag = randomBytes(6).toString("hex"),
  code = `WARE_${tag}`.toUpperCase(),
  username = `warehouse_${tag}`;
const fixture = {
  tag,
  projectId: null,
  userId: null,
  flows: [],
  runIds: [],
  endedTaskId: null,
};
let baseline = false,
  actorId;
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      base +
        "api/trpc/" +
        path +
        (mutation ? "" : "?input=" + encodeURIComponent(body)),
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body } : {}),
        signal: AbortSignal.timeout(30000),
      }
    );
    const next = response.headers.getSetCookie()[0];
    if (next) this.cookie = next.split(";", 1)[0];
    const value = await response.json();
    if (!response.ok || value.error)
      throw Object.assign(
        Error(path + ": " + (value.error?.json?.message ?? response.status)),
        { status: response.status }
      );
    return superjson.deserialize(value.result.data);
  }
}
const admin = new Session(),
  person = new Session(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const remember = () => console.log(JSON.stringify({ fixture }));
const denied = (promise, status = 403) =>
  assert.rejects(promise, error => error.status === status);
async function waitRun(runId, status) {
  for (let n = 0; n < 80; n++) {
    const value = await admin.request("workflow.runDetail", { runId });
    if (value.status === status) return value;
    assert.notEqual(value.status, "failed", JSON.stringify(value.errorJson));
    await pause(250);
  }
  throw Error("Run did not reach " + status);
}
async function count() {
  return (
    await admin.request("project.workflows", { projectId: fixture.projectId })
  ).length;
}
async function audit(id) {
  const value = await admin.request("workflow.get", { id });
  await admin.request(
    "project.auditWorkflow",
    {
      projectId: fixture.projectId,
      workflowId: id,
      auditStatus: "approved",
      expectedDefinitionVersion: Number(value.definitionVersion),
      expectedAuditStatus: value.auditStatus,
    },
    true
  );
}
async function publish(id) {
  const value = await admin.request("workflow.get", { id });
  return admin.request(
    "workflow.publish",
    { id, expectedDefinitionVersion: Number(value.definitionVersion) },
    true
  );
}
async function start(id) {
  const value = await admin.request(
    "workflow.run",
    {
      workflowId: id,
      triggerType: "manual",
      input: {},
      idempotencyKey: `warehouse-${tag}-${fixture.runIds.length}`,
    },
    true
  );
  fixture.runIds.push(value.runId);
  remember();
  return value.runId;
}
async function human(id) {
  const runId = await start(id),
    waiting = await waitRun(runId, "waiting"),
    task = waiting.taskActivities.find(task => task.nodeId === "review");
  assert(task);
  await person.request("task.claim", { taskId: task.id }, true);
  await person.request(
    "task.complete",
    {
      taskId: task.id,
      result: { decision: "approved", comment: "仓库隔离验收" },
    },
    true
  );
  await waitRun(runId, "success");
  const ended = await person.request("task.get", { taskId: task.id });
  assert.equal(ended.canAct, false);
  assert.equal(ended.actionLabel, "任务已完成");
  fixture.endedTaskId = task.id;
}
async function data(id) {
  const value = await admin.request(
    "data.run",
    { projectId: fixture.projectId, workflowId: id },
    true
  );
  fixture.runIds.push(value.runId);
  remember();
  for (let n = 0; n < 80; n++) {
    const result = await admin.request("data.runDetail", {
      projectId: fixture.projectId,
      runId: value.runId,
    });
    if (result.status === "success") {
      assert.deepEqual(result.output.terminals[0].rows, [{ value: 7 }]);
      return;
    }
    assert.notEqual(result.status, "failed");
    await pause(250);
  }
  throw Error("Data job timed out");
}
async function run() {
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
  actorId = Number((await admin.request("auth.me", null)).id);
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    for (const [sql, args] of [
      ["SELECT id FROM users WHERE username=?", [username]],
      ["SELECT id FROM flow_project WHERE code=?", [code]],
    ]) {
      const [rows] = await db.query(sql, args);
      assert.equal(rows.length, 0);
    }
    baseline = true;
  } finally {
    await db.end();
  }
  const password = randomBytes(24).toString("base64url");
  fixture.userId = (
    await admin.request(
      "iam.createUser",
      { username, password, name: `仓库办理_${tag}`, role: "user" },
      true
    )
  ).userId;
  remember();
  await person.request("auth.login", { username, password }, true);
  fixture.projectId = (
    await admin.request(
      "project.create",
      { code, name: `仓库闭环验收_${tag}` },
      true
    )
  ).id;
  remember();
  await admin.request(
    "project.grantMember",
    { projectId: fixture.projectId, userId: fixture.userId, role: "designer" },
    true
  );
  const source = await admin.request(
    "data.createSource",
    {
      projectId: fixture.projectId,
      name: "隔离内联源",
      sourceType: "inline",
      connection: {},
    },
    true
  );
  const asset = await admin.request(
    "data.createAsset",
    {
      projectId: fixture.projectId,
      sourceId: source.id,
      name: "仓库样本",
      assetType: "dataset",
      schema: [{ name: "value", type: "number" }],
      sample: [{ value: 7 }],
    },
    true
  );
  const node = (id, type, config, x) => ({
    id,
    type,
    name: id,
    config,
    position: { x, y: 0 },
  });
  const definition = (middle, lastHandle) => {
    const nodes = [
      node("start", "start", {}, 0),
      ...middle,
      node("end", "end", {}, 600),
    ];
    return {
      schemaVersion: 1,
      settings: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: nodes
        .slice(1)
        .map((target, index) => ({
          id: "edge-" + index,
          sourceNodeId: nodes[index].id,
          targetNodeId: target.id,
          ...(index === nodes.length - 2 && lastHandle
            ? { sourceHandle: lastHandle }
            : {}),
        })),
    };
  };
  const definitions = [
    definition([]),
    definition(
      [
        node(
          "review",
          "operate",
          {
            nodeDh: "WARE_REVIEW",
            czmc: "仓库办理",
            assigneeMode: "user",
            assigneeUserId: fixture.userId,
            assigneeFallback: "error",
            formSchema: { fields: [] },
          },
          300
        ),
      ],
      "approved"
    ),
    definition([
      node("source", "source", { assetId: asset.id, limit: 10 }, 300),
    ]),
  ];
  const types = ["state", "control", "data"],
    original = [];
  for (const [index, flowType] of types.entries()) {
    const value = await admin.request(
      "project.createWorkflow",
      {
        projectId: fixture.projectId,
        name: `仓库_${flowType}_${tag}`,
        flowType,
        definition: definitions[index],
      },
      true
    );
    original.push(value.id);
    fixture.flows.push(value.id);
    remember();
    await audit(value.id);
    await publish(value.id);
  }
  await waitRun(await start(original[0]), "success");
  await human(original[1]);
  await data(original[2]);
  const resumedId = await start(original[1]),
    pending = await waitRun(resumedId, "waiting"),
    taskId = pending.taskActivities.find(task => task.nodeId === "review").id;
  await admin.request("workflow.pauseRun", { runId: resumedId }, true);
  assert.equal(
    (await person.request("task.get", { taskId })).actionLabel,
    "流程已暂停"
  );
  await admin.request("workflow.resumeRun", { runId: resumedId }, true);
  await waitRun(resumedId, "waiting");
  assert.equal((await person.request("task.get", { taskId })).canAct, true);
  assert.equal(
    (await admin.request("workflow.runDetail", { runId: resumedId }))
      .taskActivities.length,
    1
  );
  await admin.request(
    "workflow.terminateRun",
    { runId: resumedId, reason: "隔离暂停恢复终止验收" },
    true
  );
  assert.equal(
    (await person.request("task.get", { taskId })).actionLabel,
    "任务已取消"
  );
  const exported = await admin.request("project.exportWorkflows", {
    projectId: fixture.projectId,
    workflowIds: original,
  });
  assert.deepEqual(new Set(exported.map(row => row.flowType)), new Set(types));
  assert(
    exported.every(
      row =>
        row.processCode && row.projectId === fixture.projectId && row.definition
    )
  );
  const payload = { formatVersion: "1.0.0", workflows: exported },
    before = await count();
  const invalid = await admin.request(
    "project.previewWorkflowImport",
    {
      projectId: fixture.projectId,
      payload: {
        workflows: [
          exported[0],
          { name: "错误条目", flowType: "invalid", definition: definitions[0] },
        ],
      },
    },
    true
  );
  assert.equal(invalid.canImport, false);
  assert.equal(invalid.items[0].errors.length, 0);
  assert(invalid.items[1].errors.length);
  const conflicts = await admin.request(
    "project.previewWorkflowImport",
    { projectId: fixture.projectId, payload, preserveCodes: true },
    true
  );
  assert.equal(conflicts.canImport, false);
  assert(
    conflicts.items.every(item =>
      item.errors.some(message => message.includes("代号"))
    )
  );
  const preview = await admin.request(
    "project.previewWorkflowImport",
    { projectId: fixture.projectId, payload },
    true
  );
  assert.equal(preview.canImport, true);
  assert.equal(await count(), before);
  const foreign = structuredClone(definitions[2]);
  const reader = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [rows] = await reader.query(
      "SELECT id FROM data_asset WHERE projectId<>? LIMIT 1",
      [fixture.projectId]
    );
    foreign.nodes.find(node => node.id === "source").config.assetId =
      rows[0]?.id || `missing_${tag}`;
  } finally {
    await reader.end();
  }
  const unavailable = await admin.request(
    "project.previewWorkflowImport",
    {
      projectId: fixture.projectId,
      payload: {
        name: `仓库_data_${tag}`,
        flowType: "data",
        definition: foreign,
      },
    },
    true
  );
  assert.equal(unavailable.canImport, true);
  assert(unavailable.items[0].warnings.length);
  for (const item of preview.items) {
    const input = {
      projectId: fixture.projectId,
      name: item.name,
      description: item.description,
      flowType: item.flowType,
      creationSource: "warehouse",
      definition: item.flowType === "data" ? foreign : item.definition,
      requestKey: `warehouse-import-${tag}-${item.index}`,
    };
    const value = await admin.request("project.createWorkflow", input, true);
    fixture.flows.push(value.id);
    remember();
    const replayed = await admin.request("project.createWorkflow", input, true);
    assert.equal(replayed.id, value.id);
    let draft = await admin.request("workflow.get", { id: value.id });
    assert.equal(draft.status, "draft");
    assert.equal(draft.auditStatus, "init");
    assert.equal(draft.creationSource, "warehouse");
    if (item.flowType !== "data")
      await denied(
        admin.request(
          "workflow.run",
          {
            workflowId: value.id,
            triggerType: "manual",
            idempotencyKey: `warehouse-draft-${tag}-${item.index}`,
          },
          true
        ),
        409
      );
    if (item.flowType === "data") {
      await audit(value.id);
      await denied(publish(value.id), 400);
      draft = await admin.request("workflow.get", { id: value.id });
      await admin.request(
        "workflow.update",
        {
          id: value.id,
          definition: item.definition,
          expectedDefinitionVersion: Number(draft.definitionVersion),
        },
        true
      );
    }
    await audit(value.id);
    await publish(value.id);
    if (item.flowType === "data") await data(value.id);
    else if (item.flowType === "control") await human(value.id);
    else await waitRun(await start(value.id), "success");
  }
  assert.equal(await count(), before + 3);
  assert.equal(fixture.runIds.length, 7);
  let warehouse = await person.request("project.warehouse", {
    projectId: fixture.projectId,
  });
  assert(warehouse.workflows.every(row => row.canMove && !row.canArchive));
  const folder = await person.request(
    "project.createFolder",
    { projectId: fixture.projectId, name: `验收目录_${tag}` },
    true
  );
  await person.request(
    "project.moveWorkflow",
    {
      projectId: fixture.projectId,
      workflowId: original[0],
      folderId: folder.id,
    },
    true
  );
  await admin.request(
    "workflow.grantMember",
    { workflowId: original[0], userId: fixture.userId, role: "owner" },
    true
  );
  await admin.request(
    "project.revokeMember",
    { projectId: fixture.projectId, userId: fixture.userId },
    true
  );
  await admin.request(
    "project.grantMember",
    { projectId: fixture.projectId, userId: fixture.userId, role: "viewer" },
    true
  );
  warehouse = await person.request("project.warehouse", {
    projectId: fixture.projectId,
  });
  assert.equal(
    warehouse.workflows.find(row => row.id === original[0]).canArchive,
    true
  );
  assert(warehouse.workflows.every(row => !row.canMove));
  await denied(
    person.request(
      "project.moveWorkflow",
      { projectId: fixture.projectId, workflowId: original[0], folderId: null },
      true
    )
  );
  await denied(
    person.request(
      "project.previewWorkflowImport",
      { projectId: fixture.projectId, payload },
      true
    )
  );
  assert.equal(
    (
      await person.request("project.exportWorkflows", {
        projectId: fixture.projectId,
        workflowIds: original,
      })
    ).length,
    3
  );
  const state = await admin.request("workflow.get", { id: original[0] });
  await person.request(
    "workflow.delete",
    {
      id: original[0],
      expectedDefinitionVersion: Number(state.definitionVersion),
    },
    true
  );
  await admin.request(
    "workflow.restore",
    {
      id: original[0],
      expectedDefinitionVersion: Number(state.definitionVersion),
    },
    true
  );
  await admin.request(
    "project.moveWorkflow",
    { projectId: fixture.projectId, workflowId: original[0], folderId: null },
    true
  );
  console.log(
    JSON.stringify({
      accepted: true,
      readyForUi: true,
      fixture,
      exportPayload: payload,
      singleDataPayload: {
        workflows: exported.filter(row => row.flowType === "data"),
      },
      threeTypesExecutedBeforeAndAfterImport: true,
      preflightDraftWrites: 0,
      intentionalIdempotencyReplays: 3,
      automaticWriteRetries: 0,
      missingResourcePublishDenied: true,
      pauseResumeTerminateVerified: true,
      archiveAndMovePermissionParity: true,
    })
  );
  const windowMs = Number(process.env.FLOW_WAREHOUSE_UI_WINDOW_MS || 0);
  assert(Number.isFinite(windowMs) && windowMs >= 0 && windowMs <= 300000);
  if (windowMs) await pause(windowMs);
}
async function cleanup() {
  if (!baseline) return;
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [users] = await db.query(
      "SELECT id,role FROM users WHERE username=?",
      [username]
    );
    assert(users.length <= 1);
    assert(
      users.every(user => user.role === "user" && Number(user.id) !== actorId)
    );
    const [projects] = await db.query(
      "SELECT id,ownerUserId FROM flow_project WHERE code=?",
      [code]
    );
    assert(projects.length <= 1);
    const project = projects[0];
    if (project) assert.equal(Number(project.ownerUserId), actorId);
    const [flows] = project
      ? await db.query(
          "SELECT id,name,ownerUserId FROM workflow WHERE projectId=?",
          [project.id]
        )
      : [[]];
    assert(
      flows.every(
        flow =>
          flow.name.startsWith("仓库_") &&
          flow.name.endsWith(tag) &&
          Number(flow.ownerUserId) === actorId
      )
    );
    assert(flows.length <= 7);
    if (project) {
      const [active] = await db.query(
        "SELECT r.id FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=? AND r.status IN ('queued','running','waiting','blocked')",
        [project.id]
      );
      for (const run of active)
        await admin.request(
          "workflow.terminateRun",
          { runId: run.id, reason: `仓库隔离验收清理_${tag}` },
          true
        );
      for (let n = 0; n < 80; n++) {
        const [pending] = await db.query(
          "SELECT id FROM dataflow_run WHERE projectId=? AND status IN ('queued','running')",
          [project.id]
        );
        if (!pending.length) break;
        if (n === 79) throw Error("Own dataflow jobs did not settle");
        await pause(250);
      }
    }
    await db.beginTransaction();
    if (users[0]) {
      const userId = Number(users[0].id);
      const [global] = await db.query(
        "SELECT id FROM role_assignment WHERE userId=? AND revokedAt IS NULL",
        [userId]
      );
      assert.equal(global.length, 0);
      const [members] = await db.query(
        "SELECT userId FROM organization_membership WHERE userId=?",
        [userId]
      );
      assert.equal(members.length, 0);
      const [projectGrants] = await db.query(
        "SELECT projectId FROM flow_project_member WHERE userId=? AND revokedAt IS NULL",
        [userId]
      );
      assert(projectGrants.every(row => row.projectId === project?.id));
      const [flowGrants] = await db.query(
        "SELECT workflowId FROM workflow_member WHERE userId=? AND revokedAt IS NULL",
        [userId]
      );
      assert(
        flowGrants.every(row => flows.some(flow => flow.id === row.workflowId))
      );
      await db.query(
        "UPDATE users SET status='disabled',tokenVersion=tokenVersion+1 WHERE id=? AND status<>'disabled'",
        [userId]
      );
      if (project) {
        await db.query(
          "UPDATE flow_project_member SET revokedAt=NOW() WHERE projectId=? AND userId=? AND revokedAt IS NULL",
          [project.id, userId]
        );
        if (flows.length)
          await db.query(
            "UPDATE workflow_member SET revokedAt=NOW() WHERE workflowId IN (?) AND userId=? AND revokedAt IS NULL",
            [flows.map(flow => flow.id), userId]
          );
      }
    }
    if (project) {
      const [pending] = await db.query(
        "SELECT r.id FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=? AND r.status IN ('queued','running','waiting','blocked')",
        [project.id]
      );
      assert.equal(pending.length, 0);
      await db.query(
        "UPDATE workflow SET archivedAt=COALESCE(archivedAt,NOW()),archivedByUserId=?,updatedAt=NOW() WHERE projectId=?",
        [actorId, project.id]
      );
      await db.query(
        "UPDATE flow_project SET status='archived',updatedAt=NOW() WHERE id=? AND code=?",
        [project.id, code]
      );
    }
    await db.commit();
    console.log(
      JSON.stringify({
        cleanupComplete: true,
        tag,
        ordinaryAccountsDisabled: users.length,
        archivedFlows: flows.length,
        archivedProject: Boolean(project),
        noGlobalGrant: true,
      })
    );
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}
let failed = false;
try {
  await run();
} catch (error) {
  failed = true;
  console.error(error.stack || error.message);
  remember();
} finally {
  try {
    await cleanup();
  } catch (error) {
    failed = true;
    console.error("Cleanup needs attention: " + (error.stack || error.message));
    remember();
  }
}
process.exitCode = failed ? 1 : 0;
