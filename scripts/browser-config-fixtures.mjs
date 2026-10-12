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
      disabledOwnAccounts: people.length,
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
  const fixture = { tag: intent.tag, people: [], workflows: [] };
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
    const project = await request(
      "project.create",
      { code: intent.tag.toUpperCase(), name: "界面隔离验收_" + intent.tag },
      true
    );
    fixture.projectId = project.id;
    progress();
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
else if (browserFixtureIntent.action === "cycle_status")
  await cycleStatus(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "grant_identity")
  await grantIdentity(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "revoke_identity")
  await revokeIdentity(browserFixtureIntent.fixture);
else if (browserFixtureIntent.action === "cleanup")
  await cleanup(browserFixtureIntent.fixture);
else throw new Error("Unknown fixture action");
