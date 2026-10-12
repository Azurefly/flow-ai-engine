import assert from "node:assert/strict";
import superjson from "superjson";

// Loaded over SSH by browser-config-acceptance.cjs. Secrets remain in process memory.
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const body = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body } : {}),
      signal: AbortSignal.timeout(30000),
    }
  );
  const nextCookie = response.headers.getSetCookie()[0];
  if (nextCookie) cookie = nextCookie.split(";", 1)[0];
  const payload = await response.json();
  assert(
    response.ok && !payload.error,
    payload.error?.json?.message ?? `HTTP ${response.status}`
  );
  return superjson.deserialize(payload.result.data);
}

async function bootstrap() {
  assert(
    process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
      process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
  );
  await request(
    "auth.login",
    {
      username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
    },
    true
  );
}

function definition(flowType, userId, assetId) {
  const node = (id, type, config = {}, index = 0) => ({
    id,
    type,
    name:
      {
        start: "开始",
        end: "结束",
        pending: "待审核",
        done: "审核完成",
        review: "业务审批",
        wait: "等待回执",
        source: "订单数据",
        filter: "筛选有效订单",
        output: "预览结果",
      }[id] ?? id,
    position: { x: index * 240, y: 80 },
    config,
  });
  const specs =
    flowType === "data"
      ? [
          ["start", "start", {}],
          ["source", "source", { assetId, limit: 10 }],
          ["filter", "filter", { filterField: "status", filterValue: "paid" }],
          ["output", "output", { outputName: "有效订单" }],
          ["end", "end", {}],
        ]
      : [
          ["start", "start", {}],
          ...(flowType === "state"
            ? [
                [
                  "pending",
                  "state",
                  {
                    stateCode: "PENDING",
                    displayName: "待审核",
                    stateType: "business",
                  },
                ],
              ]
            : []),
          [
            "review",
            "operate",
            {
              nodeDh: "REVIEW",
              czmc: "业务审批",
              instruction: "核对订单金额与申请说明后办理。",
              assigneeMode: "user",
              assigneeUserId: userId,
              assigneeFallback: "owner",
              formSchema: {
                fields: [
                  {
                    key: "reason",
                    label: "申请说明",
                    type: "textarea",
                    required: true,
                  },
                  {
                    key: "amount",
                    label: "订单金额",
                    type: "number",
                    required: true,
                  },
                ],
              },
            },
          ],
          ...(flowType === "state"
            ? [
                [
                  "done",
                  "state",
                  {
                    stateCode: "DONE",
                    displayName: "审核完成",
                    stateType: "business",
                  },
                ],
              ]
            : [["wait", "wait", { durationSeconds: 10 }]]),
          ["end", "end", {}],
        ];
  return {
    schemaVersion: 1,
    settings: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: specs.map(([id, type, config], index) =>
      node(id, type, config, index)
    ),
    edges: specs.slice(1).map(([id], index) => ({
      id: `edge-${index}`,
      sourceNodeId: specs[index][0],
      targetNodeId: id,
    })),
  };
}

