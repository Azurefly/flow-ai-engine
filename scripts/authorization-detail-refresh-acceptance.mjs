import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
// Isolated temporary account and role; no existing user or role changes.
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const json = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body: json } : {}),
    }
  );
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(body.error?.json?.message ?? `HTTP ${response.status}`);
  return superjson.deserialize(body.result.data);
}
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(
  username && password,
  "Bootstrap credentials must be supplied by server environment"
);
await request("auth.login", { username, password }, true);
const stage = process.env.FLOW_AUTH_STAGE ?? "prepare";
assert(["prepare", "arm", "verify", "cleanup"].includes(stage));
if (stage === "prepare") {
  const tag = randomBytes(4).toString("hex");
  const roleCode = `custom_refresh_${tag}`;
  await request(
    "iam.createCustomRole",
    {
      code: roleCode,
      name: `权限刷新角色_${tag}`,
      description: "隔离临时刷新验收",
      scope: "system",
      permissions: ["workflow:create"],
    },
    true
  );
  const user = await request(
    "iam.createUser",
    {
      username: `authrefresh_${tag}`,
      password: `Test9_${randomBytes(24).toString("hex")}`,
      name: `权限刷新验证_${tag}`,
      role: "user",
    },
    true
  );
  await request(
    "iam.assignSystemRole",
    {
      userId: user.userId,
      roleCode,
      expiresAt: new Date(Date.now() + 600_000),
      note: "隔离临时刷新验收",
    },
    true
  );
  const detail = await request("iam.userAuthorizationDetails", {
    userId: user.userId,
  });
  const assignment = detail.directRoles.find(r => r.roleCode === roleCode);
  assert(assignment);
  const role = (await request("iam.roles", {})).find(r => r.code === roleCode);
  console.log(
    JSON.stringify({
      stage,
      userId: user.userId,
      username: detail.user.username,
      name: detail.user.name,
      roleCode,
      roleId: role.id,
      assignmentId: assignment.assignmentId,
    })
  );
} else {
  const userId = Number(process.env.FLOW_UI_USER_ID);
  assert(Number.isSafeInteger(userId) && userId > 0);
  const detail = await request("iam.userAuthorizationDetails", { userId });
  const match = /^authrefresh_([a-f0-9]{8})$/.exec(detail.user.username);
  assert(match, "Only isolated refresh fixture may be changed");
  const roleCode = `custom_refresh_${match[1]}`;
  const role = (await request("iam.roles", {})).find(r => r.code === roleCode);
  if (stage !== "cleanup")
    assert(role && role.description === "隔离临时刷新验收");
  if (stage === "arm") {
    const expirySeconds = Number(process.env.FLOW_AUTH_EXPIRY_SECONDS ?? "8");
    assert(
      Number.isSafeInteger(expirySeconds) &&
        expirySeconds >= 5 &&
        expirySeconds <= 120
    );
    const previousIds = new Set(
      detail.directRoles
        .filter(r => r.roleCode === roleCode)
        .map(r => r.assignmentId)
    );
    if (process.env.FLOW_TEST_PREVIOUS_ASSIGNMENT_ID) {
      assert.match(
        process.env.FLOW_TEST_PREVIOUS_ASSIGNMENT_ID,
        /^[a-f0-9-]{36}$/
      );
      previousIds.add(process.env.FLOW_TEST_PREVIOUS_ASSIGNMENT_ID);
    }
    for (const assignmentId of previousIds)
      await request("iam.revokeRoleAssignment", { assignmentId }, true);
    const expiresAt = new Date(Date.now() + expirySeconds * 1000);
    await request(
      "iam.assignSystemRole",
      { userId, roleCode, expiresAt, note: "隔离临时刷新验收" },
      true
    );
    const assignment = (
      await request("iam.userAuthorizationDetails", { userId })
    ).directRoles.find(r => r.roleCode === roleCode);
    assert(assignment);
    assert(
      (
        await request("iam.roleAuthorizationDetails", { roleId: role.id })
      ).directUsers.some(u => Number(u.userId) === userId)
    );
    console.log(
      JSON.stringify({
        stage,
        userId,
        roleCode,
        roleId: role.id,
        expiresAt,
        assignmentId: assignment.assignmentId,
        activeSourceVerified: true,
      })
    );
  } else if (stage === "verify") {
    assert(!detail.directRoles.some(r => r.roleCode === roleCode));
    assert(
      !(
        await request("iam.roleAuthorizationDetails", { roleId: role.id })
      ).directUsers.some(u => Number(u.userId) === userId)
    );
    const candidates = await request("iam.roleAssignableUsers", {
      roleId: role.id,
      search: detail.user.username,
      offset: 0,
      limit: 10,
    });
    assert(candidates.items.some(u => Number(u.id) === userId));
    console.log(
      JSON.stringify({
        stage,
        userId,
        expiredSourceRemoved: true,
        roleUserSourceRemoved: true,
        candidateAvailableAgain: true,
      })
    );
  } else {
    const assignmentIds = new Set(
      detail.directRoles
        .filter(r => r.roleCode === roleCode)
        .map(r => r.assignmentId)
    );
    if (process.env.FLOW_TEST_ASSIGNMENT_ID) {
      assert.match(process.env.FLOW_TEST_ASSIGNMENT_ID, /^[a-f0-9-]{36}$/);
      assignmentIds.add(process.env.FLOW_TEST_ASSIGNMENT_ID);
    }
    for (const assignmentId of role ? assignmentIds : [])
      await request("iam.revokeRoleAssignment", { assignmentId }, true);
    await request("iam.updateUserStatus", { userId, status: "disabled" }, true);
    if (role) await request("iam.deleteCustomRole", { code: roleCode }, true);
    console.log(
      JSON.stringify({
        stage,
        userId,
        ownAccountDisabled: true,
        ownRoleRemoved: true,
      })
    );
  }
}
