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
let userId;
let unit;
let roleId;
const verifyList = process.env.FLOW_ORG_LIST === "1";
const roleCode = `custom_org_view_${tag}`;
const member = new Session();
let targetFlow;
let customRoleCreated = false;
try {
  const memberPassword = `Test9_${randomBytes(24).toString("base64url")}`;
  const created = await admin.request(
    "iam.createUser",
    {
      username: `role_live_${tag}`,
      name: `权限来源测试_${tag}`,
      password: memberPassword,
      role: "user",
    },
    true
  );
  userId = created.userId;
  if (verifyList) {
    await member.request("auth.login", { username: `role_live_${tag}`, password: memberPassword }, true);
    const project = await admin.request("project.create", { code: `ORGLIST_${tag}`, name: `组织列表隔离_${tag}` }, true);
    targetFlow = await admin.request("project.createWorkflow", { projectId: project.id, name: `组织查看隔离_${tag}`, flowType: "control" }, true);
    assert(!(await member.request("workflow.list", {})).some(flow => flow.id === targetFlow.id));
    await admin.request("iam.createCustomRole", { code: roleCode, name: `组织查看角色_${tag}`, scope: "system", permissions: ["workflow:view"] }, true);
    customRoleCreated = true;
  }
  unit = await admin.request(
    "config.createOrganizationUnit",
    { code: `ROLELIVE_${tag}`.toUpperCase(), name: `权限来源部门_${tag}` },
    true
  );
  await admin.request(
    "config.assignOrganizationMember",
    { unitId: unit.id, userId, isPrimary: true },
    true
  );
  const role = (await admin.request("iam.roles", { scope: "system" })).find(
    r => r.code === (verifyList ? roleCode : "workflow_creator")
  );
  assert(role);
  roleId = Number(role.id);
  const details = () =>
    admin.request("iam.userAuthorizationDetails", { userId });
  await admin.request(
    "config.bindOrganizationRole",
    {
      unitId: unit.id,
      roleId,
      includeDescendants: false,
      expiresAt: new Date(Date.now() + (verifyList ? 8000 : 5000)),
    },
    true
  );
  let current = await details();
  assert.equal(current.inheritedRoles.length, 1);
  assert.equal(
    current.inheritedRoles[0].unitCode,
    `ROLELIVE_${tag}`.toUpperCase()
  );
  assert(current.inheritedRoles[0].expiresAt instanceof Date);
  const permissionCode = verifyList ? "workflow:view" : "workflow:create";
  assert(current.effectivePermissions.some(p => p.code === permissionCode));
  if (verifyList) {
    assert((await member.request("workflow.list", {})).some(flow => flow.id === targetFlow.id));
    assert.equal((await member.request("workflow.get", { id: targetFlow.id })).id, targetFlow.id);
  }
  current = await waitFor(
    details,
    value => value.inheritedRoles.length === 0,
    "inherited role expiry"
  );
  assert.equal(
    current.effectivePermissions.some(p => p.code === permissionCode),
    false
  );
  if (verifyList) assert(!(await member.request("workflow.list", {})).some(flow => flow.id === targetFlow.id));
  await admin.request(
    "config.bindOrganizationRole",
    { unitId: unit.id, roleId, includeDescendants: false, expiresAt: null },
    true
  );
  assert.equal((await details()).inheritedRoles.length, 1);
  await admin.request(
    "config.unbindOrganizationRole",
    { unitId: unit.id, roleId },
    true
  );
  assert.equal((await details()).inheritedRoles.length, 0);
  if (verifyList) assert(!(await member.request("workflow.list", {})).some(flow => flow.id === targetFlow.id));
  await admin.request(
    "config.bindOrganizationRole",
    { unitId: unit.id, roleId, includeDescendants: false, expiresAt: null },
    true
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId, status: "disabled" },
    true
  );
  current = await details();
  assert.equal(current.user.status, "disabled");
  assert.equal(
    current.inheritedRoles.length,
    1,
    "Configured source remains inspectable for disabled account"
  );
  assert.deepEqual(current.effectivePermissions, []);
  console.log(
    JSON.stringify({
      userId,
      unitId: unit.id,
      inheritedExpiryRemoved: true,
      unbindRemoved: true,
      unitCodeIncluded: true,
      disabledHasNoEffectivePermissions: true,
      inheritedWorkflowListVerified: verifyList,
    })
  );
} finally {
  const tree = unit ? await admin.request("config.organization", {}) : null;
  if (
    unit &&
    roleId &&
    tree.roleBindings.some(
      binding => binding.unitId === unit.id && Number(binding.roleId) === roleId
    )
  )
    await admin.request(
      "config.unbindOrganizationRole",
      { unitId: unit.id, roleId },
      true
    );
  if (
    unit &&
    userId &&
    tree.members.some(
      member => member.unitId === unit.id && Number(member.userId) === userId
    )
  )
    await admin.request(
      "config.removeOrganizationMember",
      { unitId: unit.id, userId },
      true
    );
  if (userId)
    await admin.request(
      "iam.updateUserStatus",
      { userId, status: "disabled" },
      true
    );
  if (unit)
    await admin.request(
      "config.updateOrganizationUnit",
      { id: unit.id, status: "disabled" },
      true
    );
  if (customRoleCreated) await admin.request("iam.deleteCustomRole", { code: roleCode }, true);
  console.log(
    JSON.stringify({
      cleanup:
        "own role binding and membership removed; own account and department disabled",
    })
  );
}
