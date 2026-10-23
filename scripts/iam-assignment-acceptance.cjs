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
  path.join(__dirname, "iam-assignment-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const iamAssignmentIntent=" +
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
  assert(/^(CREATE|DROP) TRIGGER iam_assign_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("iam_assign_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes(fixture.assignmentRoleCode) &&
        statement.includes("isolated_iam_audit_rejected")
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
async function binding() {
  return (await sqlProcess("bindings").done).assignments.find(
    row => !row.revokedAt
  );
}
async function grant(api = owner, extra = {}) {
  return api(
    "iam.assignSystemRole",
    {
      userId: fixture.recipientUserId,
      roleCode: fixture.assignmentRoleCode,
      ...extra,
    },
    true
  );
}
async function revoke(api = owner) {
  const current = await binding();
  return api("iam.revokeRoleAssignment", { assignmentId: current.id }, true);
}
async function audits() {
  for (const operation of ["assign", "revoke"]) {
    if (operation === "revoke" && !(await binding())) await grant();
    const before = await sqlProcess("snapshot").done;
    try {
      await sql("fail_audit");
      await assert.rejects(operation === "assign" ? grant() : revoke());
    } finally {
      await sql("restore_audit");
    }
    const after = await sqlProcess("snapshot").done;
    assert.equal(after.audits, before.audits);
    if (process.env.FLOW_UI_IAM_BASELINE === "1")
      assert.notDeepEqual(after, before);
    else assert.deepEqual(after, before);
    report({
      audit: operation,
      rollback: process.env.FLOW_UI_IAM_BASELINE !== "1",
      oldWriteSurvived: process.env.FLOW_UI_IAM_BASELINE === "1",
    });
  }
}
async function races() {
  for (const mode of ["permission", "invalidate", "disable"]) {
    for (const operation of ["assign", "revoke"]) {
      await owner(
        "iam.updateUserStatus",
        { userId: fixture.disabledUserId, status: "active" },
        true
      );
      const details = await owner("iam.userAuthorizationDetails", {
        userId: fixture.disabledUserId,
      });
      if (
        !details.directRoles.some(
          row => row.roleCode === fixture.identityRoleCode
        )
      )
        await owner(
          "iam.assignSystemRole",
          {
            userId: fixture.disabledUserId,
            roleCode: fixture.identityRoleCode,
          },
          true
        );
      await manager("auth.login", memberLogin, true);
      const current = await binding();
      if (operation === "assign" && current) await revoke();
      if (operation === "revoke" && !current) await grant();
      const before = await sqlProcess("snapshot").done;
      let lock, pending;
      try {
        lock = sqlProcess("hold_authorization");
        await lock.ready;
        pending = (
          operation === "assign" ? grant(manager) : revoke(manager)
        ).then(
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
        report({ race: operation, mode, denied: 403, unchanged: true });
      } finally {
        if (lock) await lock.release().catch(() => {});
        if (pending) await pending;
      }
    }
  }
  await owner(
    "iam.updateUserStatus",
    { userId: fixture.disabledUserId, status: "active" },
    true
  );
}
let browser, page, fingerprint;
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
    fixture.pendingPeople.push({
      username: recipientLogin.username,
      name: "系统授权接收人_" + tag,
      role: "user",
    });
    remember();
    const person = await owner(
      "iam.createUser",
      { ...recipientLogin, name: "系统授权接收人_" + tag, role: "user" },
      true
    );
    fixture.recipientUserId = person.userId;
    fixture.people.push({
      id: person.userId,
      username: recipientLogin.username,
    });
    fixture.assignmentRoleCode = "custom_system_" + tag.slice(9);
    remember();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.assignmentRoleCode,
        name: "系统绑定验收_" + tag,
        scope: "system",
        permissions: ["workflow:create"],
      },
      true
    );
    await manager("auth.login", memberLogin, true);
    await viewer("auth.login", recipientLogin, true);
    if (process.env.FLOW_UI_IAM_UI_ONLY !== "1") await audits();
    if (process.env.FLOW_UI_IAM_BASELINE !== "1") {
      if (process.env.FLOW_UI_IAM_UI_ONLY !== "1") await races();
      await owner(
        "iam.assignSystemRole",
        { userId: fixture.recipientUserId, roleCode: "system_admin" },
        true
      );
      try {
        assert.equal((await viewer("auth.me", null)).canManageIdentity, true);
      } finally {
        const own = await owner("iam.userAuthorizationDetails", {
          userId: fixture.recipientUserId,
        });
        for (const row of own.directRoles.filter(
          item =>
            item.roleCode === "system_admin" && item.scopeType === "system"
        ))
          await owner(
            "iam.revokeRoleAssignment",
            { assignmentId: row.assignmentId },
            true
          );
      }
      assert.equal((await viewer("auth.me", null)).canManageIdentity, false);
      report({
        ownSystemAdminGrantRevoked: true,
        existingAdminAccountsPreserved: true,
      });
      await ui();
    }
    report({
      iamAssignment: true,
      baseline: process.env.FLOW_UI_IAM_BASELINE === "1",
      uiOnly: process.env.FLOW_UI_IAM_UI_ONLY === "1",
      passed: true,
      tag,
    });
  } catch (error) {
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(directory, "iam-failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (fixture?.permissionFlow) {
      const flow = await owner("workflow.get", {
        id: fixture.permissionFlow.id,
      });
      assert.equal(flow.ownerUserId, fixture.recipientUserId);
      assert.equal(flow.name, "系统授权实际使用_" + fixture.tag);
      if (!flow.archivedAt)
        await owner("workflow.delete", { id: flow.id }, true);
    }
    if (fixture?.recipientUserId) {
      const own = await owner("iam.userAuthorizationDetails", {
        userId: fixture.recipientUserId,
      });
      assert.equal(own.user.username, recipientLogin.username);
      for (const row of own.directRoles.filter(
        item => item.roleCode === "system_admin" && item.scopeType === "system"
      ))
        await owner(
          "iam.revokeRoleAssignment",
          { assignmentId: row.assignmentId },
          true
        );
    }
    if (fixture?.assignmentRoleCode && fixture?.recipientUserId) {
      await sql("restore_audit");
      for (const item of (await sqlProcess("bindings").done).assignments.filter(
        row => !row.revokedAt
      ))
        await owner(
          "iam.revokeRoleAssignment",
          { assignmentId: item.id },
          true
        );
      const config = await owner("iam.customRoleConfiguration", {
        code: fixture.assignmentRoleCode,
      });
      await owner(
        "iam.deleteCustomRole",
        {
          code: fixture.assignmentRoleCode,
          expectedConfigToken: config.configToken,
        },
        true
      );
    }
    if (fingerprint)
      assert.equal(
        (await remote({ action: "settings_fingerprint" })).trim(),
        fingerprint
      );
    if (fixture) await remote({ action: "cleanup", fixture, login });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
async function ui() {
  if (await binding()) await revoke();
  const config = await owner("iam.customRoleConfiguration", {
    code: fixture.assignmentRoleCode,
  });
  await owner(
    "iam.updateCustomRole",
    {
      code: fixture.assignmentRoleCode,
      expectedConfigToken: config.configToken,
      name: config.name,
      scope: "system",
      permissions: ["workflow:create", "workflow:view"],
    },
    true
  );
  const before = await sqlProcess("snapshot").done;
  await assert.rejects(
    grant(owner, { expectedConfigToken: config.configToken }),
    error => error.status === 409
  );
  assert.deepEqual(await sqlProcess("snapshot").done, before);
  let latest = await owner("iam.customRoleConfiguration", {
    code: fixture.assignmentRoleCode,
  });
  await owner(
    "iam.updateCustomRole",
    {
      code: fixture.assignmentRoleCode,
      expectedConfigToken: latest.configToken,
      name: latest.name,
      scope: "system",
      permissions: ["workflow:create"],
    },
    true
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: executable(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  await context.route("**/*", route =>
    route.request().url().startsWith(base) ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", error => {
    errors.push(error.message);
    report({ browserError: error.message });
  });
  async function signIn(credentials) {
    await page.evaluate(() => (location.hash = "#/flows"));
    await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(page.locator("[data-aiflow-business-center]")).toBeVisible({
      timeout: 20000,
    });
  }
  async function identity() {
    await page.evaluate(() => (location.hash = "#/system/identity"));
    await expect(page.locator("[data-aiflow-identity-page]")).toBeVisible();
  }
  async function selectUser() {
    await page
      .getByRole("textbox", { name: "搜索用户", exact: true })
      .fill(recipientLogin.username);
    const row = page
      .locator("[data-iam-user-row]")
      .filter({ hasText: recipientLogin.username });
    await expect(row).toHaveCount(1);
    await row.locator("button").first().click();
    await expect(
      page
        .getByRole("button", { name: "绑定角色", exact: true })
        .filter({ visible: true })
    ).toBeEnabled();
  }
  async function openUser() {
    await selectUser();
    await page
      .getByRole("button", { name: "绑定角色", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "为用户绑定角色", exact: true })
    ).toBeVisible();
  }
  const dialog = () =>
    page.getByRole("dialog", { name: /为用户绑定角色|为角色绑定用户/ });
  const hours = () =>
    dialog().getByRole("spinbutton", {
      name: "有效期小时（可选）",
      exact: true,
    });
  const note = () => dialog().getByLabel("授权备注（可选）", { exact: true });
  const submit = () =>
    dialog().getByRole("button", { name: "确认绑定", exact: true });
  const refresh = () =>
    dialog().getByRole("button", { name: "重新读取角色与账号", exact: true });
  await page.goto(base);
  await signIn(login);
  await identity();
  await openUser();
  await dialog()
    .getByRole("combobox", { name: "系统角色", exact: true })
    .selectOption(fixture.assignmentRoleCode);
  await hours().fill("6");
  await note().fill("保留角色授权填写_" + tag);
  for (const [width,height] of [[320,640],[390,844],[1024,1000],[1920,1080]]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1))
      .toBe(true);
    await expect(submit()).toBeInViewport();
    const typography = await dialog().evaluate(el => ({
      title: parseFloat(
        getComputedStyle(el.querySelector('[data-slot="dialog-title"]'))
          .fontSize
      ),
      input: parseFloat(
        getComputedStyle(el.querySelector('input[type="number"]')).fontSize
      ),
    }));
    assert.equal(typography.title, 18);
    assert.equal(typography.input, 14);
    await page.screenshot({
      path: path.join(directory, "system-role-" + width + ".png"),
    });
    report({ layout: width, ...typography });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await hours().fill("0");
  await expect(submit()).toBeDisabled();
  await hours().fill("6");
  await page.keyboard.press("Escape");
  let close = page.getByRole("alertdialog", {
    name: "关闭前保留角色授权填写",
    exact: true,
  });
  await expect(
    close.getByRole("button", { name: "继续编辑", exact: true })
  ).toBeFocused();
  await close.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(hours()).toHaveValue("6");
  const downloading = page.waitForEvent("download");
  await dialog().getByRole("button", { name: "导出填写", exact: true }).click();
  const file = await downloading;
  const exported = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  assert.equal(exported.draft.hours, "6");
  assert.equal(exported.draft.userId, String(fixture.recipientUserId));
  latest = await owner("iam.customRoleConfiguration", {
    code: fixture.assignmentRoleCode,
  });
  await owner(
    "iam.updateCustomRole",
    {
      code: fixture.assignmentRoleCode,
      expectedConfigToken: latest.configToken,
      name: latest.name,
      description: "配置快照已调整_" + tag,
      scope: "system",
      permissions: ["workflow:create"],
    },
    true
  );
  await refresh().click();
  await expect(dialog()).toContainText("角色配置已变化");
  await expect(submit()).toBeDisabled();
  await expect(hours()).toHaveValue("6");
  await dialog()
    .getByRole("button", { name: "确认使用当前权限", exact: true })
    .click();
  await expect(submit()).toBeEnabled();
  try {
    await sql("fail_audit");
    await submit().click();
    await expect(dialog().getByRole("alert")).toContainText("填写已保留");
  } finally {
    await sql("restore_audit");
  }
  await expect(hours()).toHaveValue("6");
  let releaseWrite,
    releaseRead,
    postCount = 0,
    readHeld = false;
  const writeGate = new Promise(resolve => (releaseWrite = resolve)),
    readGate = new Promise(resolve => (releaseRead = resolve));
  const slow = async route => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.url().includes("iam.assignSystemRole")
    ) {
      postCount++;
      await writeGate;
      return route.continue();
    }
    if (
      request.method() === "GET" &&
      request.url().includes("iam.userAuthorizationDetails")
    ) {
      readHeld = true;
      await readGate;
      return route.continue();
    }
    return route.fallback();
  };
  await page.route("**/api/trpc/**", slow);
  try {
    await submit().click();
    await expect(hours()).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeVisible();
    await expect.poll(() => postCount).toBe(1);
    releaseWrite();
    await expect(dialog()).not.toBeVisible();
    await expect.poll(() => readHeld).toBe(true);
    await openUser();
    await hours().fill("9");
    releaseRead();
    await expect(hours()).toHaveValue("9");
  } finally {
    releaseWrite();
    releaseRead();
    await page.unroute("**/api/trpc/**", slow);
  }
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await close
    .getByRole("button", { name: "放弃填写并关闭", exact: true })
    .click();
  await expect(dialog()).not.toBeVisible();
  let account = await owner("iam.userAuthorizationDetails", {
    userId: fixture.recipientUserId,
  });
  assert(
    account.effectivePermissions.some(item => item.code === "workflow:create")
  );
  const created = await viewer(
    "workflow.create",
    { name: "系统授权实际使用_" + tag },
    true
  );
  fixture.permissionFlow = { id: created.id, name: created.name };
  remember();
  const roleCard = page
    .getByText(fixture.assignmentRoleCode, { exact: true })
    .filter({ visible: true })
    .first()
    .locator("..");
  await roleCard.getByRole("button", { name: "撤销", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "撤销直接角色授权",
    exact: true,
  });
  await expect(confirmation).toContainText("系统授权接收人_" + tag);
  await expect(confirmation).toContainText("系统范围");
  try {
    await sql("fail_audit");
    await confirmation
      .getByRole("button", { name: "确认撤销", exact: true })
      .click();
    await expect(confirmation.getByRole("alert")).toContainText("核对结果");
  } finally {
    await sql("restore_audit");
  }
  await confirmation
    .getByRole("button", { name: "确认撤销", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await poll(
    () =>
      owner("iam.userAuthorizationDetails", {
        userId: fixture.recipientUserId,
      }),
    value =>
      !value.effectivePermissions.some(item => item.code === "workflow:create")
  );
  await assert.rejects(
    viewer("workflow.create", { name: "不应创建_" + tag }, true),
    error => error.message.includes("没有创建流程的权限")
  );
  await page.getByRole("tab", { name: "角色与权限", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索角色", exact: true })
    .fill(fixture.assignmentRoleCode);
  const roleRow = page
    .locator("[data-iam-role-row]")
    .filter({ hasText: fixture.assignmentRoleCode });
  await roleRow.locator("button").first().click();
  await page
    .getByRole("button", { name: "绑定用户", exact: true })
    .filter({ visible: true })
    .click();
  await dialog()
    .getByLabel("搜索内部用户", { exact: true })
    .fill(recipientLogin.username);
  await dialog()
    .getByRole("combobox", { name: "选择内部用户", exact: true })
    .selectOption(String(fixture.recipientUserId));
  await hours().fill("2");
  await expect(submit()).toBeEnabled();
  await submit().click();
  await expect(dialog()).not.toBeVisible();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.screenshot({ path: path.join(directory, "system-role-dark.png") });
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await signIn(memberLogin);
  await identity();
  await openUser();
  await hours().fill("7");
  await note().fill("失权保留_" + tag);
  await remote({ action: "revoke_identity", fixture });
  await refresh().click();
  await expect(page.locator("[data-resource-draft-recovery]")).toBeVisible();
  // Re-grant the existing fixture role without replacing its definition.
  let own = await owner("iam.userAuthorizationDetails", {
    userId: fixture.disabledUserId,
  });
  if (!own.directRoles.some(item => item.roleCode === fixture.identityRoleCode))
    await owner(
      "iam.assignSystemRole",
      { userId: fixture.disabledUserId, roleCode: fixture.identityRoleCode },
      true
    );
  await page
    .getByRole("button", { name: /^重新读取(当前权限|权限与目录)$/ })
    .click();
  await expect(dialog()).toBeVisible();
  await expect(hours()).toHaveValue("7");
  await expect(note()).toHaveValue("失权保留_" + tag);
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await close
    .getByRole("button", { name: "放弃填写并关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await signIn(login);
  await identity();
  await openUser();
  await expect(hours()).toHaveValue("");
  await expect(note()).toHaveValue("");
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  assert.deepEqual(errors, []);
  report({
    browser: "system-role-assignment",
    twoEntries: true,
    configConflict: true,
    rollback: true,
    draftAndClose: true,
    busyAndSlowRefresh: true,
    effectivePermission: true,
    permissionLossRecovery: true,
    accountIsolation: true,
    browserErrors: 0,
  });
}
