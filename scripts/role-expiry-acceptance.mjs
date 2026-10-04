// Public-service regression only; no database writes, token printing, or production task changes.
import assert from "node:assert/strict";
import superjson from "superjson";
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
    return payload.result.data.json;
  }
}
const admin = new Session();
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await admin.request("auth.login", { username, password }, true);
const tag = randomBytes(4).toString("hex");
const project = await admin.request(
  "project.create",
  { code: `EXPIRY_${tag}`, name: `临时授权测试_${tag}` },
  true
);
assert.equal(
  (await admin.request("project.get", { projectId: project.id })).id,
  project.id
);
assert.equal(
  await admin.request("project.get", { projectId: "missing-project-fixture" }),
  null
);
const login = {
  username: `expiry_${tag}`,
  password: randomBytes(24).toString("base64url"),
};
const created = await admin.request(
  "iam.createUser",
  { ...login, name: `临时授权测试_${tag}`, role: "user" },
  true
);
const userId = created.userId;
try {
  const actor = new Session();
  await actor.request("auth.login", login, true);
  const expiresAt = new Date(Date.now() + 3_600_000);
  await admin.request(
    "project.grantMember",
    { projectId: project.id, userId, role: "viewer", expiresAt },
    true
  );
  const read = () =>
    admin.request("project.members", { projectId: project.id });
  const member = (await read()).find(row => row.userId === userId);
  assert(member && member.expiresAt);
  assert(Math.abs(Date.parse(member.expiresAt) - expiresAt.getTime()) < 1000);
  assert(
    (
      await actor.request("project.access", { projectId: project.id })
    ).roles.includes("viewer")
  );
  await assert.rejects(
    () =>
      admin.request(
        "project.grantMember",
        {
          projectId: project.id,
          userId,
          role: "owner",
          expiresAt: new Date("2100-01-01T00:00:00Z"),
        },
        true
      ),
    /有效期/
  );
  const unchanged = (await read()).find(row => row.userId === userId);
  assert.equal(unchanged.role, "viewer");
  assert.equal(unchanged.expiresAt, member.expiresAt);
  await admin.request(
    "project.revokeMember",
    { projectId: project.id, userId },
    true
  );
  assert(
    !(
      await actor.request("project.access", { projectId: project.id })
    ).roles.includes("viewer")
  );
  await admin.request(
    "project.grantMember",
    { projectId: project.id, userId, role: "viewer" },
    true
  );
  assert.equal(
    (await read()).find(row => row.userId === userId).expiresAt,
    null
  );
  console.log(
    JSON.stringify({
      projectId: project.id,
      temporaryGrant: true,
      invalidGrantPreservedOriginal: true,
      revokeRemovedAccess: true,
      blankGrantsLongTerm: true,
    })
  );
} finally {
  await admin.request(
    "project.revokeMember",
    { projectId: project.id, userId },
    true
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
}
