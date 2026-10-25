// Isolated API acceptance against the one authorized deployment. Never retries writes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
const base = "http://124.223.198.84:1180/";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const body = JSON.stringify(superjson.serialize(input));
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
    const result = await response.json();
    if (!response.ok || result.error)
      throw Object.assign(
        new Error(
          path + ": " + (result.error?.json?.message ?? response.status)
        ),
        { status: response.status }
      );
    return superjson.deserialize(result.result.data);
  }
}
const admin = new Session();
assert(
  process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  "Existing admin login configuration is required"
);
await admin.request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
const tag = randomBytes(5).toString("hex"),
  fixture = {
    tag,
    projectId: null,
    workflowId: null,
    userId: null,
    runIds: [],
  };
const remember = () => console.log(JSON.stringify({ fixture }));
const project = await admin.request(
  "project.create",
  { code: "HISTORY_" + tag, name: "历史查询验收_" + tag },
  true
);
fixture.projectId = project.id;
remember();
const source = await admin.request(
  "data.createSource",
  {
    projectId: project.id,
    name: "隔离内联源",
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
    name: "隔离样本",
    assetType: "dataset",
    schema: [{ name: "value", type: "number" }],
    sample: [{ value: 1 }],
  },
  true
);
const specs = [
  ["start", "start", {}],
  ["source", "source", { assetId: asset.id, limit: 10 }],
  ["end", "end", {}],
];
const definition = {
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: specs.map(([id, type, config], i) => ({
    id,
    type,
    config,
    name: id,
    position: { x: 200 * i, y: 0 },
  })),
  edges: specs
    .slice(1)
    .map(([id], i) => ({
      id: "edge-" + i,
      sourceNodeId: specs[i][0],
      targetNodeId: id,
    })),
};
const flow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: "HISTORY_" + tag,
    flowType: "data",
    definition,
  },
  true
);
fixture.workflowId = flow.id;
remember();
let current = await admin.request("workflow.get", { id: flow.id });
await admin.request(
  "project.auditWorkflow",
  {
    projectId: project.id,
    workflowId: flow.id,
    auditStatus: "approved",
    expectedDefinitionVersion: Number(current.definitionVersion),
    expectedAuditStatus: current.auditStatus,
  },
  true
);
current = await admin.request("workflow.get", { id: flow.id });
await admin.request(
  "workflow.publish",
  { id: flow.id, expectedDefinitionVersion: Number(current.definitionVersion) },
  true
);
for (let i = 0; i < 35; i++) {
  const run = await admin.request(
    "data.run",
    { projectId: project.id, workflowId: flow.id },
    true
  );
  fixture.runIds.push(run.runId);
  remember();
}
for (const runId of fixture.runIds) {
  let complete;
  for (let attempt = 0; attempt < 60; attempt++) {
    complete = await admin.request("data.runDetail", {
      projectId: project.id,
      runId,
    });
    if (["success", "failed"].includes(complete.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(complete.status, "success");
  assert.deepEqual(complete.output.terminals[0].rows, [{ value: 1 }]);
}
let cursor,
  ids = [],
  pages = 0;
do {
  const page = await admin.request("data.runPage", {
    projectId: project.id,
    limit: 10,
    cursor,
  });
  assert(page.items.length <= 10);
  assert.equal(page.hasMore, Boolean(page.nextCursor));
  for (const row of page.items) {
    assert(!ids.includes(row.id), "Repeated row across pages");
    assert(!Object.hasOwn(row, "outputJson"));
    assert(!Object.hasOwn(row, "cursorCreatedAt"));
    ids.push(row.id);
  }
  cursor = page.nextCursor ?? undefined;
  assert(++pages <= 4);
} while (cursor);
assert.deepEqual(new Set(ids), new Set(fixture.runIds));
assert.equal(pages, 4);
const oldest = await admin.request("data.runPage", {
  projectId: project.id,
  search: fixture.runIds[0],
});
assert.deepEqual(
  oldest.items.map(row => row.id),
  [fixture.runIds[0]]
);
const filtered = await admin.request("data.runPage", {
  projectId: project.id,
  workflowId: flow.id,
  limit: 100,
  search: "HISTORY_" + tag,
  status: "success",
  createdFrom: new Date(Date.now() - 3600000),
  createdBefore: new Date(Date.now() + 60000),
});
assert.equal(filtered.items.length, 35);
const actorId = filtered.items[0].triggeredByUserId;
assert.equal(
  (
    await admin.request("data.runPage", {
      projectId: project.id,
      trigger: String(actorId),
      limit: 100,
    })
  ).items.length,
  35
);
assert.equal(
  (await admin.request("data.runPage", { projectId: project.id, search: "%" }))
    .items.length,
  0
);
assert.equal(
  (
    await admin.request("data.runPage", {
      projectId: project.id,
      status: "failed",
    })
  ).items.length,
  0
);
await assert.rejects(
  admin.request("data.runPage", { projectId: project.id, cursor: "broken" }),
  error => error.status === 400
);
await assert.rejects(
  admin.request("data.runPage", {
    projectId: project.id,
    createdFrom: new Date(),
    createdBefore: new Date(0),
  }),
  error => error.status === 400
);
const password = randomBytes(24).toString("base64url"),
  username = "history_" + tag;
const outsider = await admin.request(
  "iam.createUser",
  { username, password, name: "隔离无权用户_" + tag, role: "user" },
  true
);
fixture.userId = outsider.userId;
remember();
try {
  const denied = new Session();
  await denied.request("auth.login", { username, password }, true);
  await assert.rejects(
    denied.request("data.runPage", { projectId: project.id }),
    error => error.status === 403
  );
} finally {
  await admin.request(
    "iam.updateUserStatus",
    { userId: fixture.userId, status: "disabled" },
    true
  );
}
console.log(
  JSON.stringify({
    accepted: true,
    fixture,
    pages,
    uniqueRuns: ids.length,
    oldestSearchable: true,
    filtersVerified: true,
    projectPermissionPreserved: true,
    writesRetried: 0,
  })
);
