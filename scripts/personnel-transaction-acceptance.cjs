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
  viewer = session();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const delegate = viewer;
const password = login.password;
const persist = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
function register(suffix, name, actorUserId = fixture.userId, source) {
  const person = {
    username: tag + suffix,
    name,
    role: "user",
    actorUserId,
    ...(source ? { source } : {}),
  };
  fixture.pendingPeople.push(person);
  persist();
  return { ...person, password };
}
const publicInput = item => ({
  username: item.username,
  name: item.name,
  role: item.role,
  password,
});
async function poll(label, read, accept) {
  const deadline = Date.now() + 20000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + label);
}
function assertAllSucceeded(results, label) {
  const failures = results
    .filter(item => item.status === "rejected")
    .map(item => item.reason.message);
  assert.deepEqual(failures, [], label);
}
(async () => {
  let browser,
    page,
    failed = false,
    releaseRequest;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
      accountOnly: true,
    });
    assert(
      fixture.userId &&
        fixture.disabledUserId &&
        fixture.pendingPeople.length === 2
    );
    report({ stage: "personnel-fixture", tag });
    await owner("auth.login", login, true);
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await delegate("auth.login", memberLogin, true);
    const denied = tag + "_denied";
    fixture.rejectedUsernames = [denied];
    persist();
    await assert.rejects(
      delegate(
        "iam.createUser",
        { username: denied, name: "无权创建_" + tag, password, role: "user" },
        true
      ),
      error => error.status === 403
    );

    const apiUsers = Array.from({ length: 12 }, (_, index) =>
      register("_api_" + index, "并发人员_" + tag + "_" + index)
    );
    const statuses = (async () => {
      for (let index = 0; index < 12; index++)
        await owner(
          "iam.updateUserStatus",
          {
            userId: fixture.disabledUserId,
            status: index % 2 ? "active" : "disabled",
          },
          true
        );
    })();
    const concurrent = await Promise.allSettled([
      ...apiUsers.map(user => owner("iam.createUser", publicInput(user), true)),
      statuses,
    ]);
    assertAllSucceeded(concurrent, "并发创建与账号状态变更必须均成功");
    report({
      stage: "personnel-concurrent-creation",
      created: apiUsers.length,
      statusChanges: 12,
      errors: 0,
    });

    const shared = register("_same", "同名人员_" + tag);
    const duplicate = await Promise.allSettled([
      owner("iam.createUser", publicInput(shared), true),
      owner("iam.createUser", publicInput(shared), true),
    ]);
    assert.equal(
      duplicate.filter(item => item.status === "fulfilled").length,
      1
    );
    const conflict = duplicate.find(item => item.status === "rejected");
    assert.equal(conflict.reason.status, 409);
    assert.match(conflict.reason.message, /用户名已存在/);

    const firstBatch = register(
      "_batch_a",
      "批量人员_" + tag + "_a",
      fixture.userId,
      "ai_batch_preview"
    );
    const secondBatch = register(
      "_batch_b",
      "批量人员_" + tag + "_b",
      fixture.userId,
      "ai_batch_preview"
    );
    const batch = await owner(
      "iam.createUsersBatch",
      {
        users: [
          publicInput(firstBatch),
          publicInput(shared),
          publicInput(secondBatch),
        ],
      },
      true
    );
    assert.equal(batch.created, 2);
    assert.equal(batch.failed, 1);
    assert.deepEqual(
      batch.results.map(item => item.success),
      [true, false, true]
    );
    report({
      stage: "personnel-duplicate-and-batch",
      duplicateConflict409: true,
      batchCreated: 2,
      batchFailed: 1,
    });

    await remote({ action: "grant_identity", fixture });
    await delegate("auth.login", memberLogin, true);
    const delegatedUsers = Array.from({ length: 24 }, (_, index) =>
      register(
        "_delegated_" + index,
        "委派并发人员_" + tag + "_" + index,
        fixture.disabledUserId
      )
    );
    const delegatedStatus = (async () => {
      const directory = await owner("iam.userDirectory", {
        search: firstBatch.username,
        offset: 0,
        limit: 20,
      });
      const target = directory.items.find(
        item => item.username === firstBatch.username
      );
      assert(target);
      for (let index = 0; index < 6; index++)
        await owner(
          "iam.updateUserStatus",
          { userId: target.id, status: index % 2 ? "active" : "disabled" },
          true
        );
    })();
    const delegatedResults = await Promise.allSettled([
      ...delegatedUsers.map(user =>
        delegate("iam.createUser", publicInput(user), true)
      ),
      delegatedStatus,
    ]);
    assertAllSucceeded(
      delegatedResults,
      "超过连接池容量的委派创建请求不能相互等待或缺失审计"
    );
    report({
      stage: "personnel-delegated-concurrency",
      created: delegatedUsers.length,
      statusChanges: 6,
      errors: 0,
    });

    const casDirectory = await owner("iam.userDirectory", {
      search: apiUsers[0].username,
      offset: 0,
      limit: 20,
    });
    const casTarget = casDirectory.items.find(
      item => item.username === apiUsers[0].username
    );
    assert.equal(casTarget.status, "active");
    const casInput = {
      userId: casTarget.id,
      status: "disabled",
      expectedStatus: "active",
      expectedVersion: casTarget.statusVersion,
    };
    const cas = await Promise.allSettled([
      owner("iam.updateUserStatus", casInput, true),
      delegate("iam.updateUserStatus", casInput, true),
    ]);
    assert.equal(cas.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(
      cas.find(item => item.status === "rejected").reason.status,
      409
    );
    report({
      stage: "personnel-status-cas",
      oneChanged: true,
      staleConflict409: true,
    });

    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
      serviceWorkers: "block",
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const loginPage = async credentials => {
      await page
        .getByLabel("用户名", { exact: true })
        .fill(credentials.username);
      await page.getByLabel("密码", { exact: true }).fill(credentials.password);
      await page
        .getByRole("button", { name: "登录流程引擎", exact: true })
        .click();
      await page.locator('input[type="password"]').waitFor({ state: "hidden" });
      await page.goto(base + "#/system/identity");
      await page.getByPlaceholder("搜索名称、账号或邮箱").fill(tag);
    };
    const openCreation = async () => {
      await page.locator("[data-iam-account-create-menu]").click();
      await page.getByRole("menuitem", { name: "新增单个账号" }).click();
      const dialog = page.getByRole("dialog", {
        name: "新增内部账号",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const fill = async (dialog, username, name) => {
      await dialog.getByLabel(/用户名/).fill(username);
      await dialog.getByLabel("显示名称", { exact: true }).fill(name);
      await dialog.getByLabel(/初始密码/).fill(password);
    };
    await page.goto(base);
    await loginPage(login);
    let dialog = await openCreation();
    const uiName = "表单人员_" + tag;
    await fill(dialog, tag + "_disabled", uiName);
    let held = true;
    const gate = new Promise(resolve => {
      releaseRequest = resolve;
    });
    await context.route("**/api/trpc/iam.createUser**", async route => {
      if (held) await gate;
      await route.continue();
    });
    const requestStarted = page.waitForRequest(
      request =>
        request.url().includes("/api/trpc/iam.createUser") &&
        request.method() === "POST"
    );
    await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
    await requestStarted;
    await expect(dialog.getByLabel(/用户名/)).toBeDisabled();
    await expect(dialog.getByLabel("显示名称", { exact: true })).toBeDisabled();
    await expect(dialog.getByLabel(/初始密码/)).toBeDisabled();
    await expect(dialog.locator("select")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true })
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    held = false;
    releaseRequest();
    await expect(dialog.getByRole("alert")).toContainText("用户名已存在");
    await expect(dialog.getByLabel(/用户名/)).toHaveValue(tag + "_disabled");
    await expect(dialog.getByLabel("显示名称", { exact: true })).toHaveValue(
      uiName
    );
    await expect(dialog.getByLabel(/初始密码/)).toHaveValue(password);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    dialog = await openCreation();
    await expect(dialog.getByLabel("显示名称", { exact: true })).toHaveValue(
      uiName
    );
    const uiUser = register("_ui", uiName);
    await dialog.getByLabel(/用户名/).fill(uiUser.username);
    await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(dialog).toBeHidden();
    report({
      stage: "personnel-form",
      busyInputsLocked: true,
      busyCloseLocked: true,
      duplicateDraftPreserved: true,
      reopenedDraftPreserved: true,
      correctedUsernameCreated: true,
    });

    await page.locator("[data-aiflow-logout]").click();
    await page.getByLabel("密码", { exact: true }).waitFor();
    await loginPage(memberLogin);
    dialog = await openCreation();
    const recovery = register(
      "_recovery",
      "权限恢复人员_" + tag,
      fixture.disabledUserId
    );
    await fill(dialog, recovery.username, recovery.name);
    await remote({ action: "revoke_identity", fixture });
    await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/权限|无权/);
    await expect(dialog.getByLabel(/用户名/)).toHaveValue(recovery.username);
    await expect(dialog.getByLabel(/初始密码/)).toHaveValue(password);
    const missing = await owner("iam.userDirectory", {
      search: recovery.username,
      offset: 0,
      limit: 20,
    });
    assert.equal(
      missing.items.filter(item => item.username === recovery.username).length,
      0
    );
    await owner(
      "iam.assignSystemRole",
      { userId: fixture.disabledUserId, roleCode: fixture.identityRoleCode },
      true
    );
    await dialog.getByRole("button", { name: "创建账号", exact: true }).click();
    await expect(dialog).toBeHidden();
    report({
      stage: "personnel-permission-recovery",
      revokedSubmitRejected: true,
      noPartialAccount: true,
      restoredDraftCreated: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await openCreation();
    const mobileName = tag + "_mobile_draft";
    fixture.rejectedUsernames.push(mobileName);
    persist();
    await fill(dialog, mobileName, "手机草稿_" + tag);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    await page.keyboard.press("Escape");
    dialog = await openCreation();
    await expect(dialog.getByLabel(/用户名/)).toHaveValue(mobileName);
    await expect(dialog.getByLabel(/初始密码/)).toHaveValue(password);
    await page.screenshot({
      path: path.join(directory, "personnel-mobile-form.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    report({
      output: (await remote({ action: "verify_personnel", fixture })).trim(),
    });
    assert.deepEqual(errors, []);
    report({
      stage: "personnel-transaction",
      passed: true,
      browserErrors: 0,
      createdAccounts: fixture.pendingPeople.length,
    });
  } catch (error) {
    failed = true;
    console.error(
      [login.password, memberLogin.password].reduce(
        (text, secret) => text.replaceAll(secret, "[credential]"),
        error.stack ?? error.message
      )
    );
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
  } finally {
    releaseRequest?.();
    if (browser) await browser.close();
    if (fixture?.tag) {
      try {
        report({
          output: (await remote({ action: "cleanup", fixture, login })).trim(),
        });
      } catch (error) {
        failed = true;
        console.error("Fixture cleanup failed: " + error.message);
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
})();
