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

async function poll(description, read, accept) {
  const deadline = Date.now() + 30000;
  do {
    const value = await read();
    if (accept(value)) return value;
    await sleep(500);
  } while (Date.now() < deadline);
  throw new Error("Timed out: " + description);
}

const sqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-role-config-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const workflowRoleConfigIntent=" +
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
  if (!action.startsWith("hold_")) child.stdin.end();
  return {
    ready,
    done,
    release: async () => {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      return done;
    },
  };
}
(async () => {
  let browser,
    page,
    fingerprint,
    failed = false;
  const owner = session(),
    member = session();
  const roleName = "流程权限验收_" + tag;
  const remember = () =>
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture),
      "utf8"
    );
  const currentRole = () =>
    owner("iam.customRoleConfiguration", { code: fixture.workflowRoleCode });
  const updateRole = async values =>
    owner(
      "iam.updateCustomRole",
      {
        code: fixture.workflowRoleCode,
        expectedConfigToken: (await currentRole()).configToken,
        ...values,
      },
      true
    );
  const flowId = () => fixture.workflows[0].id;
  const grantInput = token => ({
    workflowId: flowId(),
    userId: fixture.disabledUserId,
    roleCode: fixture.workflowRoleCode,
    ...(token === undefined ? {} : { expectedConfigToken: token }),
  });
  const has = (access, code) =>
    Array.isArray(access.permissions)
      ? access.permissions.includes(code)
      : access.permissions?.has?.(code);
  const snapshot = () => sqlProcess("snapshot").done;
  const revokeCustom = async () => {
    const list = await owner("workflow.customRoleAssignments", {
      workflowId: flowId(),
      page: 0,
      query: fixture.workflowRoleCode,
    });
    for (const row of list.items.filter(
      row => row.roleCode === fixture.workflowRoleCode && !row.revokedAt
    )) {
      assert.equal(Number(row.userId), fixture.disabledUserId);
      await owner(
        "workflow.revokeCustomRole",
        { workflowId: flowId(), assignmentId: row.id },
        true
      );
    }
  };
  const rejected = async (method, input, status = 409) => {
    const before = await snapshot();
    await assert.rejects(
      owner(method, input, true),
      error => error.status === status
    );
    const after = await snapshot();
    for (const key of ["active", "bindings", "audits"])
      assert.equal(after[key], before[key], key);
  };
  try {
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    fixture.workflowRoleCode = "custom_" + tag;
    fixture.identityRoleCode = "custom_ui_iam_" + tag.slice(9);
    remember();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.workflowRoleCode,
        name: roleName,
        scope: "workflow",
        permissions: ["workflow:view"],
      },
      true
    );
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.identityRoleCode,
        name: "临时身份管理员_" + tag,
        scope: "system",
        permissions: ["workflow:create"],
      },
      true
    );
    await member("auth.login", memberLogin, true);
    let selected = (
      await owner("workflow.customRoles", { workflowId: flowId() })
    ).find(role => role.code === fixture.workflowRoleCode);
    assert.match(selected.configToken, /^[a-f0-9]{64}$/);
    assert.equal(selected.configToken, (await currentRole()).configToken);
    await rejected("workflow.assignCustomRole", grantInput());
    await rejected("project.assignCustomRole", grantInput());
    for (const values of [
      { name: "流程权限验收_已更名_" + tag },
      { permissions: ["workflow:view", "workflow:run"] },
      { description: "配置确认验收_" + tag },
    ]) {
      const old = (await currentRole()).configToken;
      await updateRole(values);
      await rejected("workflow.assignCustomRole", grantInput(old));
    }
    // Even deleting and recreating an identical role code cannot reuse an old confirmation.
    const beforeRecreate = await currentRole();
    await owner(
      "iam.deleteCustomRole",
      {
        code: fixture.workflowRoleCode,
        expectedConfigToken: beforeRecreate.configToken,
      },
      true
    );
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.workflowRoleCode,
        name: roleName,
        scope: "workflow",
        permissions: ["workflow:view"],
      },
      true
    );
    assert.notEqual((await currentRole()).id, beforeRecreate.id);
    await rejected(
      "workflow.assignCustomRole",
      grantInput(beforeRecreate.configToken)
    );
    // Observe the actual grant SQL waiting on an exclusive role lock, then commit a change.
    for (const kind of ["name", "permissions"]) {
      const token = (await currentRole()).configToken,
        before = await snapshot();
      let barrier, pending;
      try {
        barrier = sqlProcess(
          "hold_" + kind,
          kind === "name"
            ? { name: "流程权限验收_等待更名_" + tag }
            : { permissions: ["workflow:view", "workflow:run"] }
        );
        await barrier.ready;
        pending = owner(
          "workflow.assignCustomRole",
          grantInput(token),
          true
        ).then(
          value => ({ value }),
          error => ({ error })
        );
        await poll(
          "grant SQL waiting on scoped role",
          () => sqlProcess("waiter").done,
          value => value.waiting
        );
        await barrier.release();
        barrier = null;
        const result = await pending;
        assert.equal(result.error?.status, 409);
      } finally {
        if (barrier) await barrier.release().catch(() => {});
        if (pending) await pending;
      }
      const after = await snapshot();
      for (const key of ["active", "bindings", "audits"])
        assert.equal(after[key], before[key], key);
    }
    report({
      stage: "workflow-role-config-api",
      tag,
      missingSnapshotRejected: true,
      namePermissionDescriptionAndRecreatedIdRejected: true,
      roleAndPermissionLockWaitsObserved: true,
      noRejectedWriteOrAudit: true,
    });
    await updateRole({
      name: roleName,
      description: null,
      permissions: ["workflow:view"],
    });
    let token = (await currentRole()).configToken;
    await owner("project.assignCustomRole", grantInput(token), true);
    let access = await member("workflow.access", { id: flowId() });
    assert(has(access, "workflow:view"));
    assert(!has(access, "workflow:run"));
    assert(
      !has(
        await member("workflow.access", { id: fixture.workflows[1].id }),
        "workflow:view"
      )
    );
    let state = await snapshot();
    assert(
      state.grants.some(
        item =>
          item.roleConfigToken === token &&
          item.targetUserId === fixture.disabledUserId &&
          JSON.stringify(item.permissionCodes) === '["workflow:view"]'
      )
    );
    await updateRole({ permissions: ["workflow:view", "workflow:run"] });
    assert(
      has(await member("workflow.access", { id: flowId() }), "workflow:run")
    );
    await revokeCustom();
    token = (await currentRole()).configToken;
    const race = await Promise.allSettled(
      [1, 2].map(() =>
        owner("workflow.assignCustomRole", grantInput(token), true)
      )
    );
    assert.equal(race.filter(item => item.status === "fulfilled").length, 1);
    assert.equal((await snapshot()).active, 1);
    await revokeCustom();
    await assert.rejects(
      member("workflow.assignCustomRole", grantInput(token), true),
      error => error.status === 403
    );
    await updateRole({ name: roleName, permissions: ["workflow:view"] });
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(base + "#/system/identity");
    await page.getByRole("tab", { name: "角色与权限", exact: true }).click();
    for (const [code, scope, origin] of [
      [fixture.workflowRoleCode, "workflow", "custom"],
      [fixture.identityRoleCode, "system", "custom"],
      ["system_admin", "system", "builtin"],
    ]) {
      await page
        .getByRole("textbox", { name: "搜索角色", exact: true })
        .fill(code);
      const row = page.locator("[data-iam-role-row]").filter({ hasText: code });
      await expect(row.locator("[data-role-scope]")).toHaveAttribute(
        "data-role-scope",
        scope
      );
      await expect(row.locator("[data-role-origin]")).toHaveAttribute(
        "data-role-origin",
        origin
      );
      await expect(row.locator("[data-role-origin]")).toHaveText(
        origin === "builtin" ? "内置" : "自定义"
      );
    }
    await page.goto(base + "#/flows/workflow/" + flowId() + "/editor");
    await page.locator("[data-workflow-editor]").waitFor();
    await page.getByTitle("更多操作", { exact: true }).click();
    await page
      .getByRole("menuitem", { name: "成员与权限", exact: true })
      .click();
    const dialog = page.locator("[data-workflow-authorization]");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("tab", { name: "自定义流程角色", exact: true })
      .click();
    await dialog
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
    await dialog
      .getByLabel("自定义流程角色", { exact: true })
      .selectOption(fixture.workflowRoleCode);
    const hours = dialog.getByLabel("有效期（小时）", { exact: true });
    await hours.fill("7");
    const submit = dialog.getByRole("button", {
      name: "绑定到当前流程",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    const changedName = "流程权限验收_另一管理员_" + tag;
    await updateRole({
      name: changedName,
      permissions: ["workflow:view", "workflow:run"],
    });
    await dialog
      .getByRole("button", { name: "重新读取权限与列表", exact: true })
      .click();
    const preview = dialog.locator("[data-workflow-role-preview]");
    await expect(preview.getByText(/当前目录：/)).toContainText(changedName);
    await expect(preview.getByText(/上次确认：/)).toContainText(roleName);
    await expect(submit).toBeDisabled();
    await expect(hours).toHaveValue("7");
    await expect(
      dialog.getByRole("combobox", { name: "待授权内部账号", exact: true })
    ).toContainText(memberLogin.username);
    for (const width of [320, 390, 1024, 1920]) {
      await page.setViewportSize({ width, height: 920 });
      const geometry = await dialog.evaluate(element => {
        const r = element.getBoundingClientRect();
        return {
          x: r.x,
          right: r.right,
          y: r.y,
          bottom: r.bottom,
          overflow: element.scrollWidth > element.clientWidth + 1,
        };
      });
      assert(
        geometry.x >= -1 &&
          geometry.right <= width + 1 &&
          geometry.y >= -1 &&
          geometry.bottom <= 921 &&
          !geometry.overflow,
        JSON.stringify(geometry)
      );
      assert.equal(
        await preview.evaluate(element => getComputedStyle(element).fontSize),
        "14px"
      );
      if ([390, 1920].includes(width))
        await page.screenshot({
          path: path.join(directory, `role-confirmation-${width}.png`),
          fullPage: false,
        });
    }
    await dialog
      .getByRole("button", { name: "确认使用当前角色权限", exact: true })
      .click();
    await expect(submit).toBeEnabled();
    await expect(preview.getByText(/本次确认：/)).toContainText(changedName);
    token = (await currentRole()).configToken;
    const sent = page.waitForRequest(
      request =>
        request.method() === "POST" &&
        request.url().includes("workflow.assignCustomRole")
    );
    await submit.click();
    const request = await sent;
    const payload = JSON.parse(request.postData());
    const submitted =
      payload.json ??
      Object.values(payload)
        .map(item => item.json)
        .find(item => item?.roleCode === fixture.workflowRoleCode);
    assert.equal(submitted.expectedConfigToken, token);
    await poll("confirmed UI binding", snapshot, value => value.active === 1);
    await expect(hours).toHaveValue("");
    state = await snapshot();
    assert(
      state.grants.some(
        item =>
          item.roleConfigToken === token &&
          item.permissionCodes.includes("workflow:run")
      )
    );
    await owner(
      "workflow.grantMember",
      { workflowId: flowId(), userId: fixture.disabledUserId, role: "viewer" },
      true
    );
    const row = dialog
      .locator("[data-workflow-grant]")
      .filter({ hasText: memberLogin.username })
      .filter({ hasText: changedName });
    await row.getByRole("button", { name: "撤销", exact: true }).click();
    const revoke = page.getByRole("alertdialog", {
      name: "撤销这项流程授权",
      exact: true,
    });
    await expect(revoke).toBeVisible();
    await revoke.getByRole("button", { name: "保留授权", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "撤销", exact: true })
    ).toBeFocused();
    await row.getByRole("button", { name: "撤销", exact: true }).click();
    await revoke.getByRole("button", { name: "确认撤销", exact: true }).click();
    await poll(
      "only custom source revoked",
      snapshot,
      value => value.active === 0
    );
    access = await member("workflow.access", { id: flowId() });
    assert(has(access, "workflow:view"));
    assert(!has(access, "workflow:run"));
    await owner(
      "workflow.revokeMember",
      { workflowId: flowId(), userId: fixture.disabledUserId, role: "viewer" },
      true
    );
    assert.deepEqual(errors, []);
    report({
      stage: "workflow-role-config-ui",
      tag,
      separateScopeAndOrigin: true,
      selectionAndHoursPreserved: true,
      explicitReconfirmation: true,
      confirmedTokenSubmitted: true,
      concurrentSingleWinner: true,
      siblingScopeDenied: true,
      otherGrantSurvivesRevocation: true,
      widths: [320, 390, 1024, 1920],
      pageErrors: 0,
    });
  } catch (error) {
    failed = true;
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: false,
        })
        .catch(() => {});
    console.error(
      [login.password, memberLogin.password].reduce(
        (value, secret) => value.replaceAll(secret, "[credential]"),
        error.stack ?? error.message
      )
    );
  } finally {
    if (browser) await browser.close();
    try {
      if (fixture?.workflowRoleCode) {
        try {
          const role = await currentRole();
          assert(
            role.name.startsWith("流程权限验收_") && role.name.endsWith(tag)
          );
          await updateRole({ name: roleName, permissions: ["workflow:view"] });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
    } catch (error) {
      failed = true;
      console.error(error.message);
    }
    try {
      if (fixture?.userId)
        report({
          output: (await remote({ action: "cleanup", fixture, login })).trim(),
        });
      if (fingerprint)
        assert.equal(
          (await remote({ action: "settings_fingerprint" })).trim(),
          fingerprint
        );
    } catch (error) {
      failed = true;
      console.error(error.message);
    }
    process.exitCode = failed ? 1 : 0;
  }
})();
