const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  chromium,
  expect,
} = require("../01-test/014-自动化脚本/e2e/node_modules/@playwright/test");

// All real HTTP and browser traffic is restricted to the designated remote app.
const base = "http://124.223.198.84:1180/";
const tag = "uiconfig_" + randomBytes(6).toString("hex");
const credentials = suffix => ({
  username: tag + suffix,
  password: "Test9_" + randomBytes(24).toString("base64url"),
});
const login = credentials("_admin"),
  memberLogin = credentials("_disabled");
const directory = path.join(__dirname, "..", ".cache", tag);
fs.mkdirSync(directory, { recursive: true });
const helper = fs.readFileSync(
  path.join(__dirname, "browser-config-fixtures.mjs"),
  "utf8"
);
let fixture;
const report = value => console.log(JSON.stringify(value));

function remote(intent) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-i",
        "C:\\Users\\pan\\.ssh\\215.pem",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "ubuntu@124.223.198.84",
        "sudo -n docker exec -i flow-ai-engine-app-1 node --input-type=module -",
      ],
      { windowsHide: true }
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        try {
          const result = JSON.parse(line);
          if (result.fixture) {
            fixture = result.fixture;
            fs.writeFileSync(
              path.join(directory, "fixture.json"),
              JSON.stringify(fixture),
              "utf8"
            );
          }
        } catch {
          /* A progress line may be incomplete. */
        }
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", code =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`Fixture operation failed (${code}): ${stderr}`))
    );
    child.stdin.end(
      "const browserFixtureIntent = " + JSON.stringify(intent) + ";\n" + helper
    );
  });
}

function executable() {
  if (process.env.FLOW_UI_BROWSER_EXECUTABLE)
    return process.env.FLOW_UI_BROWSER_EXECUTABLE;
  const root = path.join(process.env.LOCALAPPDATA, "ms-playwright");
  const candidate = fs
    .readdirSync(root)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map(name => path.join(root, name, "chrome-win64", "chrome.exe"))
    .find(file => fs.existsSync(file));
  assert(candidate, "Set FLOW_UI_BROWSER_EXECUTABLE to installed Chromium");
  return candidate;
}

function session() {
  let cookie = "";
  return async (name, input, mutation = false) => {
    const body = JSON.stringify({ json: input ?? null });
    const response = await fetch(
      `${base}api/trpc/${name}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
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
    if (!response.ok || payload.error)
      throw Object.assign(
        new Error(payload.error?.json?.message ?? `HTTP ${response.status}`),
        { status: response.status }
      );
    return payload.result.data.json;
  };
}

const owner = session(),
  manager = session(),
  viewer = session();
const recipientLogin = credentials("_recipient");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const sqlHelper = fs.readFileSync(
  path.join(__dirname, "organization-write-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const organizationWriteIntent=" +
    JSON.stringify({ action, fixture, ...extra }) +
    ";\n" +
    sqlHelper;
  const encoded = Buffer.from(code).toString("base64");
  const command =
    "sudo -n docker exec -i flow-ai-engine-app-1 node --input-type=module -e \"await import('data:text/javascript;base64," +
    encoded +
    "').catch(error=>{console.error(error.code+': '+error.message);process.exitCode=1})\"";
  const child = spawn(
    "ssh",
    [
      "-i",
      "C:\\Users\\pan\\.ssh\\215.pem",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "ubuntu@124.223.198.84",
      command,
    ],
    { windowsHide: true }
  );
  let stdout = "",
    stderr = "",
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        try {
          const value = JSON.parse(line);
          if (value.barrierReady) readyResolve(value);
        } catch {}
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", error => {
      readyReject(error);
      reject(error);
    });
    child.on("close", status => {
      if (status !== 0) {
        const error = new Error(
          "Fixture SQL " + action + " failed: " + stderr.slice(-1500)
        );
        readyReject(error);
        reject(error);
      } else {
        const result = JSON.parse(stdout.trim().split("\n").at(-1));
        readyResolve(result);
        resolve(result);
      }
    });
  });
  done.catch(() => {});
  if (action !== "hold_authorization") child.stdin.end();
  return {
    ready,
    done,
    release: async (signal = "release") => {
      if (!child.stdin.destroyed) child.stdin.end(signal + "\n");
      return done;
    },
  };
}
function rootFixtureStatement(statement) {
  assert(/^(CREATE|DROP) TRIGGER org_write_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("org_write_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes(String(fixture.userId)) &&
        statement.includes(String(fixture.disabledUserId)) &&
        statement.includes("isolated_organization_audit_rejected")
    );
  return new Promise((resolve, reject) => {
    // The existing container supplies its own admin credential; never read or print it.
    const command = `sudo -n docker exec -i flow-ai-engine-mysql-1 sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --skip-column-names "$MYSQL_DATABASE"'`;
    const child = spawn(
      "ssh",
      [
        "-i",
        "C:\\Users\\pan\\.ssh\\215.pem",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "ubuntu@124.223.198.84",
        command,
      ],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", code =>
      code === 0
        ? resolve()
        : reject(new Error("Scoped fixture trigger failed: " + stderr))
    );
    child.stdin.end("DELIMITER $$\n" + statement + "$$\nDELIMITER ;\n");
  });
}
const sql = async (action, extra) => {
  const result = await sqlProcess(action, extra).done;
  if (!result.statement) return result;
  await rootFixtureStatement(result.statement);
  const state = await sqlProcess("audit_state").done;
  assert.equal(state.present, action === "fail_audit");
  return action === "fail_audit"
    ? { fixtureAuditFailureEnabled: true }
    : { fixtureAuditFailureRemoved: true };
};