async function cleanup(fixture) {
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  await bootstrap();
  const people = [...(fixture.people ?? [])],
    failures = [];
  let archivedOwnProjects = 0;
  if (fixture.identityRoleCode) {
    try {
      await revokeIdentity(fixture);
      const role = (await request("iam.roles", { scope: "system" })).find(
        item => item.code === fixture.identityRoleCode
      );
      if (role) {
        assert.equal(role.name, "临时身份管理员_" + fixture.tag);
        await request(
          "iam.deleteCustomRole",
          { code: fixture.identityRoleCode },
          true
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  for (const pending of fixture.pendingPeople ?? []) {
    try {
      assert(pending.username.startsWith(fixture.tag + "_"));
      const directory = await request("iam.userDirectory", {
        search: pending.username,
        limit: 20,
        offset: 0,
      });
      const person = directory.items.find(
        item => item.username === pending.username
      );
      if (!person) continue;
      assert.equal(person.name, pending.name);
      assert.equal(person.role, "user");
      if (!people.some(item => item.id === person.id))
        people.push({ id: person.id, username: person.username });
    } catch (error) {
      failures.push(error.message);
    }
  }
  for (const person of fixture.people ?? []) {
    assert(person.username.startsWith(fixture.tag + "_"));
  }
  for (const run of fixture.runs ?? []) {
    try {
      assert(fixture.workflows.some(flow => flow.id === run.workflowId));
      const actual = await request("workflow.runDetail", { runId: run.id });
      assert.equal(actual.workflowId, run.workflowId); assert.equal(actual.ownerUserId, fixture.userId);
      if (["queued", "running", "waiting", "blocked"].includes(actual.status))
        await request("workflow.cancelRun", { runId: run.id }, true);
    } catch (error) { failures.push(error.message); }
  }
  for (const workflow of fixture.workflows ?? []) {
    try {
      const current = await request("workflow.get", { id: workflow.id });
      assert.equal(current.ownerUserId, fixture.userId);
      assert.equal(current.name, workflow.name);
      assert(current.name.endsWith(fixture.tag));
      if (!current.archivedAt)
        await request("workflow.delete", { id: workflow.id }, true);
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (fixture.projects?.length || fixture.pendingProjects?.length) {
    const { default: mysql } = await import("mysql2/promise");
    const pool = mysql.createPool(process.env.DATABASE_URL);
    try {
      const ownedProjects = [...(fixture.projects ?? [])];
      for (const pending of fixture.pendingProjects ?? []) {
        assert(pending.name.endsWith(fixture.tag));
        assert(pending.code.startsWith(fixture.tag.toUpperCase()));
        const [rows] = await pool.query("SELECT id,code,name FROM flow_project WHERE ownerUserId=? AND code=?", [fixture.userId, pending.code]);
        if (!rows.length) continue;
        assert.equal(rows[0].name, pending.name);
        if (!ownedProjects.some(project => project.id === rows[0].id)) ownedProjects.push(rows[0]);
      }
      for (const project of ownedProjects) {
        try {
          assert(project.name.endsWith(fixture.tag));
          assert(project.code.startsWith(fixture.tag.toUpperCase()));
          const [rows] = await pool.query("SELECT id,ownerUserId,name,code,status,lifecycleVersion FROM flow_project WHERE id=?", [project.id]);
          assert.equal(rows[0]?.ownerUserId, fixture.userId);
          assert.equal(rows[0]?.name, project.name);
          assert.equal(rows[0]?.code, project.code);
          const [active] = await pool.query("SELECT id FROM workflow WHERE projectId=? AND archivedAt IS NULL", [project.id]);
          assert.equal(active.length, 0, "隔离项目仍有未归档流程，拒绝归档项目");
          await pool.query("UPDATE flow_project_member SET revokedAt=COALESCE(revokedAt,NOW()) WHERE projectId=? AND userId=?", [project.id, fixture.disabledUserId]);
          if (rows[0].status === "active")
            await request("project.changeStatus", { projectId: project.id, status: "archived", expectedVersion: rows[0].lifecycleVersion, expectedWorkflowCount: 0 }, true);
          archivedOwnProjects++;
        } catch (error) { failures.push(error.message); }
      }
    } finally { await pool.end(); }
  }
  if (fixture.domain) {
    try {
      const actual = (await request("config.workDomains")).find(item => item.id === fixture.domain.id);
      assert.equal(actual?.createdByUserId, fixture.userId);
      assert.equal(actual?.code, fixture.domain.code);
      assert.equal(actual?.name, fixture.domain.name);
      assert(actual.name.endsWith(fixture.tag));
      await request("config.updateWorkDomain", { id: actual.id, status: "disabled" }, true);
    } catch (error) { failures.push(error.message); }
  }
  for (const person of people) {
    try {
      assert(person.username.startsWith(fixture.tag + "_"));
      const directory = await request("iam.userDirectory", {
        search: person.username,
        limit: 20,
        offset: 0,
      });
      const actual = directory.items.find(
        item => item.username === person.username
      );
      assert.equal(actual?.id, person.id);
      await request(
        "iam.updateUserStatus",
        { userId: person.id, status: "disabled" },
        true
      );
    } catch (error) {
      failures.push(error.message);
    }
  }
  assert.deepEqual(failures, [], "隔离账号或流程清理失败");
  console.log(
    JSON.stringify({
      cleanup: true,
      archivedOwnWorkflows: fixture.workflows?.length ?? 0,
      archivedOwnProjects,
      disabledOwnAccounts: people.length,
      disabledOwnDomains: fixture.domain ? 1 : 0,
    })
  );
}

async function revokeIdentity(fixture) {
  assert.equal(
    fixture.identityRoleCode,
    "custom_ui_iam_" + fixture.tag.slice(9)
  );
  await bootstrap();
  const directory = await request("iam.userDirectory", {
    search: fixture.tag + "_disabled",
    offset: 0,
    limit: 20,
  });
  assert.equal(
    directory.items.find(item => item.username === fixture.tag + "_disabled")
      ?.id,
    fixture.disabledUserId
  );
  const details = await request("iam.userAuthorizationDetails", {
    userId: fixture.disabledUserId,
  });
  for (const role of details.directRoles.filter(
    item => item.roleCode === fixture.identityRoleCode
  )) {
    await request(
      "iam.revokeRoleAssignment",
      { assignmentId: role.assignmentId },
      true
    );
  }
}

async function grantIdentity(fixture) {
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  fixture.identityRoleCode = "custom_ui_iam_" + fixture.tag.slice(9);
  console.log(JSON.stringify({ fixture }));
  await bootstrap();
  const directory = await request("iam.userDirectory", {
    search: fixture.tag + "_disabled",
    offset: 0,
    limit: 20,
  });
  assert.equal(
    directory.items.find(item => item.username === fixture.tag + "_disabled")
      ?.id,
    fixture.disabledUserId
  );
  await request(
    "iam.updateUserStatus",
    { userId: fixture.disabledUserId, status: "active" },
    true
  );
  await request(
    "iam.createCustomRole",
    {
      code: fixture.identityRoleCode,
      name: "临时身份管理员_" + fixture.tag,
      scope: "system",
      permissions: ["iam:manage"],
    },
    true
  );
  await request(
    "iam.assignSystemRole",
    { userId: fixture.disabledUserId, roleCode: fixture.identityRoleCode },
    true
  );
  console.log(JSON.stringify({ fixture }));
}

async function setup(intent) {
  const fixture = { tag: intent.tag, people: [], workflows: [], projects: [] };
  const progress = () => console.log(JSON.stringify({ fixture }));
  assert(/^uiconfig_[a-f0-9]{12}$/.test(intent.tag));
  assert.equal(intent.login.username, intent.tag + "_admin");
  await bootstrap();
  try {
    const created = await request(
      "iam.createUser",
      {
        ...intent.login,
        name: "界面隔离验收_" + intent.tag,
        role: "admin",
      },
      true
    );
    fixture.userId = created.userId;
    fixture.people.push({
      id: created.userId,
      username: intent.login.username,
    });
    progress();
    const unavailable = await request(
      "iam.createUser",
      {
        username: intent.tag + "_disabled",
        password: intent.disabledPassword,
        name: "已停用处理人_" + intent.tag,
        role: "user",
      },
      true
    );
    fixture.disabledUserId = unavailable.userId;
    fixture.people.push({
      id: unavailable.userId,
      username: intent.tag + "_disabled",
    });
    progress();
    await request(
      "iam.updateUserStatus",
      { userId: unavailable.userId, status: "disabled" },
      true
    );
    await request("auth.login", intent.login, true);
    if (intent.pagination) {
      const spec = { code: intent.tag.toUpperCase() + "_DOMAIN", name: "CSV验收工作域_" + intent.tag };
      const domain = await request("config.createWorkDomain", spec, true);
      fixture.domain = { id: domain.id, ...spec };
      fixture.csvDomainCode = spec.code;
      progress();
    }
    const project = await request(
      "project.create",
      { code: intent.tag.toUpperCase(), name: "界面隔离验收_" + intent.tag },
      true
    );
    fixture.projectId = project.id;
    fixture.projects.push({ id: project.id, code: intent.tag.toUpperCase(), name: "界面隔离验收_" + intent.tag });
    progress();
    if (intent.pagination) {
      for (let index = 1; index <= 12; index++) {
        const spec = { code: `${intent.tag.toUpperCase()}_P${index}`, name: `分页样本_${index}_${intent.tag}` };
        const createdProject = await request("project.create", spec, true);
        fixture.projects.push({ id: createdProject.id, ...spec });
        progress();
      }
    }
    const source = await request(
      "data.createSource",
      {
        projectId: project.id,
        name: "界面验收订单源",
        sourceType: "inline",
        connection: {},
      },
      true
    );
    const asset = await request(
      "data.createAsset",
      {
        projectId: project.id,
        sourceId: source.id,
        name: "界面验收订单",
        assetType: "dataset",
        schema: [
          { name: "id", type: "number" },
          { name: "amount", type: "number" },
          { name: "status", type: "string" },
        ],
        sample: [
          { id: 1, amount: 120, status: "paid" },
          { id: 2, amount: 80, status: "draft" },
        ],
      },
      true
    );
    for (const flowType of ["state", "control", "data"]) {
      const name = `界面配置_${flowType}_${intent.tag}`;
      const workflow = await request(
        "project.createWorkflow",
        {
          projectId: project.id,
          name,
          flowType,
          definition: definition(flowType, fixture.disabledUserId, asset.id),
        },
        true
      );
      fixture.workflows.push({ id: workflow.id, flowType, name });
      progress();
    }
  } catch (error) {
    await cleanup(fixture);
    throw error;
  }
}

assert(
  typeof browserFixtureIntent !== "undefined",
  "Run through browser-config-acceptance.cjs"
);
async function verifyPagination(intent) {
  const { fixture } = intent;
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  assert.equal(fixture.projects.length, 13);
  await request("auth.login", intent.login, true);
  const first = await request("project.page", { search: fixture.tag });
  assert.equal(first.items.length, 10); assert.equal(first.limit, 10); assert.equal(first.total, 13);
  const second = await request("project.page", { search: fixture.tag, page: 2 });
  assert.equal(second.items.length, 3); assert.equal(second.hasMore, false);
  assert.deepEqual([...first.items, ...second.items].map(item => item.id).sort(), fixture.projects.map(item => item.id).sort());
  assert.equal((await request("project.page", { search: fixture.tag, page: 999 })).page, 2);
  assert.equal((await request("project.page", { search: fixture.tag + "%_" })).total, 0);
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await request("project.page", { search: fixture.tag, createdFrom: tomorrow })).total, 0);
  await assert.rejects(request("project.page", { limit: 51 }));
  const codes = fixture.projects.slice(0, 2).map(item => item.code);
  assert((await request("project.activeDomains")).some(domain => domain.code === fixture.csvDomainCode));
  console.log(JSON.stringify({ fixture }));
  assert.deepEqual((await request("project.existingCodes", { codes })).sort(), codes.sort());
  await bootstrap();
  await request("iam.updateUserStatus", { userId: fixture.disabledUserId, status: "active" }, true);
  await request("auth.login", intent.memberLogin, true);
  assert.equal((await request("project.page", { search: fixture.tag })).total, 0);
  await assert.rejects(request("project.existingCodes", { codes }));
  await bootstrap();
  for (const project of fixture.projects.slice(0, 3))
    await request("project.grantMember", { projectId: project.id, userId: fixture.disabledUserId, role: "viewer" }, true);
  await request("auth.login", intent.memberLogin, true);
  const scoped = await request("project.page", { search: fixture.tag, limit: 2 });
  assert.equal(scoped.total, 3); assert.equal(scoped.items.length, 2);
  assert(scoped.items.every(item => fixture.projects.slice(0, 3).some(project => project.id === item.id)));
  await bootstrap();
  for (const project of fixture.projects.slice(0, 3))
    await request("project.revokeMember", { projectId: project.id, userId: fixture.disabledUserId }, true);
  await request("auth.login", intent.memberLogin, true);
  assert.equal((await request("project.page", { search: fixture.tag })).total, 0);
  await bootstrap();
  await request("iam.updateUserStatus", { userId: fixture.disabledUserId, status: "disabled" }, true);
  console.log(JSON.stringify({ stage: "project-page-api", scenarios: 10, pageSize: 10, secondPageItems: 3, scopedBeforePaging: true, revocationApplied: true }));
}
async function restoreOwnedWorkflows(fixture) {
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  await bootstrap();
  for (const workflow of fixture.workflows) {
    const current = await request("workflow.get", { id: workflow.id });
    assert.equal(current.ownerUserId, fixture.userId); assert.equal(current.name, workflow.name);
    if (current.archivedAt) await request("workflow.restore", { id: workflow.id }, true);
  }
  console.log(JSON.stringify({ restoredOwnWorkflows: fixture.workflows.length }));
}
async function verifyLifecycle(intent) {
  const { fixture } = intent;
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  await request("auth.login", intent.login, true);
  const preview = () => request("project.lifecyclePreview", { projectId: fixture.projectId });
  const initial = await preview();
  assert.equal(initial.ownerUserId, fixture.userId); assert.equal(initial.name, "界面隔离验收_" + fixture.tag);
  assert.equal(initial.lifecycleVersion, 1); assert.equal(initial.workflowCount, 3);
  const change = (row, status) => request("project.changeStatus", { projectId: fixture.projectId, status, expectedVersion: row.lifecycleVersion, expectedWorkflowCount: row.workflowCount }, true);
  const control = fixture.workflows.find(flow => flow.flowType === "control");
  const run = await request("workflow.run", { workflowId: control.id, triggerType: "test", idempotencyKey: fixture.tag + "_archive_guard" }, true);
  fixture.runs = [{ id: run.runId, workflowId: control.id }];
  console.log(JSON.stringify({ fixture }));
  await assert.rejects(change(initial, "archived"));
  assert.equal((await preview()).status, "active");
  await request("workflow.cancelRun", { runId: run.runId }, true);
  const cancelled = await request("workflow.runDetail", { runId: run.runId });
  assert.equal(cancelled.status, "cancelled");
  const competing = await Promise.allSettled([change(initial, "archived"), change(initial, "archived")]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  const archived = await preview();
  assert.equal(archived.lifecycleVersion, 2); assert.equal(archived.workflowCount, 0); assert.equal(archived.archivedWorkflowCount, 3);
  assert.equal((await request("project.page", { search: fixture.tag })).items.length, 0);
  const archivePage = await request("project.page", { search: fixture.tag, status: "archived" });
  assert.equal(archivePage.total, 1); assert.equal(archivePage.items[0].id, fixture.projectId);
  assert((await request("workflow.archived", { projectId: fixture.projectId })).every(flow => !flow.canRestore));
  await assert.rejects(request("workflow.restore", { id: control.id }, true));
  await assert.rejects(request("workflow.run", { workflowId: control.id, triggerType: "test" }, true));
  await assert.rejects(request("project.createWorkflow", { projectId: fixture.projectId, name: "不应创建", flowType: "control" }, true));
  await assert.rejects(request("data.createSource", { projectId: fixture.projectId, name: "不应创建", sourceType: "inline", connection: {} }, true));
  await bootstrap();
  await request("iam.updateUserStatus", { userId: fixture.disabledUserId, status: "active" }, true);
  // Granting an owner role is a lifecycle operation; restore before configuring it.
  await change(archived, "active");
  await request("project.grantMember", { projectId: fixture.projectId, userId: fixture.disabledUserId, role: "viewer" }, true);
  await request("auth.login", intent.memberLogin, true);
  const viewer = await preview(); assert.equal(Boolean(viewer.canManageArchive), false);
  await assert.rejects(change(viewer, "archived"));
  await bootstrap();
  await request("project.grantMember", { projectId: fixture.projectId, userId: fixture.disabledUserId, role: "owner" }, true);
  await request("auth.login", intent.memberLogin, true);
  const owner = await preview(); assert.equal(Boolean(owner.canManageArchive), true);
  await change(owner, "archived");
  const closed = await preview();
  assert.equal((await request("workflow.archived", { projectId: fixture.projectId })).length, 3);
  assert.equal((await request("workflow.get", { id: control.id })).projectStatus, "archived");
  const resources = await request("data.resources", { projectId: fixture.projectId });
  assert.equal(resources.assets.length, 1);
  await change(closed, "active");
  const reopened = await preview();
  assert.equal(reopened.lifecycleVersion, 5); assert.equal(reopened.workflowCount, 0);
  await assert.rejects(change(initial, "archived"));
  await bootstrap();
  await request("project.revokeMember", { projectId: fixture.projectId, userId: fixture.disabledUserId }, true);
  await request("iam.updateUserStatus", { userId: fixture.disabledUserId, status: "disabled" }, true);
  const audits = await request("iam.authorizationAudit", { limit: 200 });
  assert(audits.some(row => row.resourceId === fixture.projectId && row.action === "project_archived"));
  assert(audits.some(row => row.resourceId === fixture.projectId && row.action === "project_restored"));
  await restoreOwnedWorkflows(fixture);
  console.log(JSON.stringify({ stage: "project-lifecycle-api", scenarios: 12, pendingRunBlocked: true, competingArchivesSingleWinner: true, staleRevisionDenied: true, ordinaryOwnerManaged: true, viewerDenied: true, historicalReadAllowed: true, noAutomaticPublication: true, auditLabels: true }));
}
async function cycleStatus(fixture) {
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  await bootstrap();
  const username = fixture.tag + "_created";
  const directory = await request("iam.userDirectory", {
    search: username,
    offset: 0,
    limit: 10,
  });
  const person = directory.items.find(item => item.username === username);
  assert.equal(
    person?.id,
    fixture.people.find(item => item.username === username)?.id
  );
  assert.equal(person?.role, "user");
  assert.equal(person?.status, "active");
  assert.equal(person?.name, "保留填写_" + fixture.tag);
  const disabled = await request(
    "iam.updateUserStatus",
    {
      userId: person.id,
      status: "disabled",
      expectedStatus: "active",
      expectedVersion: person.statusVersion,
    },
    true
  );
  await request(
    "iam.updateUserStatus",
    {
      userId: person.id,
      status: "active",
      expectedStatus: "disabled",
      expectedVersion: disabled.statusVersion,
    },
    true
  );
  console.log(JSON.stringify({ ownAccountCycled: true }));
}
if (browserFixtureIntent.action === "setup") await setup(browserFixtureIntent);
else if (browserFixtureIntent.action === "verify_pagination") await verifyPagination(browserFixtureIntent);
else if (browserFixtureIntent.action === "verify_lifecycle") await verifyLifecycle(browserFixtureIntent);
else if (browserFixtureIntent.action === "restore_owned_workflows") await restoreOwnedWorkflows(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "cycle_status")
  await cycleStatus(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "grant_identity")
  await grantIdentity(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "revoke_identity")
  await revokeIdentity(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "cleanup")
  await cleanup(browserFixtureIntent.fixture);
else throw new Error("Unknown fixture action");
