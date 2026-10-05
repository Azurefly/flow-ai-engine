import superjson from "superjson";
// Isolated directory boundary regression; creates test accounts and disables them in finally. No direct SQL or credential output.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const json = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body: json } : {}),
      }
    );
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        `${path}: ${payload.error?.json?.message ?? response.status}`
      );
    return superjson.deserialize(payload.result.data);
  }
}
async function waitFor(read, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const admin = new Session();
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await admin.request("auth.login", { username, password }, true);

const tag = randomBytes(4).toString("hex");
const userIds = [];
const project = await admin.request(
  "project.create",
  { code: `DIR_${tag}`.toUpperCase(), name: `人员目录边界验证_${tag}` },
  true
);
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `人员目录边界_${tag}`,
    flowType: "control",
    definition: {
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
          id: "end",
          type: "end",
          name: "结束",
          config: {},
          position: { x: 300, y: 0 },
        },
      ],
      edges: [{ id: "s-e", sourceNodeId: "start", targetNodeId: "end" }],
    },
  },
  true
);
try {
  for (let offset = 0; offset < 201; offset += 30) {
    const users = Array.from(
      { length: Math.min(30, 201 - offset) },
      (_, i) => ({
        username: `dir_${tag}_${offset + i}`,
        name: `AAA_目录边界_${tag}_${offset + i}`,
        password: randomBytes(24).toString("base64url"),
        role: "user",
      })
    );
    const result = await admin.request("iam.createUsersBatch", { users }, true);
    userIds.push(...result.results.filter(r => r.success).map(r => r.userId));
    assert.equal(
      result.failed,
      0,
      "Isolated directory fixtures must be created"
    );
    console.log(
      JSON.stringify({ scenario: "directory-setup", created: userIds.length })
    );
  }
  const login = {
    username: `dir_target_${tag}`,
    password: randomBytes(24).toString("base64url"),
  };
  const created = await admin.request(
    "iam.createUser",
    { ...login, name: `ZZZ_目录目标_${tag}`, role: "user" },
    true
  );
  const targetId = created.userId;
  userIds.push(targetId);
  const directory = input =>
    admin.request("workflow.memberCandidates", {
      workflowId: workflow.id,
      ...input,
    });
  assert.equal(
    (await directory({})).some(u => u.id === targetId),
    false,
    "Target must be outside legacy first 200"
  );
  assert.deepEqual(await directory({ query: "", selectedIds: [] }), []);
  for (const query of [`ZZZ_目录目标_${tag}`, login.username]) {
    const matches = await directory({ query, selectedIds: [] });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, targetId);
  }
  assert.equal(
    (await directory({ query: "", selectedIds: [targetId] }))[0].id,
    targetId
  );
  const many = await directory({
    query: `AAA_目录边界_${tag}`,
    selectedIds: [],
  });
  assert.equal(many.length, 51, "Search response must be bounded");
  const user = new Session();
  await user.request("auth.login", login, true);
  await assert.rejects(
    () =>
      user.request("workflow.memberCandidates", {
        workflowId: workflow.id,
        query: tag,
        selectedIds: [],
      }),
    /无权管理流程成员/
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId: targetId, status: "disabled" },
    true
  );
  assert.deepEqual(
    await directory({ query: login.username, selectedIds: [targetId] }),
    []
  );
  await assert.rejects(
    () =>
      admin.request(
        "workflow.grantMember",
        { workflowId: workflow.id, userId: targetId, role: "viewer" },
        true
      ),
    /停用/
  );
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: workflow.id,
      targetId,
      legacyLimit: 200,
      fixtureAccounts: 202,
      searchByName: true,
      searchByUsername: true,
      disabledExcluded: true,
      unauthorizedSearchDenied: true,
    })
  );
} finally {
  for (let i = 0; i < userIds.length; i += 10)
    await Promise.all(
      userIds
        .slice(i, i + 10)
        .map(userId =>
          admin.request(
            "iam.updateUserStatus",
            { userId, status: "disabled" },
            true
          )
        )
    );
  console.log(
    JSON.stringify({ scenario: "directory-cleanup", disabled: userIds.length })
  );
}
