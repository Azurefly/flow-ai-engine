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
const managerLogin = credentials("_manager");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const sqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-authorization-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const workflowAuthorizationIntent=" +
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
    release: async () => {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      return done;
    },
  };
}
function rootFixtureStatement(statement) {
  assert(/^(CREATE|DROP) TRIGGER workflow_auth_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("workflow_auth_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes(fixture.workflows[0].id) &&
        statement.includes("isolated_workflow_audit_rejected")
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

async function poll(description, read, accept, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (accept(result)) return result;
    await sleep(300);
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + description);
}
const has = (access, permission) =>
  Array.isArray(access.permissions)
    ? access.permissions.includes(permission)
    : Boolean(access.permissions?.has?.(permission));
const wid = () => fixture.workflows[0].id;
async function member(role = "viewer") {
  return owner(
    "workflow.grantMember",
    { workflowId: wid(), userId: fixture.disabledUserId, role },
    true
  );
}
async function customAssignment() {
  return (
    await owner("workflow.customRoleAssignments", {
      workflowId: wid(),
      page: 0,
      query: fixture.workflowRoleCode,
    })
  ).items.find(
    row => !row.revokedAt && row.roleCode === fixture.workflowRoleCode
  );
}
async function makeCustom() {
  return owner(
    "workflow.assignCustomRole",
    {
      workflowId: wid(),
      userId: fixture.disabledUserId,
      roleCode: fixture.workflowRoleCode,
    },
    true
  );
}
async function operations() {
  await member();
  await makeCustom();
  for (const operation of [
    "grantMember",
    "revokeMember",
    "assignCustomRole",
    "revokeCustomRole",
  ]) {
    const current = await customAssignment();
    const input = {
      workflowId: wid(),
      userId: fixture.disabledUserId,
      ...(operation.includes("Custom")
        ? operation === "assignCustomRole"
          ? { roleCode: fixture.workflowRoleCode }
          : { assignmentId: current.id }
        : { role: operation === "grantMember" ? "operator" : "viewer" }),
    };
    if (operation === "assignCustomRole" && current)
      await owner(
        "workflow.revokeCustomRole",
        { workflowId: wid(), assignmentId: current.id },
        true
      );
    const before = await sqlProcess("snapshot").done;
    try {
      await sql("fail_audit");
      await assert.rejects(owner("workflow." + operation, input, true));
    } finally {
      await sql("restore_audit");
    }
    const after = await sqlProcess("snapshot").done;
    assert.equal(after.audits, before.audits);
    if (process.env.FLOW_UI_AUTH_BASELINE === "1") {
      assert.notDeepEqual(after, before);
      report({ auditBaseline: operation, writeSurvivedAuditFailure: true });
    } else {
      assert.deepEqual(after, before);
      report({ auditRollback: operation, unchanged: true });
    }
    // Restore only the isolated target's known grants for the next case.
    if (operation === "revokeMember") await member();
    if (
      operation === "assignCustomRole" &&
      process.env.FLOW_UI_AUTH_BASELINE !== "1"
    )
      await makeCustom();
  }
}
async function races() {
  for (const operation of [
    "grantMember",
    "revokeMember",
    "assignCustomRole",
    "revokeCustomRole",
  ]) {
    await owner(
      "workflow.grantMember",
      { workflowId: wid(), userId: fixture.managerUserId, role: "owner" },
      true
    );
    await member();
    let current = await customAssignment();
    if (operation === "assignCustomRole" && current) {
      await owner(
        "workflow.revokeCustomRole",
        { workflowId: wid(), assignmentId: current.id },
        true
      );
      current = null;
    }
    if (operation === "revokeCustomRole" && !current) {
      await makeCustom();
      current = await customAssignment();
    }
    const before = await sqlProcess("snapshot").done;
    const input = {
      workflowId: wid(),
      userId: fixture.disabledUserId,
      ...(operation.includes("Custom")
        ? operation === "assignCustomRole"
          ? { roleCode: fixture.workflowRoleCode }
          : { assignmentId: current.id }
        : { role: operation === "grantMember" ? "editor" : "viewer" }),
    };
    let lock, pending;
    try {
      lock = sqlProcess("hold_authorization");
      await lock.ready;
      pending = manager("workflow." + operation, input, true).then(
        value => ({ value }),
        error => ({ error })
      );
      await poll(
        "request waits on fixture actor",
        () => sqlProcess("waiter").done,
        value => value.waiting
      );
      await sqlProcess("remove_manager_source").done;
      await poll(
        "live API sees manager source removed",
        () => manager("workflow.access", { id: wid() }),
        value => !has(value, "workflow:members:manage")
      );
      await lock.release();
      lock = null;
      const result = await pending;
      assert(result.error);
      assert.equal(result.error.status, 403);
      const after = await sqlProcess("snapshot").done;
      assert.deepEqual(
        after.members.filter(row => row.userId === fixture.disabledUserId),
        before.members.filter(row => row.userId === fixture.disabledUserId)
      );
      assert.deepEqual(after.assignments, before.assignments);
      assert.equal(after.audits, before.audits);
      report({ permissionRace: operation, status: 403, unchanged: true });
    } finally {
      if (lock) await lock.release().catch(() => {});
      if (pending) await pending;
    }
  }
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
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await owner("auth.login", login, true);
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    fixture.pendingPeople.push({
      username: managerLogin.username,
      name: "流程成员管理_" + tag,
      role: "user",
    });
    remember();
    const created = await owner(
      "iam.createUser",
      { ...managerLogin, name: "流程成员管理_" + tag, role: "user" },
      true
    );
    fixture.managerUserId = created.userId;
    fixture.people.push({
      id: created.userId,
      username: managerLogin.username,
    });
    fixture.workflowRoleCode = "custom_" + tag;
    remember();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.workflowRoleCode,
        name: "流程权限验收_" + tag,
        scope: "workflow",
        permissions: ["workflow:view", "workflow:run"],
      },
      true
    );
    await manager("auth.login", managerLogin, true);
    await viewer("auth.login", memberLogin, true);
    if (process.env.FLOW_UI_AUTH_UI_ONLY !== "1") await operations();
    if (process.env.FLOW_UI_AUTH_BASELINE !== "1") {
      if (process.env.FLOW_UI_AUTH_UI_ONLY !== "1") await races();
      await ui();
    }
    assert.equal(
      (await remote({ action: "settings_fingerprint" })).trim(),
      fingerprint
    );
    report({
      acceptance: "workflow-authorization",
      baseline: process.env.FLOW_UI_AUTH_BASELINE === "1",
      uiOnly: process.env.FLOW_UI_AUTH_UI_ONLY === "1",
      layoutProbe: process.env.FLOW_UI_AUTH_LAYOUT_PROBE === "1",
      passed: true,
      tag,
    });
  } catch (error) {
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: path.join(directory, "workflow-authorization-failure.png"),
        })
        .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (fixture?.workflowRoleCode && fixture?.managerUserId)
      await sql("restore_audit");
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
  const existing = await customAssignment();
  if (existing)
    await owner(
      "workflow.revokeCustomRole",
      { workflowId: wid(), assignmentId: existing.id },
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
  page.on("pageerror", error => errors.push(error.message));
  const dialog = () => page.locator("[data-workflow-authorization]");
  async function signIn(credentials) {
    await page.evaluate(() => {
      location.hash = "#/flows";
    });
    await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
    await page.getByLabel("密码", { exact: true }).fill(credentials.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(page.locator("[data-aiflow-business-center]")).toBeVisible({
      timeout: 20000,
    });
  }
  async function open(id = wid()) {
    await page.evaluate(
      hash => (location.hash = hash),
      "#/flows/workflow/" + id + "/editor"
    );
    await expect(page.locator("[data-workflow-editor]")).toBeVisible();
    await page.getByTitle("更多操作", { exact: true }).click();
    await page
      .getByRole("menuitem", { name: "成员与权限", exact: true })
      .click();
    await expect(dialog()).toBeVisible();
    await expect(
      dialog().getByRole("heading", { name: "授权记录", exact: false })
    ).toContainText("（");
  }
  async function pick() {
    await dialog()
      .getByRole("combobox", { name: "待授权内部账号", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "待授权内部账号搜索", exact: true })
      .fill(memberLogin.username);
    await page
      .getByRole("option")
      .filter({ hasText: memberLogin.username })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      dialog().getByRole("combobox", { name: "待授权内部账号", exact: true })
    ).toContainText(memberLogin.username);
  }
  const hours = () => dialog().getByLabel("有效期（小时）", { exact: true });
  const role = () => dialog().locator("#workflow-role");
  const refresh = () =>
    dialog().getByRole("button", { name: "重新读取权限与列表", exact: true });
  const submit = () => dialog().locator('button[type="submit"]');
  const row = roleName =>
    dialog()
      .locator("[data-workflow-grant]")
      .filter({ hasText: memberLogin.username })
      .filter({ hasText: roleName });
  await page.goto(base);
  await signIn(login);
  await open();
  await expect(
    dialog().getByText("创建者，不可撤销", { exact: false })
  ).toBeVisible();
  await pick();
  await role().selectOption("editor");
  await hours().fill("3");
  await dialog()
    .getByRole("tab", { name: "自定义流程角色", exact: true })
    .click();
  await pick();
  await role().selectOption(fixture.workflowRoleCode);
  await hours().fill("7");
  await dialog()
    .getByRole("tab", { name: "内置协作角色", exact: true })
    .click();
  await expect(hours()).toHaveValue("3");
  await expect(role()).toHaveValue("editor");
  for (const width of [320, 390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: path.join(directory, "workflow-members-before-" + width + ".png"),
    });
    report({
      overflowProbe: width,
      items: await dialog().evaluate(root =>
        [root, ...root.querySelectorAll("*")]
          .filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1)
          .slice(0, 12)
          .map(el => ({
            tag: el.tagName,
            classes: el.className,
            client: el.clientWidth,
            scroll: el.scrollWidth,
            text: el.textContent.slice(0, 100),
          }))
      ),
    });
    if (process.env.FLOW_UI_AUTH_LAYOUT_PROBE === "1") return;
    await expect
      .poll(() => dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1))
      .toBe(true);
    await expect(
      dialog().locator('[aria-label^="移除"]').first()
    ).toBeInViewport();
    const measured = await dialog().evaluate(el => ({
      width: el.getBoundingClientRect().width,
      title: parseFloat(
        getComputedStyle(el.querySelector('[data-slot="dialog-title"]'))
          .fontSize
      ),
      input: parseFloat(getComputedStyle(el.querySelector("input")).fontSize),
    }));
    assert.equal(measured.title, 18);
    assert.equal(measured.input, 14);
    report({ layout: width, ...measured });
    await page.screenshot({
      path: path.join(directory, "workflow-members-" + width + ".png"),
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await hours().fill("0");
  await expect(submit()).toBeDisabled();
  await expect(dialog().getByRole("alert")).toContainText("整数小时");
  await hours().fill("3");
  await page.keyboard.press("Escape");
  const leaving = page.getByRole("alertdialog", {
    name: "关闭前保留授权填写",
    exact: true,
  });
  await expect(leaving).toBeVisible();
  await expect(
    leaving.getByRole("button", { name: "继续编辑", exact: true })
  ).toBeFocused();
  await leaving.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(hours()).toHaveValue("3");
  const download = page.waitForEvent("download");
  await dialog().getByRole("button", { name: "导出填写", exact: true }).click();
  const file = await download;
  const exported = JSON.parse(fs.readFileSync(await file.path(), "utf8"));
  assert.equal(exported.workflowId, wid());
  assert.equal(exported.drafts.builtin.hours, "3");
  assert.equal(exported.drafts.custom.hours, "7");
  // A real audit failure must keep the form and every grant unchanged.
  const before = await sqlProcess("snapshot").done;
  try {
    await sql("fail_audit");
    await expect(submit()).toBeEnabled();
    await submit().click();
    await expect(dialog().getByRole("alert")).toContainText("填写已保留");
  } finally {
    await sql("restore_audit");
  }
  assert.deepEqual(await sqlProcess("snapshot").done, before);
  await expect(hours()).toHaveValue("3");
  await expect(role()).toHaveValue("editor");
  let releaseWrite,
    releaseRead,
    writeCount = 0,
    readHeld = false;
  const writeGate = new Promise(resolve => (releaseWrite = resolve)),
    readGate = new Promise(resolve => (releaseRead = resolve));
  const slow = async route => {
    const request = route.request(),
      url = request.url();
    if (request.method() === "POST" && url.includes("workflow.grantMember")) {
      writeCount++;
      await writeGate;
      return route.continue();
    }
    if (request.method() === "GET" && url.includes("workflow.members")) {
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
    await expect(dialog().getByRole("tab").first()).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeVisible();
    await expect(
      dialog().getByRole("button", { name: "关闭", exact: true })
    ).toBeDisabled();
    await expect.poll(() => writeCount).toBe(1);
    releaseWrite();
    await expect(hours()).toBeEnabled();
    await expect(hours()).toHaveValue("");
    await expect.poll(() => readHeld).toBe(true);
    await hours().fill("11");
    await expect(hours()).toHaveValue("11");
    releaseRead();
    await expect(row("编辑者")).toBeVisible();
    await expect(hours()).toHaveValue("11");
  } finally {
    releaseWrite();
    releaseRead();
    await page.unroute("**/api/trpc/**", slow);
  }
  await dialog()
    .getByRole("tab", { name: "自定义流程角色", exact: true })
    .click();
  await expect(hours()).toHaveValue("7");
  await expect(role()).toHaveValue(fixture.workflowRoleCode);
  await expect(submit()).toBeEnabled();
  await submit().click();
  await expect(submit()).toHaveText("绑定到当前流程");
  await expect(
    row("流程权限验收_").filter({
      has: page.getByRole("button", { name: "撤销", exact: true }),
    })
  ).toBeVisible();
  await poll(
    "custom role grants run permission",
    () => viewer("workflow.access", { id: wid() }),
    value => has(value, "workflow:run")
  );
  const activeCustomRow = row("流程权限验收_").filter({
    has: page.getByRole("button", { name: "撤销", exact: true }),
  });
  const revokedId = await activeCustomRow.getAttribute("data-workflow-grant");
  const revokeButton = activeCustomRow.getByRole("button", {
    name: "撤销",
    exact: true,
  });
  await revokeButton.click();
  let confirm = page.getByRole("alertdialog", {
    name: "撤销这项流程授权",
    exact: true,
  });
  await expect(confirm).toContainText(memberLogin.username);
  await expect(
    confirm.getByRole("button", { name: "保留授权", exact: true })
  ).toBeFocused();
  await expect(confirm).toContainText(fixture.workflows[0].name);
  await confirm.getByRole("button", { name: "保留授权", exact: true }).click();
  await expect(revokeButton).toBeFocused();
  await revokeButton.click();
  try {
    await sql("fail_audit");
    await confirm
      .getByRole("button", { name: "确认撤销", exact: true })
      .click();
    await expect(confirm.getByRole("alert")).toContainText("填写已保留");
    await expect(confirm).toBeVisible();
  } finally {
    await sql("restore_audit");
  }
  await confirm.getByRole("button", { name: "确认撤销", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  await expect(
    dialog().locator(`[data-workflow-grant="${revokedId}"]`)
  ).toContainText("已撤销");
  await poll(
    "other editor permission survives custom revoke",
    () => viewer("workflow.access", { id: wid() }),
    value => has(value, "workflow:edit") && !has(value, "workflow:run")
  );
  // A read error must hide previously cached member rows, while both draft forms survive.
  await dialog()
    .getByRole("tab", { name: "内置协作角色", exact: true })
    .click();
  await expect(hours()).toHaveValue("11");
  const failRead = async route => {
    const request = route.request(),
      url = new URL(request.url()),
      names = decodeURIComponent(
        url.pathname.split("/api/trpc/")[1] || ""
      ).split(",");
    if (request.method() !== "GET" || !names.includes("workflow.members"))
      return route.fallback();
    const response = await route.fetch(),
      body = await response.json(),
      error = {
        error: {
          json: {
            message: "隔离成员读取中断",
            code: -32603,
            data: {
              code: "INTERNAL_SERVER_ERROR",
              httpStatus: 503,
              path: "workflow.members",
            },
          },
        },
      };
    if (Array.isArray(body)) body[names.indexOf("workflow.members")] = error;
    await route.fulfill({
      response,
      status: Array.isArray(body) ? 207 : 503,
      json: Array.isArray(body) ? body : error,
    });
  };
  await page.route("**/api/trpc/**", failRead);
  try {
    await refresh().click();
    await expect(dialog().locator("[data-workflow-grant]")).toHaveCount(0);
    await expect(dialog()).toContainText("已隐藏旧列表");
    await expect(hours()).toHaveValue("11");
  } finally {
    await page.unroute("**/api/trpc/**", failRead);
  }
  await refresh().click();
  await expect(row("编辑者")).toBeVisible();
  await expect(hours()).toHaveValue("11");
  await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  await leaving
    .getByRole("button", { name: "放弃填写并关闭", exact: true })
    .click();
  await expect(dialog()).not.toBeVisible();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  await open();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: path.join(directory, "workflow-members-dark.png"),
  });
  await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "切换主题", exact: true }).click();
  // The same on-demand entry works in each of the three editors.
  for (const flow of fixture.workflows.slice(1)) {
    await open(flow.id);
    await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  }
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  await owner(
    "workflow.grantMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "viewer" },
    true
  );
  await owner(
    "workflow.grantMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "owner" },
    true
  );
  await signIn(managerLogin);
  await open();
  await hours().fill("9");
  await owner(
    "workflow.revokeMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "owner" },
    true
  );
  await refresh().click();
  await expect(hours()).toBeDisabled();
  await expect(hours()).toHaveValue("9");
  await expect(dialog()).toContainText("当前没有流程成员管理权限");
  await owner(
    "workflow.grantMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "owner" },
    true
  );
  await refresh().click();
  await expect(hours()).toBeEnabled();
  await expect(hours()).toHaveValue("9");
  await owner(
    "workflow.revokeMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "owner" },
    true
  );
  await owner(
    "workflow.revokeMember",
    { workflowId: wid(), userId: fixture.managerUserId, role: "viewer" },
    true
  );
  await refresh().click();
  await expect(page.locator("[data-resource-draft-recovery]")).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  const globalLeave = page.getByRole("alertdialog", {
    name: "离开前保留授权填写",
    exact: true,
  });
  await expect(globalLeave).toBeVisible();
  await globalLeave
    .getByRole("button", { name: "继续编辑", exact: true })
    .click();
  await expect(page.locator("[data-resource-draft-recovery]")).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await globalLeave
    .getByRole("button", { name: "放弃填写并离开", exact: true })
    .click();
  await signIn(login);
  await open();
  await expect(hours()).toHaveValue("");
  await dialog().getByRole("button", { name: "关闭", exact: true }).click();
  assert.deepEqual(errors, []);
  report({
    browser: "workflow-authorization",
    flowTypes: ["state", "control", "data"],
    draftTabs: true,
    closeExport: true,
    rollback: true,
    busyLock: true,
    slowReadDoesNotBlockOrOverwrite: true,
    revokeConfirm: true,
    readFailureHidesCache: true,
    permissionLossRecovery: true,
    accountIsolation: true,
    browserErrors: errors.length,
  });
}
