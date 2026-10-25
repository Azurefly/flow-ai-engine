// Explicitly authorized isolated test: no global roles, no administrator test accounts.
// The finally block revokes/archives only this run's uniquely named fixtures.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import superjson from "superjson";
const base = "http://124.223.198.84:1180/",
  tag = randomBytes(6).toString("hex");
const fixture = {
  tag,
  projectId: null,
  users: [],
  units: [],
  flows: [],
  runIds: [],
  taskId: null,
};
const projectCode = `DIAG_${tag}`.toUpperCase();
const usernames = [`diag_${tag}_a`, `diag_${tag}_b`];
const unitCodes = [`DIAG_PARENT_${tag}`, `DIAG_CHILD_${tag}`];
const flowNames = [`诊断办理_${tag}`, `诊断数据_${tag}`];
let actorId,
  baselineVerified = false;
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
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    const value = await response.json();
    if (!response.ok || value.error)
      throw Object.assign(
        new Error(
          path + ": " + (value.error?.json?.message ?? response.status)
        ),
        { status: response.status }
      );
    return superjson.deserialize(value.result.data);
  }
}
const admin = new Session(),
  remember = () => console.log(JSON.stringify({ fixture }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const denied = (promise, status = 403) =>
  assert.rejects(promise, error => error.status === status);
async function canRead(session, workflowId) {
  try {
    return Boolean(await session.request("workflow.get", { id: workflowId }));
  } catch (error) {
    if ([403, 404].includes(error.status)) return false;
    throw error;
  }
}
async function waitRun(runId, status) {
  for (let n = 0; n < 60; n++) {
    const run = await admin.request("workflow.runDetail", { runId });
    if (run.status === status) return run;
    assert.notEqual(run.status, "failed", JSON.stringify(run.errorJson));
    await pause(250);
  }
  throw Error("Run did not reach " + status);
}
async function verifyBaseline() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    for (const [sql, params] of [
      ["SELECT id FROM users WHERE username IN (?)", [usernames]],
      ["SELECT id FROM flow_project WHERE code=?", [projectCode]],
      ["SELECT id FROM organization_unit WHERE code IN (?)", [unitCodes]],
    ]) {
      const [rows] = await db.query(sql, params);
      assert.equal(
        rows.length,
        0,
        "Fixture names must not exist before this run"
      );
    }
    baselineVerified = true;
  } finally {
    await db.end();
  }
}
async function cleanup() {
  if (!baselineVerified) return;
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    // Resolve unknown response outcomes by exact names established absent before setup.
    const [users] = await db.query(
      "SELECT id,username,role FROM users WHERE username IN (?)",
      [usernames]
    );
    assert(
      users.every(
        u =>
          usernames.includes(u.username) &&
          u.role === "user" &&
          Number(u.id) !== actorId
      )
    );
    const [projects] = await db.query(
      "SELECT id,code,ownerUserId FROM flow_project WHERE code=?",
      [projectCode]
    );
    assert(projects.length <= 1);
    const project = projects[0];
    if (project) assert.equal(Number(project.ownerUserId), actorId);
    const [units] = await db.query(
      "SELECT id,code,parentUnitId FROM organization_unit WHERE code IN (?)",
      [unitCodes]
    );
    assert(
      units.every(u =>
        unitCodes.map(s => s.toUpperCase()).includes(u.code.toUpperCase())
      )
    );
    const unitIds = units.map(u => u.id),
      userIds = users.map(u => Number(u.id));
    const [flows] = project
      ? await db.query(
          "SELECT id,name,ownerUserId FROM workflow WHERE projectId=?",
          [project.id]
        )
      : [[]];
    assert(
      flows.every(
        f => flowNames.includes(f.name) && Number(f.ownerUserId) === actorId
      )
    );
    if (project) {
      const [runs] = await db.query(
        "SELECT r.id,r.status FROM workflow_run r JOIN workflow w ON w.id=r.workflowId WHERE w.projectId=?",
        [project.id]
      );
      for (const run of runs.filter(r =>
        ["queued", "running", "waiting", "blocked"].includes(r.status)
      ))
        await admin.request(
          "workflow.terminateRun",
          { runId: run.id, reason: `隔离权限验收清理_${tag}` },
          true
        );
      for (let n = 0; n < 60; n++) {
        const [pending] = await db.query(
          "SELECT id FROM dataflow_run WHERE projectId=? AND status IN ('queued','running')",
          [project.id]
        );
        if (!pending.length) break;
        if (n === 59)
          throw Error(
            "Own dataflow jobs have not settled; cleanup needs attention"
          );
        await pause(250);
      }
    }
    await db.beginTransaction();
    if (userIds.length) {
      const [global] = await db.query(
        "SELECT id FROM role_assignment WHERE userId IN (?) AND scopeType='system' AND revokedAt IS NULL",
        [userIds]
      );
      assert.equal(
        global.length,
        0,
        "No global grants are permitted in this fixture"
      );
      const [members] = await db.query(
        "SELECT unitId FROM organization_membership WHERE userId IN (?)",
        [userIds]
      );
      assert(members.every(m => unitIds.includes(m.unitId)));
      const [projectGrants] = await db.query(
        "SELECT projectId FROM flow_project_member WHERE userId IN (?) AND revokedAt IS NULL",
        [userIds]
      );
      assert(projectGrants.every(g => g.projectId === project?.id));
      const [workflowGrants] = await db.query(
        "SELECT workflowId FROM workflow_member WHERE userId IN (?) AND revokedAt IS NULL",
        [userIds]
      );
      assert(workflowGrants.every(g => flows.some(f => f.id === g.workflowId)));
      await db.query(
        "UPDATE users SET status='disabled',tokenVersion=tokenVersion+1 WHERE id IN (?) AND status<>'disabled'",
        [userIds]
      );
      if (unitIds.length)
        await db.query(
          "DELETE FROM organization_membership WHERE userId IN (?) AND unitId IN (?)",
          [userIds, unitIds]
        );
      if (project) {
        await db.query(
          "UPDATE flow_project_member SET revokedAt=NOW() WHERE userId IN (?) AND projectId=? AND revokedAt IS NULL",
          [userIds, project.id]
        );
        if (flows.length)
          await db.query(
            "UPDATE workflow_member SET revokedAt=NOW() WHERE userId IN (?) AND workflowId IN (?) AND revokedAt IS NULL",
            [userIds, flows.map(f => f.id)]
          );
      }
    }
    if (unitIds.length) {
      const [children] = await db.query(
        "SELECT id FROM organization_unit WHERE parentUnitId IN (?)",
        [unitIds]
      );
      assert(children.every(c => unitIds.includes(c.id)));
      const [other] = await db.query(
        "SELECT userId FROM organization_membership WHERE unitId IN (?)",
        [unitIds]
      );
      assert.equal(other.length, 0);
      if (project)
        await db.query(
          "DELETE FROM flow_project_unit WHERE projectId=? AND unitId IN (?)",
          [project.id, unitIds]
        );
      await db.query(
        "UPDATE organization_unit SET status='disabled',updatedAt=NOW() WHERE id IN (?)",
        [unitIds]
      );
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
        [project.id, projectCode]
      );
    }
    await db.commit();
    console.log(
      JSON.stringify({
        cleanupComplete: true,
        tag,
        disabledUsers: userIds.length,
        disabledUnits: unitIds.length,
        archivedFlows: flows.length,
        archivedProject: !!project,
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
async function run() {
  assert(
    process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
      process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
    "Existing admin configuration required"
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
  assert(actorId > 0);
  await verifyBaseline();
  const people = [];
  for (const [index, label] of ["A", "B"].entries()) {
    const login = {
      username: usernames[index],
      password: randomBytes(24).toString("base64url"),
    };
    const { userId } = await admin.request(
      "iam.createUser",
      { ...login, name: `权限诊断_${tag}_${label}`, role: "user" },
      true
    );
    fixture.users.push({ id: userId, username: login.username });
    remember();
    const session = new Session();
    await session.request("auth.login", login, true);
    people.push({ id: userId, login, session });
  }
  const [a, b] = people,
    project = await admin.request(
      "project.create",
      { code: projectCode, name: `资源诊断验收_${tag}` },
      true
    );
  fixture.projectId = project.id;
  remember();
  const node = (id, type, config, index) => ({
    id,
    type,
    name: id,
    config,
    position: { x: index * 250, y: 0 },
  });
  async function flow(index, flowType, nodes, edges) {
    const created = await admin.request(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: flowNames[index],
        flowType,
        definition: {
          schemaVersion: 1,
          settings: {},
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes,
          edges,
        },
      },
      true
    );
    fixture.flows.push({ id: created.id, name: flowNames[index] });
    remember();
    let value = await admin.request("workflow.get", { id: created.id });
    await admin.request(
      "project.auditWorkflow",
      {
        projectId: project.id,
        workflowId: created.id,
        auditStatus: "approved",
        expectedDefinitionVersion: Number(value.definitionVersion),
        expectedAuditStatus: value.auditStatus,
      },
      true
    );
    value = await admin.request("workflow.get", { id: created.id });
    await admin.request(
      "workflow.publish",
      {
        id: created.id,
        expectedDefinitionVersion: Number(value.definitionVersion),
      },
      true
    );
    return created;
  }
  const control = await flow(
    0,
    "control",
    [
      node("start", "start", {}, 0),
      node(
        "review",
        "operate",
        {
          nodeDh: "DIAGREVIEW",
          czmc: "诊断办理",
          assigneeMode: "user",
          assigneeUserId: a.id,
          assigneeFallback: "error",
          formSchema: { fields: [] },
        },
        1
      ),
      node("end", "end", {}, 2),
    ],
    [
      { id: "s-r", sourceNodeId: "start", targetNodeId: "review" },
      {
        id: "r-e",
        sourceNodeId: "review",
        targetNodeId: "end",
        sourceHandle: "approved",
      },
    ]
  );
  const source = await admin.request(
    "data.createSource",
    {
      projectId: project.id,
      name: "隔离诊断内联源",
      sourceType: "inline",
      connection: {},
    },
    true
  );
  const asset = await admin.request(
    "data.createAsset",
    {
      projectId: project.id,
      sourceId: source.id,
      name: "隔离诊断样本",
      assetType: "dataset",
      schema: [{ name: "value", type: "number" }],
      sample: [{ value: 7 }],
    },
    true
  );
  const dataFlow = await flow(
    1,
    "data",
    [
      node("start", "start", {}, 0),
      node("source", "source", { assetId: asset.id, limit: 10 }, 1),
      node("end", "end", {}, 2),
    ],
    [
      { id: "s-source", sourceNodeId: "start", targetNodeId: "source" },
      { id: "source-e", sourceNodeId: "source", targetNodeId: "end" },
    ]
  );
  const diagnose = (person, workflowId = control.id, taskId) =>
    admin.request("iam.resourceAccess", {
      userId: person.id,
      workflowId,
      taskId,
    });
  const check = (value, code) => value.checks.find(p => p.code === code);
  assert.equal(check(await diagnose(a), "workflow:view").allowed, false);
  assert.equal(await canRead(a.session, control.id), false);
  await denied(
    b.session.request("iam.resourceAccess", {
      userId: a.id,
      workflowId: control.id,
    })
  );
  await admin.request(
    "workflow.grantMember",
    { workflowId: control.id, userId: b.id, role: "viewer" },
    true
  );
  assert.equal(await canRead(b.session, control.id), true);
  assert.equal(check(await diagnose(b), "workflow:run").allowed, false);
  const { runId } = await admin.request(
    "workflow.run",
    {
      workflowId: control.id,
      triggerType: "manual",
      input: {},
      idempotencyKey: `diag-task-${tag}`,
    },
    true
  );
  fixture.runIds.push(runId);
  remember();
  const waiting = await waitRun(runId, "waiting");
  fixture.taskId = waiting.taskActivities.find(t => t.nodeId === "review").id;
  remember();
  assert.equal(
    (await diagnose(a, control.id, fixture.taskId)).task.canAct,
    true
  );
  assert.equal(
    (await diagnose(b, control.id, fixture.taskId)).task.canAct,
    false
  );
  await denied(
    b.session.request("task.claim", { taskId: fixture.taskId }, true)
  );
  assert.equal(
    (await diagnose(a, dataFlow.id, fixture.taskId)).task.canAct,
    false
  );
  const parent = await admin.request(
    "config.createOrganizationUnit",
    { code: unitCodes[0], name: `诊断父部门_${tag}` },
    true
  );
  fixture.units.push({ id: parent.id, code: unitCodes[0] });
  remember();
  const child = await admin.request(
    "config.createOrganizationUnit",
    { code: unitCodes[1], name: `诊断子部门_${tag}`, parentUnitId: parent.id },
    true
  );
  fixture.units.push({ id: child.id, code: unitCodes[1] });
  remember();
  const configuration = await admin.request(
    "config.organizationMemberConfiguration",
    { userId: a.id }
  );
  await admin.request(
    "config.assignOrganizationMember",
    {
      unitId: child.id,
      userId: a.id,
      isPrimary: true,
      onlyIfAbsent: true,
      expectedMembershipToken: configuration.membershipToken,
    },
    true
  );
  await admin.request(
    "project.grantUnit",
    { projectId: project.id, unitId: child.id, role: "viewer" },
    true
  );
  await admin.request(
    "workflow.grantMember",
    { workflowId: control.id, userId: a.id, role: "operator" },
    true
  );
  let value = await diagnose(a);
  assert.equal(check(value, "workflow:run").allowed, true);
  assert(
    check(value, "workflow:view").sources.some(s => s.includes("流程成员"))
  );
  assert(
    check(value, "workflow:view").sources.some(s => s.includes("业务部门"))
  );
  await admin.request(
    "workflow.revokeMember",
    { workflowId: control.id, userId: a.id, role: "operator" },
    true
  );
  value = await diagnose(a);
  assert.equal(check(value, "workflow:view").allowed, true);
  assert.equal(check(value, "workflow:run").allowed, false);
  assert(value.bindings.some(s => s.state === "已撤销"));
  await admin.request(
    "project.revokeUnit",
    { projectId: project.id, unitId: child.id },
    true
  );
  const expiry = new Date(Date.now() + 3000);
  await admin.request(
    "workflow.grantMember",
    { workflowId: control.id, userId: a.id, role: "viewer", expiresAt: expiry },
    true
  );
  assert.equal(check(await diagnose(a), "workflow:view").allowed, true);
  while (Date.now() < expiry.getTime() + 1100) await pause(200);
  value = await diagnose(a);
  assert.equal(check(value, "workflow:view").allowed, false);
  assert(value.bindings.some(s => s.state === "已过期"));
  assert.equal(await canRead(a.session, control.id), false);
  await denied(
    a.session.request(
      "workflow.run",
      {
        workflowId: control.id,
        triggerType: "manual",
        input: {},
        idempotencyKey: `diag-denied-${tag}`,
      },
      true
    )
  );
  assert.equal(
    (await diagnose(a, control.id, fixture.taskId)).task.canAct,
    true
  );
  await a.session.request("task.claim", { taskId: fixture.taskId }, true);
  await a.session.request(
    "task.complete",
    {
      taskId: fixture.taskId,
      result: {
        decision: "approved",
        outcome: "approved",
        comment: "隔离权限诊断验收",
      },
    },
    true
  );
  await waitRun(runId, "success");
  assert.equal(
    (await diagnose(a, control.id, fixture.taskId)).task.canAct,
    false
  );
  await admin.request(
    "project.grantUnit",
    { projectId: project.id, unitId: child.id, role: "viewer" },
    true
  );
  await admin.request(
    "workflow.grantMember",
    { workflowId: dataFlow.id, userId: a.id, role: "operator" },
    true
  );
  assert.equal(
    check(await diagnose(a, dataFlow.id), "workflow:run").allowed,
    false
  );
  await denied(
    a.session.request(
      "data.run",
      { projectId: project.id, workflowId: dataFlow.id },
      true
    )
  );
  await admin.request(
    "project.grantMember",
    { projectId: project.id, userId: a.id, role: "operator" },
    true
  );
  assert.equal(
    check(await diagnose(a, dataFlow.id), "workflow:run").allowed,
    true
  );
  const dataRun = await a.session.request(
    "data.run",
    { projectId: project.id, workflowId: dataFlow.id },
    true
  );
  fixture.runIds.push(dataRun.runId);
  remember();
  let dataResult;
  for (let n = 0; n < 60; n++) {
    dataResult = await admin.request("data.runDetail", {
      projectId: project.id,
      runId: dataRun.runId,
    });
    if (dataResult.status === "success") break;
    assert.notEqual(dataResult.status, "failed");
    await pause(250);
  }
  assert.equal(dataResult.status, "success");
  assert.deepEqual(dataResult.output.terminals[0].rows, [{ value: 7 }]);
  await admin.request(
    "project.revokeMember",
    { projectId: project.id, userId: a.id },
    true
  );
  assert.equal(
    check(await diagnose(a, dataFlow.id), "workflow:run").allowed,
    false
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId: a.id, status: "disabled" },
    true
  );
  value = await diagnose(a);
  assert(value.checks.every(p => !p.allowed));
  assert.equal(
    (await diagnose(a, control.id, fixture.taskId)).task.canAct,
    false
  );
  await denied(a.session.request("workflow.get", { id: control.id }), 401);
  await admin.request(
    "iam.updateUserStatus",
    { userId: a.id, status: "active" },
    true
  );
  await admin.request(
    "project.grantMember",
    { projectId: project.id, userId: a.id, role: "operator" },
    true
  );
  console.log(
    JSON.stringify({
      accepted: true,
      fixture,
      readyForUi: true,
      actualApiParity: true,
      taskScopeAndOwnership: true,
      scopedMultipleSources: true,
      expiredAndRevokedVerified: true,
      disabledVerified: true,
      dataProjectPermissionVerified: true,
      noGlobalGrant: true,
      writesRetried: 0,
    })
  );
  const uiWindow = Number(process.env.FLOW_DIAG_UI_WINDOW_MS || 0);
  assert(Number.isFinite(uiWindow) && uiWindow >= 0 && uiWindow <= 180000);
  if (uiWindow) await pause(uiWindow);
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
