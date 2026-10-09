import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import superjson from "superjson";
const base = "http://124.223.198.84:1180";
function client() {
  let cookie = "";
  return async (path, input, mutation = false) => {
    const payload = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(payload)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie },
        ...(mutation ? { body: payload } : {}),
      }
    );
    const next = response.headers.getSetCookie()[0];
    if (next) cookie = next.split(";", 1)[0];
    const body = await response.json();
    if (!response.ok || body.error) {
      const error = new Error(
        body.error?.json?.message ?? `HTTP ${response.status}`
      );
      error.code = body.error?.json?.data?.code;
      throw error;
    }
    return superjson.deserialize(body.result.data);
  };
}
const admin = client();
assert(
  process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
    process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
);
await admin(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
const stage = process.env.FLOW_ROLE_STAGE ?? "prepare";
assert(["prepare", "verify", "cleanup"].includes(stage));
const manifestPath = tag => `/tmp/flow-custom-role-ui-${tag}.json`;
const definition = {
  schemaVersion: 1,
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 120 },
      config: {},
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 280, y: 120 },
      config: { resultTemplate: "{{input}}" },
    },
  ],
  edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
};
if (stage === "prepare") {
  const tag = randomBytes(4).toString("hex");
  const password = `Test9_${randomBytes(24).toString("hex")}`;
  const username = `roleui_${tag}`;
  const user = await admin(
    "iam.createUser",
    { username, password, name: `角色闭环账号_${tag}`, role: "user" },
    true
  );
  const project = await admin(
    "project.create",
    { code: `ROLEUI_${tag}`.toUpperCase(), name: `角色闭环项目_${tag}` },
    true
  );
  const target = await admin(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `角色闭环目标_${tag}`,
      flowType: "control",
      definition,
    },
    true
  );
  const sibling = await admin(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `角色闭环隔离_${tag}`,
      flowType: "control",
      definition,
    },
    true
  );
  const meta = {
    tag,
    username,
    password,
    userId: user.userId,
    workflowId: target.id,
    siblingId: sibling.id,
    roleCode: `custom_ui_${tag}`,
    roleName: `角色闭环验证_${tag}`,
    description: `隔离角色闭环_${tag}`,
  };
  writeFileSync(manifestPath(tag), JSON.stringify(meta), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      stage,
      tag,
      username,
      userId: meta.userId,
      workflowId: meta.workflowId,
      siblingId: meta.siblingId,
      roleCode: meta.roleCode,
      roleName: meta.roleName,
      description: meta.description,
      editorUrl: `${base}/#/flows/workflow/${meta.workflowId}/editor`,
    })
  );
} else {
  const tag = process.env.FLOW_ROLE_TAG;
  assert(
    /^[a-f0-9]{8}$/.test(tag ?? ""),
    "Provide only the exact own fixture tag"
  );
  const meta = JSON.parse(readFileSync(manifestPath(tag), "utf8"));
  assert.equal(meta.tag, tag);
  assert.equal(meta.username, `roleui_${tag}`);
  assert.equal(meta.roleCode, `custom_ui_${tag}`);
  const account = await admin("iam.userAuthorizationDetails", { userId: meta.userId });
  assert.equal(account.user.username, meta.username);
  assert.equal(account.user.name, `角色闭环账号_${tag}`);
  const source = await admin("workflow.get", { id: meta.workflowId });
  assert.equal(source.name, `角色闭环目标_${tag}`);
  const sibling = await admin("workflow.get", { id: meta.siblingId });
  assert.equal(sibling.name, `角色闭环隔离_${tag}`);
  const ownRole = () =>
    admin("iam.roles", {}).then(roles =>
      roles.find(role => role.code === meta.roleCode)
    );
  const role = await ownRole();
  if (role) {
    assert.equal(role.description, meta.description);
    assert.equal(Number(role.isSystem), 0);
    assert.equal(role.scope, "workflow");
  }
  const bindings = () =>
    admin("workflow.customRoleAssignments", {
      workflowId: meta.workflowId,
      page: 0,
      query: meta.username,
    });
  const active = async () =>
    (await bindings()).items.filter(
      item =>
        Number(item.userId) === meta.userId &&
        item.roleCode === meta.roleCode &&
        item.authorizationStatus === "active"
    );
  if (stage === "cleanup") {
    if (role) {
      for (const item of (await bindings()).items.filter(
        item =>
          Number(item.userId) === meta.userId &&
          item.roleCode === meta.roleCode &&
          !item.revokedAt
      ))
        await admin(
          "workflow.revokeCustomRole",
          { workflowId: meta.workflowId, assignmentId: item.id },
          true
        );
      await admin("iam.deleteCustomRole", { code: meta.roleCode }, true);
    }
    await admin(
      "iam.updateUserStatus",
      { userId: meta.userId, status: "disabled" },
      true
    );
    unlinkSync(manifestPath(tag));
    console.log(
      JSON.stringify({
        stage,
        ownAccountDisabled: true,
        ownRoleRemoved: true,
        privateManifestRemoved: true,
      })
    );
  } else {
    assert(role, "Create the exact own role in the browser first");
    assert.equal(
      role.name,
      `${meta.roleName}_已调整`,
      "Edit the own role name in the browser before verification"
    );
    const perms =
      typeof role.permissions === "string"
        ? JSON.parse(role.permissions)
        : role.permissions;
    assert.deepEqual(perms, ["workflow:view"]);
    const [uiBinding] = await active();
    assert(
      uiBinding,
      "Bind the own user to the target workflow in the browser first"
    );
    assert.equal((await active()).length, 1);
    const user = client();
    await user(
      "auth.login",
      { username: meta.username, password: meta.password },
      true
    );
    const targetAccess = () => user("workflow.access", { id: meta.workflowId });
    assert((await targetAccess()).permissions.has("workflow:view"));
    assert(
      !(await user("workflow.access", { id: meta.siblingId })).permissions.has(
        "workflow:view"
      )
    );
    assert.equal(
      (await user("workflow.get", { id: meta.workflowId })).name,
      source.name
    );
    await assert.rejects(
      user("iam.permissionCatalog"),
      error => error.code === "FORBIDDEN"
    );
    await assert.rejects(
      user("workflow.customRoles", { workflowId: meta.workflowId }),
      error => error.code === "FORBIDDEN"
    );
    await assert.rejects(
      user(
        "workflow.assignCustomRole",
        {
          workflowId: meta.workflowId,
          userId: meta.userId,
          roleCode: meta.roleCode,
        },
        true
      ),
      error => error.code === "FORBIDDEN"
    );
    await assert.rejects(
      admin(
        "workflow.revokeCustomRole",
        { workflowId: meta.siblingId, assignmentId: uiBinding.id },
        true
      ),
      /不能撤销其他流程/
    );
    assert.equal((await active()).length, 1);
    await assert.rejects(
      admin("iam.deleteCustomRole", { code: meta.roleCode }, true),
      /仍有有效授权/
    );
    assert(await ownRole());
    await admin(
      "workflow.revokeCustomRole",
      { workflowId: meta.workflowId, assignmentId: uiBinding.id },
      true
    );
    assert(!(await targetAccess()).permissions.has("workflow:view"));
    const concurrent = await Promise.allSettled(
      [1, 2].map(() =>
        admin(
          "workflow.assignCustomRole",
          {
            workflowId: meta.workflowId,
            userId: meta.userId,
            roleCode: meta.roleCode,
          },
          true
        )
      )
    );
    assert.equal(
      concurrent.filter(item => item.status === "fulfilled").length,
      1
    );
    assert.equal(
      concurrent.filter(item => item.status === "rejected").length,
      1
    );
    const [single] = await active();
    assert(single);
    assert.equal((await active()).length, 1);
    await admin(
      "workflow.revokeCustomRole",
      { workflowId: meta.workflowId, assignmentId: single.id },
      true
    );
    await admin(
      "workflow.assignCustomRole",
      {
        workflowId: meta.workflowId,
        userId: meta.userId,
        roleCode: meta.roleCode,
        expiresAt: new Date(Date.now() + 8000),
      },
      true
    );
    assert((await targetAccess()).permissions.has("workflow:view"));
    await new Promise(resolve => setTimeout(resolve, 9500));
    assert(!(await targetAccess()).permissions.has("workflow:view"));
    await admin("iam.deleteCustomRole", { code: meta.roleCode }, true);
    assert.equal(await ownRole(), undefined);
    await admin(
      "iam.updateUserStatus",
      { userId: meta.userId, status: "disabled" },
      true
    );
    unlinkSync(manifestPath(tag));
    console.log(
      JSON.stringify({
        stage,
        userId: meta.userId,
        workflowId: meta.workflowId,
        browserCreateEditAndBindVerified: true,
        workflowScopeIsolated: true,
        unauthorizedManagerDenied: true,
        crossWorkflowRevokeDenied: true,
        activeRoleDeleteDenied: true,
        concurrentGrantSingle: true,
        revocationAndExpiryVerified: true,
        expiredRoleDeleteSucceeded: true,
        ownAccountDisabled: true,
        ownRoleRemoved: true,
        privateManifestRemoved: true,
      })
    );
  }
}