async function poll(read, accept, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (accept(value)) return value;
    await sleep(300);
  } while (Date.now() < end);
  throw new Error("Fixture wait timed out");
}
const prefix = "ORG_" + tag.slice(9).toUpperCase() + "_";
const baseline = process.env.FLOW_UI_ORGANIZATION_BASELINE === "1";
let a,
  b,
  serial = 0,
  browser,
  page,
  fingerprint;
const api = (name, input, client = owner) =>
  client("config." + name, input, true);
async function create(suffix) {
  const value = await api("createOrganizationUnit", {
    code: prefix + suffix,
    name: "组织事务_" + tag + "_" + suffix,
  });
  return value.id;
}
async function read() {
  return owner("config.organizationDirectory", {});
}
async function existsMember(id) {
  const data = await owner("config.organizationMembersPage", {
    unitId: id,
    includeDescendants: false,
    search: login.username,
    page: 1,
    pageSize: 10,
  });
  return data.items.some(row => Number(row.userId) === fixture.userId);
}
async function member(id, primary = false) {
  return api("assignOrganizationMember", {
    unitId: id,
    userId: fixture.userId,
    isPrimary: primary,
    title: "岗位_" + tag,
  });
}
async function remove(id) {
  if (await existsMember(id))
    await api("removeOrganizationMember", {
      unitId: id,
      userId: fixture.userId,
    });
}
async function bound(id) {
  return (await read()).roleBindings.some(
    row =>
      row.unitId === id && Number(row.roleId) === fixture.organizationRoleId
  );
}
async function unbind(id) {
  if (await bound(id))
    await api("unbindOrganizationRole", {
      unitId: id,
      roleId: fixture.organizationRoleId,
    });
}
async function bind(id) {
  return api("bindOrganizationRole", {
    unitId: id,
    roleId: fixture.organizationRoleId,
  });
}
const names = [
  "create",
  "update",
  "assign",
  "remove",
  "primary",
  "move",
  "delete",
  "bind",
  "unbind",
];
async function prepare(name) {
  if (name === "create")
    return [
      "createOrganizationUnit",
      {
        code: prefix + "CREATE_" + ++serial,
        name: "组织事务_" + tag + "_CREATE_" + serial,
      },
    ];
  if (name === "update")
    return [
      "updateOrganizationUnit",
      { id: a, description: "配置_" + ++serial },
    ];
  if (name === "assign") {
    await remove(a);
    return [
      "assignOrganizationMember",
      {
        unitId: a,
        userId: fixture.userId,
        title: "新岗位_" + ++serial,
        isPrimary: true,
      },
    ];
  }
  if (name === "remove") {
    await member(a);
    return ["removeOrganizationMember", { unitId: a, userId: fixture.userId }];
  }
  if (name === "primary") {
    await member(a, true);
    await member(b, false);
    return [
      "setPrimaryOrganizationMembership",
      { unitId: b, userId: fixture.userId },
    ];
  }
  if (name === "move") {
    await member(a, true);
    await remove(b);
    return [
      "moveOrganizationMember",
      {
        fromUnitId: a,
        toUnitId: b,
        userId: fixture.userId,
        title: "迁移_" + ++serial,
      },
    ];
  }
  if (name === "delete")
    return [
      "deleteOrganizationUnit",
      { id: await create("DELETE_" + ++serial) },
    ];
  if (name === "bind") {
    await unbind(a);
    return [
      "bindOrganizationRole",
      { unitId: a, roleId: fixture.organizationRoleId },
    ];
  }
  await bind(a);
  return [
    "unbindOrganizationRole",
    { unitId: a, roleId: fixture.organizationRoleId },
  ];
}
async function audits() {
  for (const name of names) {
    const [method, input] = await prepare(name);
    const before = await sqlProcess("snapshot").done;
    try {
      await sql("fail_audit");
      await assert.rejects(api(method, input));
    } finally {
      await sql("restore_audit");
    }
    const after = await sqlProcess("snapshot").done;
    assert.equal(after.audits, before.audits);
    if (baseline) assert.notDeepEqual(after, before);
    else assert.deepEqual(after, before);
    report({ audit: name, rollback: !baseline, oldWriteSurvived: baseline });
  }
}
async function restoreManager() {
  await owner(
    "iam.updateUserStatus",
    { userId: fixture.disabledUserId, status: "active" },
    true
  );
  const details = await owner("iam.userAuthorizationDetails", {
    userId: fixture.disabledUserId,
  });
  if (
    !details.directRoles.some(row => row.roleCode === fixture.identityRoleCode)
  )
    await owner(
      "iam.assignSystemRole",
      { userId: fixture.disabledUserId, roleCode: fixture.identityRoleCode },
      true
    );
  await manager("auth.login", memberLogin, true);
}
async function races() {
  for (const mode of ["permission", "invalidate", "disable"])
    for (const name of names) {
      await restoreManager();
      const [method, input] = await prepare(name);
      const before = await sqlProcess("snapshot").done;
      let lock, pending;
      try {
        lock = sqlProcess("hold_authorization");
        await lock.ready;
        pending = api(method, input, manager).then(
          value => ({ value }),
          error => ({ error })
        );
        await poll(
          () => sqlProcess("waiter").done,
          value => value.waiting
        );
        if (mode === "permission") {
          await sqlProcess("remove_manager_source").done;
          await poll(
            () => manager("auth.me", null),
            value => !value.canManageIdentity
          );
        }
        await lock.release(mode === "permission" ? "release" : mode);
        lock = null;
        const result = await pending;
        assert.equal(result.error?.status, 403);
        assert.deepEqual(await sqlProcess("snapshot").done, before);
        report({ race: name, mode, denied: 403, unchanged: true });
      } finally {
        if (lock) await lock.release().catch(() => {});
        if (pending) await pending;
      }
    }
  await restoreManager();
}
async function positive() {
  assert.equal(
    (
      await owner("iam.userAuthorizationDetails", {
        userId: fixture.disabledUserId,
      })
    ).effectivePermissions.some(row => row.code === "workflow:create"),
    false
  );
  await api("assignOrganizationMember", {
    unitId: b,
    userId: fixture.disabledUserId,
    isPrimary: true,
  });
  await bind(b);
  assert.equal(
    (
      await owner("iam.userAuthorizationDetails", {
        userId: fixture.disabledUserId,
      })
    ).effectivePermissions.some(row => row.code === "workflow:create"),
    true
  );
  const flow = await manager(
    "workflow.create",
    { name: "组织权限实际使用_" + tag, type: "state" },
    true
  );
  fixture.organizationFlowId = flow.id;
  remember();
  await unbind(b);
  assert.equal(
    (
      await owner("iam.userAuthorizationDetails", {
        userId: fixture.disabledUserId,
      })
    ).effectivePermissions.some(row => row.code === "workflow:create"),
    false
  );
  await assert.rejects(
    manager(
      "workflow.create",
      { name: "组织失权拒绝_" + tag, type: "state" },
      true
    ),
    error => error.status === 403
  );
  await api("removeOrganizationMember", {
    unitId: b,
    userId: fixture.disabledUserId,
  });
  const parent = await create("PARENT"),
    child = await create("CHILD");
  const pairs = await Promise.allSettled([
    api("updateOrganizationUnit", { id: parent, parentUnitId: child }),
    api("updateOrganizationUnit", { id: child, parentUnitId: parent }),
  ]);
  assert.equal(pairs.filter(row => row.status === "fulfilled").length, 1);
  const directory = await read();
  assert(
    !(
      directory.units.find(row => row.id === parent).parentUnitId === child &&
      directory.units.find(row => row.id === child).parentUnitId === parent
    )
  );
  await api("updateOrganizationUnit", { id: parent, parentUnitId: null });
  await api("updateOrganizationUnit", { id: child, parentUnitId: null });
  await Promise.all([member(a, true), member(b, true)]);
  const units = await owner("config.organization", {});
  assert.equal(
    units.members.filter(
      row => Number(row.userId) === fixture.userId && row.isPrimary
    ).length,
    1
  );
  report({
    organizationPositive: true,
    inheritedPermissionEffective: true,
    revokeEffective: true,
    cyclePrevented: true,
    singlePrimary: true,
  });
}
async function ui() {
  browser = await chromium.launch({
    headless: true,
    executablePath: executable(),
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("**/*", route =>
    route.request().url().startsWith(base) ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "#/system/organization", {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("用户名").fill(login.username);
  await page.getByLabel("密码", { exact: true }).fill(login.password);
  await page.getByRole("button", { name: "登录流程引擎", exact: true }).click();
  await page
    .locator('input[type="password"]')
    .waitFor({ state: "hidden", timeout: 20000 });
  await page.goto(base + "#/system/organization", {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator("[data-aiflow-organization-page]")
    .waitFor({ timeout: 20000 });
  const search = page.getByRole("textbox", { name: "搜索组织机构" });
  await search.fill(prefix + "A");
  await page
    .getByRole("button")
    .filter({ hasText: "组织事务_" + tag + "_A" })
    .first()
    .click();
  await page.getByRole("button", { name: "编辑部门", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑部门", exact: true });
  await expect(dialog).toBeVisible();
  const description = "界面审计失败保留_" + tag;
  await dialog.getByLabel("部门说明").fill(description);
  const before = await sqlProcess("snapshot").done;
  try {
    await sql("fail_audit");
    await dialog.getByRole("button", { name: "保存部门", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "暂时无法确认组织保存结果"
    );
    await expect(dialog.getByLabel("部门说明")).toHaveValue(description);
    assert.deepEqual(await sqlProcess("snapshot").done, before);
  } finally {
    await sql("restore_audit");
  }
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(directory, "organization-" + width + ".png"),
    });
  }
  await dialog.getByRole("button", { name: "保存部门", exact: true }).click();
  await expect(dialog).toBeHidden();
  assert.equal(
    (await read()).units.find(row => row.id === a).description,
    description
  );
  assert.deepEqual(errors, []);
  report({
    organizationBrowser: true,
    auditFailurePreservedInput: true,
    retrySavedOnce: true,
    viewports: [320, 1440],
    browserErrors: 0,
  });
}
(async () => {
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await remote({ action: "grant_identity", fixture });
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await owner("auth.login", login, true);
    await manager("auth.login", memberLogin, true);
    fixture.organizationRoleCode = "custom_org_" + tag.slice(9);
    remember();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.organizationRoleCode,
        name: "组织事务权限_" + tag,
        scope: "system",
        permissions: ["workflow:create"],
      },
      true
    );
    const roles = await owner("iam.roles", { scope: "system" });
    fixture.organizationRoleId = Number(
      roles.find(row => row.code === fixture.organizationRoleCode).id
    );
    remember();
    a = await create("A");
    b = await create("B");
    await audits();
    if (!baseline) {
      await races();
      await positive();
      await ui();
    }
    report({ organizationWrite: true, baseline, passed: true, tag });
  } catch (error) {
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(directory, "organization-failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (fixture) {
      await sql("restore_audit");
      if (fixture.organizationFlowId) {
        const flow = await owner("workflow.get", {
          id: fixture.organizationFlowId,
        });
        assert.equal(flow.ownerUserId, fixture.disabledUserId);
        assert.equal(flow.name, "组织权限实际使用_" + tag);
        if (!flow.archivedAt)
          await owner("workflow.delete", { id: flow.id }, true);
      }
      const all = await owner("config.organization", {});
      const own = all.units.filter(row => row.code.startsWith(prefix));
      assert(own.every(row => row.name.includes(tag)));
      const ids = new Set(own.map(row => row.id));
      for (const row of all.members.filter(row => ids.has(row.unitId))) {
        assert(
          [fixture.userId, fixture.disabledUserId].includes(Number(row.userId))
        );
        await api("removeOrganizationMember", {
          unitId: row.unitId,
          userId: Number(row.userId),
        });
      }
      for (const row of all.roleBindings.filter(row => ids.has(row.unitId))) {
        assert.equal(Number(row.roleId), fixture.organizationRoleId);
        await api("unbindOrganizationRole", {
          unitId: row.unitId,
          roleId: Number(row.roleId),
        });
      }
      for (const row of own)
        if (row.parentUnitId)
          await api("updateOrganizationUnit", {
            id: row.id,
            parentUnitId: null,
          });
      for (const row of own)
        await api("deleteOrganizationUnit", { id: row.id });
      if (fixture.organizationRoleCode) {
        const role = await owner("iam.customRoleConfiguration", {
          code: fixture.organizationRoleCode,
        });
        await owner(
          "iam.deleteCustomRole",
          {
            code: fixture.organizationRoleCode,
            expectedConfigToken: role.configToken,
          },
          true
        );
      }
      if (fingerprint)
        assert.equal(
          (await remote({ action: "settings_fingerprint" })).trim(),
          fingerprint
        );
      report({
        ownUnitsRemoved: own.length,
        output: (await remote({ action: "cleanup", fixture, login })).trim(),
      });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
