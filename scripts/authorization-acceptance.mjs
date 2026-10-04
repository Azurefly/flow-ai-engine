import superjson from "superjson";
// Public-service regression only; no database writes, token printing, or production task changes.
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
  username: `auth_${tag}`,
  password: randomBytes(24).toString("base64url"),
};
const created = await admin.request(
  "iam.createUser",
  { ...login, name: `授权有效期测试_${tag}`, role: "user" },
  true
);
const userId = created.userId;
try {
  const expiresAt = new Date(Date.now() + 3_600_000);
  await admin.request(
    "iam.assignSystemRole",
    {
      userId,
      roleCode: "workflow_creator",
      expiresAt,
      note: "独立测试：临时授权一小时",
    },
    true
  );
  let details = await admin.request("iam.userAuthorizationDetails", { userId });
  const assignment = details.directRoles.find(
    role => role.roleCode === "workflow_creator"
  );
  assert(assignment, "Temporary role missing");
  assert(
    Math.abs(new Date(assignment.expiresAt).getTime() - expiresAt.getTime()) <
      1000
  );
  assert.equal(assignment.note, "独立测试：临时授权一小时");
  assert(
    details.effectivePermissions.some(
      permission => permission.code === "workflow:create"
    )
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
  details = await admin.request("iam.userAuthorizationDetails", { userId });
  assert.equal(details.effectivePermissions.length, 0);
  assert(
    details.directRoles.some(
      role => role.assignmentId === assignment.assignmentId
    )
  );
  await assert.rejects(
    admin.request(
      "iam.assignSystemRole",
      { userId, roleCode: "workflow_creator" },
      true
    ),
    /启用/
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "active" },
    true
  );
  details = await admin.request("iam.userAuthorizationDetails", { userId });
  assert(
    details.effectivePermissions.some(
      permission => permission.code === "workflow:create"
    )
  );
  await admin.request(
    "iam.revokeRoleAssignment",
    { assignmentId: assignment.assignmentId },
    true
  );
  details = await admin.request("iam.userAuthorizationDetails", { userId });
  assert(
    !details.directRoles.some(
      role => role.assignmentId === assignment.assignmentId
    )
  );
  assert(
    !details.effectivePermissions.some(
      permission => permission.code === "workflow:create"
    )
  );
  console.log(
    JSON.stringify({
      userId,
      temporaryExpiryPreserved: true,
      disabledPermissionsEmpty: true,
      reenabledPermissionsRestored: true,
      revokedPermissionsRemoved: true,
    })
  );
} finally {
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
}
