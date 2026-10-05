import superjson from "superjson";
// Isolated public-service regression; no direct SQL, secrets, or existing account changes.
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
const login = {
  username: `wm_${tag}`,
  password: randomBytes(24).toString("base64url"),
};
const created = await admin.request(
  "iam.createUser",
  { ...login, name: `协作状态测试_${tag}`, role: "user" },
  true
);
const userId = created.userId;
const project = await admin.request(
  "project.create",
  { code: `MEMBER_${tag}`.toUpperCase(), name: `成员状态验证_${tag}` },
  true
);
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `成员状态验证_${tag}`,
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
      edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
    },
  },
  true
);
const member = async () =>
  (await admin.request("workflow.members", { workflowId: workflow.id })).find(
    m => m.userId === userId && m.role === "viewer"
  );
try {
  await admin.request(
    "workflow.grantMember",
    {
      workflowId: workflow.id,
      userId,
      role: "viewer",
      expiresAt: new Date(Date.now() + 5000),
    },
    true
  );
  assert.equal((await member()).authorizationStatus, "active");
  const user = new Session();
  await user.request("auth.login", login, true);
  await user.request("workflow.get", { id: workflow.id });
  await waitFor(
    member,
    m => m?.authorizationStatus === "expired",
    "member expiration"
  );
  await assert.rejects(
    () => user.request("workflow.get", { id: workflow.id }),
    /无访问权限/
  );
  await admin.request(
    "workflow.grantMember",
    { workflowId: workflow.id, userId, role: "viewer" },
    true
  );
  assert.equal((await member()).authorizationStatus, "active");
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
  assert.equal((await member()).authorizationStatus, "disabled");
  await assert.rejects(
    () => user.request("workflow.get", { id: workflow.id }),
    /Please login/
  );
  await admin.request(
    "workflow.revokeMember",
    { workflowId: workflow.id, userId, role: "viewer" },
    true
  );
  assert.equal((await member()).authorizationStatus, "revoked");
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: workflow.id,
      userId,
      statuses: ["active", "expired", "active", "disabled", "revoked"],
      expiredAccessDenied: true,
      disabledAccessDenied: true,
    })
  );
} finally {
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
  const remaining = await member();
  if (remaining && !remaining.revokedAt)
    await admin.request(
      "workflow.revokeMember",
      { workflowId: workflow.id, userId, role: "viewer" },
      true
    );
}
