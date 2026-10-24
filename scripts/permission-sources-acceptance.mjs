import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    // Sequential fixture maintenance reads current configuration; conflict tests pass their own token.
    if (mutation && ["iam.updateCustomRole", "iam.deleteCustomRole"].includes(path) && input?.expectedConfigToken === undefined) {
      const current = await this.request("iam.customRoleConfiguration", { code: input.code });
      input = { ...input, expectedConfigToken: current.configToken };
    }
    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body } : {}),
        signal: AbortSignal.timeout(30000),
      }
    );
    const nextCookie = response.headers.getSetCookie()[0];
    if (nextCookie) this.cookie = nextCookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        payload.error?.json?.message ?? `HTTP ${response.status}`
      );
    return superjson.deserialize(payload.result.data);
  }
}
const admin = new Session(),
  member = new Session();
const legacy = process.env.FLOW_EXPECT_LEGACY_SOURCES === "1";
const tag = randomBytes(6).toString("hex");
const people = [],
  roles = [],
  units = [],
  memberships = [],
  bindings = [],
  workflows = [];
let person, project, workflow, reader, editor, scoped;
const privateKeys = ["passwordHash", "tokenVersion", "token"];
function assertPublic(account) {
  for (const key of privateKeys)
    assert.equal(
      Object.hasOwn(account, key),
      false,
      `Public account leaked ${key}`
    );
}
async function details(userId = person.id) {
  return admin.request("iam.userAuthorizationDetails", { userId });
}
async function snapshot(name, codes, expectedSources = {}) {
  const data = await details();
  assert.deepEqual(
    data.effectivePermissions.map(p => p.code).sort(),
    [...codes].sort()
  );
  if (!legacy)
    for (const [code, kinds] of Object.entries(expectedSources)) {
      const permission = data.effectivePermissions.find(p => p.code === code);
      assert.deepEqual(
        permission.sources.map(source => source.kind).sort(),
        [...kinds].sort()
      );
      assert(
        permission.sourceLabels.every(
          label => typeof label === "string" && label.length > 0
        )
      );
    }
  console.log(
    JSON.stringify({ scenario: name, permissionCodes: codes, legacy })
  );
  return data;
}
async function revokeAll(code) {
  for (const grant of (await details()).directRoles.filter(
    item => item.roleCode === code
  ))
    await admin.request(
      "iam.revokeRoleAssignment",
      { assignmentId: grant.assignmentId },
      true
    );
}
await admin.request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
try {
  for (const type of ["user", "admin"]) {
    const login = {
      username: `source_${tag}_${type}`,
      password: "Test9_" + randomBytes(24).toString("base64url"),
    };
    const { userId } = await admin.request(
      "iam.createUser",
      { ...login, name: `权限来源隔离_${tag}_${type}`, role: type },
      true
    );
    const value = { id: userId, login };
    people.push(value);
    if (type === "user") person = value;
  }
  const loginResult = await member.request("auth.login", person.login, true);
  const current = await member.request("auth.me", null);
  if (legacy) assert(Object.hasOwn(current, "passwordHash"));
  else {
    assertPublic(loginResult);
    assertPublic(current);
    assert.equal(current.canManageIdentity, false);
  }
  console.log(
    JSON.stringify({
      scenario: "public_account_projection",
      privateKeysAbsent: !legacy,
    })
  );
  await snapshot("ordinary_without_grants", []);
  const builtIn = await details(people[1].id);
  assert.equal(builtIn.effectivePermissions.length, 7);
  if (!legacy) {
    assert(builtIn.authorizationSummary.includes("撤销角色不会移除"));
    for (const p of builtIn.effectivePermissions)
      assert.deepEqual(
        p.sources.map(s => s.kind),
        ["builtin"]
      );
  }
  console.log(
    JSON.stringify({
      scenario: "admin_builtin_without_role_bindings",
      permissions: 7,
    })
  );
  await admin.request(
    "iam.updateUserStatus",
    { userId: people[1].id, status: "disabled" },
    true
  );
  const inactiveAdmin = await details(people[1].id);
  assert.equal(inactiveAdmin.effectivePermissions.length, 0);
  if (!legacy)
    assert(inactiveAdmin.authorizationSummary.includes("内置权限暂不生效"));
  console.log(
    JSON.stringify({
      scenario: "disabled_admin_builtin_inactive",
      permissions: 0,
    })
  );
  for (const [label, scope, permissions] of [
    ["reader", "system", ["workflow:view"]],
    ["editor", "system", ["workflow:edit"]],
    ["scoped", "workflow", ["workflow:edit"]],
    ["manager", "system", ["iam:manage"]],
  ]) {
    const code = `custom_source_${label}_${tag}`;
    await admin.request(
      "iam.createCustomRole",
      { code, name: `来源_${label}_${tag}`, scope, permissions },
      true
    );
    roles.push(code);
  }
  const catalog = await admin.request("iam.roles", {});
  [reader, editor, scoped] = ["reader", "editor", "scoped"].map(label =>
    catalog.find(role => role.code === `custom_source_${label}_${tag}`)
  );
  project = await admin.request(
    "project.create",
    { code: `SOURCE_${tag}`.toUpperCase(), name: `权限来源隔离_${tag}` },
    true
  );
  workflow = await admin.request(
    "project.createWorkflow",
    { projectId: project.id, name: `来源范围_${tag}`, flowType: "control" },
    true
  );
  workflows.push(workflow.id);
  await admin.request(
    "workflow.assignCustomRole",
    { workflowId: workflow.id, userId: person.id, roleCode: scoped.code, expectedConfigToken: (await admin.request("iam.customRoleConfiguration", { code: scoped.code })).configToken },
    true
  );
  const scopedOnly = await snapshot("workflow_grant_not_global", []);
  assert(
    scopedOnly.directRoles.some(
      r => r.roleCode === scoped.code && r.scopeType === "workflow"
    )
  );
  await admin.request(
    "iam.assignSystemRole",
    { userId: person.id, roleCode: reader.code },
    true
  );
  await snapshot("direct_system_grant", ["workflow:view"], {
    "workflow:view": ["direct"],
  });
  const parent = await admin.request(
    "config.createOrganizationUnit",
    { code: `SRC_PARENT_${tag}`.toUpperCase(), name: `来源父部门_${tag}` },
    true
  );
  units.push(parent.id);
  const child = await admin.request(
    "config.createOrganizationUnit",
    {
      code: `SRC_CHILD_${tag}`.toUpperCase(),
      name: `来源子部门_${tag}`,
      parentUnitId: parent.id,
    },
    true
  );
  units.push(child.id);
  await admin.request(
    "config.assignOrganizationMember",
    { unitId: child.id, userId: person.id, isPrimary: true },
    true
  );
  memberships.push({ unitId: child.id, userId: person.id });
  for (const [unitId, roleId] of [
    [child.id, reader.id],
    [parent.id, editor.id],
  ]) {
    await admin.request(
      "config.bindOrganizationRole",
      { unitId, roleId, includeDescendants: true },
      true
    );
    bindings.push({ unitId, roleId });
  }
  await snapshot(
    "direct_and_inherited_multiple_sources",
    ["workflow:edit", "workflow:view"],
    {
      "workflow:edit": ["organization"],
      "workflow:view": ["direct", "organization"],
    }
  );
  await admin.request(
    "config.bindOrganizationRole",
    { unitId: parent.id, roleId: editor.id, includeDescendants: false },
    true
  );
  await snapshot("ancestor_without_descendants", ["workflow:view"], {
    "workflow:view": ["direct", "organization"],
  });
  await admin.request(
    "config.bindOrganizationRole",
    { unitId: parent.id, roleId: editor.id, includeDescendants: true },
    true
  );
  await admin.request(
    "config.updateOrganizationUnit",
    { id: parent.id, status: "disabled" },
    true
  );
  await snapshot("inactive_ancestor_excluded", ["workflow:view"], {
    "workflow:view": ["direct", "organization"],
  });
  await admin.request(
    "config.updateOrganizationUnit",
    { id: parent.id, status: "active" },
    true
  );
  await admin.request(
    "config.bindOrganizationRole",
    {
      unitId: parent.id,
      roleId: editor.id,
      includeDescendants: true,
      expiresAt: new Date(Date.now() + 3000),
    },
    true
  );
  for (let attempt = 0; attempt < 12; attempt++) {
    if (
      !(await details()).effectivePermissions.some(
        p => p.code === "workflow:edit"
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await snapshot("expired_ancestor_excluded", ["workflow:view"], {
    "workflow:view": ["direct", "organization"],
  });
  await revokeAll(reader.code);
  await snapshot("direct_revoked_inherited_remains", ["workflow:view"], {
    "workflow:view": ["organization"],
  });
  await admin.request(
    "iam.updateUserStatus",
    { userId: person.id, status: "disabled" },
    true
  );
  const disabled = await snapshot("disabled_user_zero_effective", []);
  assert(disabled.inheritedRoles.length > 0);
  assert.equal(await member.request("auth.me", null), null);
  await admin.request(
    "iam.updateUserStatus",
    { userId: person.id, status: "active" },
    true
  );
  await snapshot("reactivated_current_grants_only", ["workflow:view"], {
    "workflow:view": ["organization"],
  });
  await member.request("auth.login", person.login, true);
  const managerCode = `custom_source_manager_${tag}`;
  await admin.request(
    "iam.assignSystemRole",
    { userId: person.id, roleCode: managerCode },
    true
  );
  const managerAccount = await member.request("auth.me", null);
  assert.equal(managerAccount.role, "user");
  if (!legacy) {
    assertPublic(managerAccount);
    assert.equal(managerAccount.canManageIdentity, true);
  }
  await member.request("iam.userDirectory", {
    search: person.login.username,
    offset: 0,
    limit: 10,
  });
  await assert.rejects(
    () => member.request("config.settings", null),
    /管理员|权限|admin|permission/i
  );
  console.log(
    JSON.stringify({
      scenario: "delegated_identity_manager_without_general_settings",
      allowed: true,
    })
  );
  await revokeAll(managerCode);
  if (!legacy)
    assert.equal(
      (await member.request("auth.me", null)).canManageIdentity,
      false
    );
  await assert.rejects(
    () =>
      member.request("iam.userDirectory", {
        search: person.login.username,
        offset: 0,
        limit: 10,
      }),
    /权限/
  );
  console.log(
    JSON.stringify({
      scenario: "delegated_identity_revocation_denied",
      allowed: false,
    })
  );
} finally {
  const failures = [];
  for (const value of people) {
    try {
      for (const assignment of (await details(value.id)).directRoles.filter(r =>
        roles.includes(r.roleCode)
      ))
        await admin.request(
          "iam.revokeRoleAssignment",
          { assignmentId: assignment.assignmentId },
          true
        );
    } catch (error) {
      failures.push(error.message);
    }
  }
  for (const binding of bindings)
    await admin
      .request("config.unbindOrganizationRole", binding, true)
      .catch(e => failures.push(e.message));
  for (const membership of memberships)
    await admin
      .request("config.removeOrganizationMember", membership, true)
      .catch(e => failures.push(e.message));
  for (const code of roles)
    await admin
      .request("iam.deleteCustomRole", { code }, true)
      .catch(e => failures.push(e.message));
  for (const id of [...units].reverse())
    await admin
      .request(
        "config.updateOrganizationUnit",
        { id, status: "disabled" },
        true
      )
      .catch(e => failures.push(e.message));
  for (const value of people)
    await admin
      .request(
        "iam.updateUserStatus",
        { userId: value.id, status: "disabled" },
        true
      )
      .catch(e => failures.push(e.message));
  for (const id of workflows)
    await admin
      .request("workflow.delete", { id }, true)
      .catch(e => failures.push(e.message));
  assert.deepEqual(failures, [], "隔离权限来源验收清理失败");
  console.log(
    JSON.stringify({
      ownRolesRemoved: roles.length,
      ownDepartmentsDisabled: units.length,
      ownAccountsDisabled: people.length,
      ownWorkflowsArchived: workflows.length,
    })
  );
}
