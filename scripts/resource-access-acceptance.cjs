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
async function poll(description, read, accept, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await read();
    if (accept(result)) return result;
    await sleep(1000);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

(async () => {
  let browser,
    page,
    failed = false;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    assert(fixture?.projectId && fixture.workflows.length === 3);
    report({ stage: "fixture-created", tag, directory });
    report({
      output: (
        await remote({ action: "prepare_native_schedule", fixture, login })
      ).trim(),
    });
    await owner("auth.login", login, true);
    await viewer("auth.login", memberLogin, true);
    const flow = fixture.workflows.find(item => item.flowType === "data");
    const input = { projectId: fixture.projectId, workflowId: flow.id };
    const resources = () =>
      owner("data.resources", { projectId: input.projectId });
    await owner(
      "data.createUdf",
      {
        projectId: input.projectId,
        name: "权限文本函数_" + tag,
        udfType: "javascript",
        returnType: "string",
        artifactRef: "builtin:trim",
      },
      true
    );
    await owner(
      "data.createTag",
      { projectId: input.projectId, name: "权限标签_" + tag },
      true
    );
    await owner(
      "data.createPlugin",
      {
        projectId: input.projectId,
        name: "权限插件_" + tag,
        pluginType: "transform",
        version: "1.0.0",
        config: {},
      },
      true
    );
    await owner(
      "data.saveScheduleDraft",
      { ...input, cronExpression: "0 0 9 * * *" },
      true
    );
    const original = await resources();
    const source = original.sources[0],
      asset = original.assets[0];
    assert(source && asset);
    const project = await owner("project.get", { projectId: input.projectId });
    assert.equal(project.ownerUserId, fixture.userId);
    assert.equal(project.code, tag.toUpperCase());
    const forbidden = async (name, body) =>
      assert.rejects(viewer(name, body, true), error => error.status === 403);
    const deniedSource = {
      projectId: input.projectId,
      name: "禁止创建_" + tag,
      sourceType: "inline",
      connection: { description: "隔离权限验证" },
    };
    await forbidden("data.createSource", deniedSource);
    await forbidden("data.testSource", {
      projectId: input.projectId,
      sourceId: source.id,
    });
    await forbidden("data.deleteSource", {
      projectId: input.projectId,
      sourceId: source.id,
    });
    await forbidden("data.activateSchedule", { ...input, expectedRevision: 1 });
    await forbidden("data.run", input);

    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      hasTouch: true,
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    const assetRequests = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.endsWith(".js"))
        assetRequests.push(request.url());
    });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(`${base}#/flows/project/${input.projectId}`);
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .waitFor();
    assert.equal(
      assetRequests.some(url => url.includes("/DataResourceCenter-")),
      false
    );
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await page.locator("[data-resource-center]").waitFor();
    assert(assetRequests.some(url => url.includes("/DataResourceCenter-")));
    report({ stage: "resource-code-loading", loadedOnlyOnEntry: true });
    await expect(page.locator("[data-resource-readonly]")).toContainText(
      "只读访问"
    );
    const selectTab = async label => {
      if (await page.locator("[data-resource-category-select]").isVisible()) {
        const option = page
          .locator("[data-resource-category-select] option")
          .filter({ hasText: label });
        await page
          .locator("[data-resource-category-select]")
          .selectOption(await option.getAttribute("value"));
      } else
        await page
          .locator("[data-resource-category-desktop]")
          .getByRole("button", { name: new RegExp("^" + label) })
          .click();
    };
    const selectSection = label =>
      page
        .getByRole("navigation", { name: "数据流工作区视图" })
        .getByRole("button", { name: new RegExp("^" + label) })
        .click();
    const clickMutation = async (button, name) => {
      const response = page.waitForResponse(
        response =>
          response.url().includes(name) &&
          response.request().method() === "POST"
      );
      const [result] = await Promise.all([response, button.click()]);
      return result;
    };
    const refresh = async (scope = page) => {
      const response = page.waitForResponse(
        response =>
          response.url().includes("project.access") &&
          response.request().method() === "GET"
      );
      await Promise.all([
        response,
        scope
          .getByRole("button", { name: "刷新业务权限", exact: true })
          .click(),
      ]);
    };
    const setRole = async (role, refreshUI = true) => {
      await owner(
        "project.grantMember",
        { projectId: input.projectId, userId: fixture.disabledUserId, role },
        true
      );
      const assignments = await owner("project.members", {
        projectId: input.projectId,
      });
      for (const assignment of assignments.filter(
        item =>
          Number(item.userId) === fixture.disabledUserId && item.role !== role
      )) {
        await owner(
          "project.revokeMember",
          {
            projectId: input.projectId,
            userId: fixture.disabledUserId,
            assignmentId: assignment.id,
          },
          true
        );
      }
      if (refreshUI) await refresh();
    };
    await expect(
      page.getByRole("button", { name: "添加数据源", exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "校验登记", exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^删除数据源/ })).toHaveCount(
      0
    );
    await selectTab("资源探查");
    await page
      .getByRole("button", { name: "查看资源详情 " + asset.name, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("登记");
    await page
      .getByRole("button", { name: "关闭资源详情", exact: true })
      .click();
    for (const [tab, action] of [
      ["函数", "注册函数"],
      ["标签", "新建标签"],
      ["项目插件", "登记项目插件"],
    ]) {
      await selectTab(tab);
      await expect(
        page.getByRole("button", { name: action, exact: true })
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^删除/ })).toHaveCount(0);
    }
    await selectTab("数据流");
    await expect(
      page.getByRole("button", { name: "运行数据流", exact: true })
    ).toHaveCount(0);
    await selectSection("调度计划");
    for (const name of ["保存调度草稿", "启用计划", "暂停计划"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
        0
      );
    await expect(page.getByRole("button", { name: /^删除计划/ })).toHaveCount(
      0
    );
    await page.screenshot({
      path: path.join(directory, "resource-viewer.png"),
      fullPage: true,
    });
    report({
      stage: "resource-viewer",
      metadataVisible: true,
      assetDetailAllowed: true,
      mutationsHidden: true,
      serverDenied: true,
    });

    await setRole("operator");
    await expect(page.locator("[data-resource-readonly]")).toContainText(
      "发起已发布"
    );
    await expect(
      page.getByRole("button", { name: "保存调度草稿", exact: true })
    ).toHaveCount(0);
    await forbidden("data.createSource", deniedSource);
    await forbidden("data.activateSchedule", { ...input, expectedRevision: 1 });
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "运行数据流", exact: true }),
          "data.run"
        )
      ).status(),
      200
    );
    const runs = await poll(
      "operator data run",
      () => owner("data.runs", { ...input, summaryOnly: true, limit: 10 }),
      items => items.some(item => item.status === "success")
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].triggeredByUserId, fixture.disabledUserId);
    const result = await owner("data.runDetail", {
      projectId: input.projectId,
      runId: runs[0].id,
    });
    assert.deepEqual(result.output.terminals[0].rows, [
      { id: 1, amount: 120, status: "paid" },
    ]);
    report({
      stage: "resource-operator",
      realRunSucceeded: true,
      resourceAndScheduleEditsDenied: true,
    });

    await setRole("designer");
    await expect(
      page.getByRole("button", { name: "运行数据流", exact: true })
    ).toHaveCount(0);
    await forbidden("data.run", input);
    await selectSection("调度计划");
    await expect(
      page.getByRole("button", { name: "保存调度草稿", exact: true })
    ).toBeVisible();
    await selectTab("数据源");
    await expect(
      page.getByRole("button", { name: "添加数据源", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "添加数据源", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const draftName = "权限恢复源_" + tag;
    await dialog.getByLabel("数据源名称", { exact: true }).fill(draftName);
    await dialog
      .getByLabel("连接说明", { exact: true })
      .fill("权限变更时保留的填写内容");
    let failedRead = 0;
    const failPermissionRead = async route => {
      if (
        !failedRead &&
        route.request().method() === "GET" &&
        route.request().url().includes("project.access")
      ) {
        failedRead++;
        await route.abort("failed");
      } else await route.fallback();
    };
    await page.route("**/api/trpc/**", failPermissionRead);
    await setRole("viewer", false);
    let submittedAfterRevocation = false;
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    if (await save.isEnabled()) {
      assert.equal(
        (await clickMutation(save, "data.createSource")).status(),
        403
      );
      submittedAfterRevocation = true;
    }
    await expect(save).toBeDisabled();
    await expect(dialog.getByText(/权限暂不可用/)).toBeVisible();
    await expect(dialog.getByLabel("数据源名称", { exact: true })).toHaveValue(
      draftName
    );
    await expect(dialog.getByLabel("连接说明", { exact: true })).toHaveValue(
      "权限变更时保留的填写内容"
    );
    assert.equal(failedRead, 1);
    assert.equal(
      (await resources()).sources.some(item => item.name === draftName),
      false
    );
    await page.unroute("**/api/trpc/**", failPermissionRead);
    await setRole("designer", false);
    await refresh(dialog);
    await expect(save).toBeEnabled();
    await expect(dialog.getByLabel("数据源名称", { exact: true })).toHaveValue(
      draftName
    );
    assert.equal(
      (await clickMutation(save, "data.createSource")).status(),
      200
    );
    await expect(dialog).toHaveCount(0);
    assert.equal(
      (await resources()).sources.filter(item => item.name === draftName)
        .length,
      1
    );
    report({
      stage: "resource-draft-recovery",
      revocationDenied: submittedAfterRevocation,
      permissionReadFailureInjected: failedRead,
      staleCachedRightsBlocked: true,
      draftRestoredAndSavedOnce: true,
    });

    await selectTab("标签");
    await page.getByRole("button", { name: "新建标签", exact: true }).click();
    const draftTag = "权限恢复标签_" + tag;
    await dialog.getByLabel("标签名称", { exact: true }).fill(draftTag);
    await setRole("viewer", false);
    const tagSave = dialog.getByRole("button", { name: "保存", exact: true });
    if (await tagSave.isEnabled())
      assert.equal(
        (await clickMutation(tagSave, "data.createTag")).status(),
        403
      );
    await expect(tagSave).toBeDisabled();
    await expect(dialog.getByLabel("标签名称", { exact: true })).toHaveValue(
      draftTag
    );
    await setRole("designer", false);
    await refresh(dialog);
    assert.equal(
      (await clickMutation(tagSave, "data.createTag")).status(),
      200
    );
    await expect(dialog).toHaveCount(0);
    assert.equal(
      (await resources()).tags.filter(item => item.name === draftTag).length,
      1
    );
    report({
      stage: "generic-resource-draft",
      revokedRoleBlocked: true,
      tagDraftPreserved: true,
      restoredSubmitSucceeded: true,
    });

    await setRole("owner");
    await selectTab("数据流");
    await expect(
      page.getByRole("button", { name: "运行数据流", exact: true })
    ).toBeVisible();
    await selectSection("调度计划");
    await expect(
      page.getByRole("button", { name: "保存调度草稿", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "启用计划", exact: true })
    ).toBeVisible();
    for (const role of ["designer", "operator"]) {
      await owner(
        "project.grantMember",
        { projectId: input.projectId, userId: fixture.disabledUserId, role },
        true
      );
    }
    await page
      .getByRole("button", { name: "权限配置中心", exact: false })
      .click();
    await expect(
      page.locator('[data-project-permission-grant="department"]')
    ).toBeVisible();
    report({
      stage: "project-owner-capabilities",
      resourceEditAndFormalRun: true,
      memberManagementVisible: true,
    });
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^移除成员授权：.*${login.username}`),
      })
    ).toHaveCount(0);
    const assignments = await owner("project.members", {
      projectId: input.projectId,
    });
    assert.equal(
      Number(
        assignments.find(
          item =>
            Number(item.userId) === fixture.userId && item.role === "owner"
        ).protectedOwner
      ),
      1
    );
    await assert.rejects(
      owner(
        "project.revokeMember",
        {
          projectId: input.projectId,
          userId: fixture.userId,
          assignmentId: assignments.find(
            item =>
              Number(item.userId) === fixture.userId && item.role === "owner"
          ).id,
        },
        true
      ),
      error => error.status === 400
    );
    const revokeFromUI = async (role, label) => {
      const assignment = assignments.find(
        item =>
          Number(item.userId) === fixture.disabledUserId && item.role === role
      );
      assert(assignment && !assignment.protectedOwner);
      await page
        .getByRole("button", {
          name: new RegExp(
            `^移除成员授权：.*${memberLogin.username}.* · ${label}$`
          ),
        })
        .click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText(`“${label}”角色授权`);
      const [response] = await Promise.all([
        page.waitForResponse(
          response =>
            response.url().includes("project.revokeMember") &&
            response.request().method() === "POST"
        ),
        dialog.getByRole("button", { name: "确认移除", exact: true }).click(),
      ]);
      assert.equal(response.status(), 200);
      assert(response.request().postData().includes(assignment.id));
      await expect(dialog).toHaveCount(0);
    };
    await revokeFromUI("designer", "设计者");
    let remaining = await owner("project.members", {
      projectId: input.projectId,
    });
    assert.deepEqual(
      remaining
        .filter(item => Number(item.userId) === fixture.disabledUserId)
        .map(item => item.role)
        .sort(),
      ["operator", "owner"]
    );
    await revokeFromUI("owner", "业务管理员");
    remaining = await owner("project.members", { projectId: input.projectId });
    assert.deepEqual(
      remaining
        .filter(item => Number(item.userId) === fixture.disabledUserId)
        .map(item => item.role),
      ["operator"]
    );
    await expect(
      page.locator('[data-project-permission-grant="department"]')
    ).toHaveCount(0);
    report({
      stage: "individual-member-revocation",
      otherRolesPreserved: true,
      delegatedManagerRevocable: true,
      creatorProtected: true,
    });
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await setRole("viewer");
    await page.setViewportSize({ width: 390, height: 844 });
    await selectTab("资源探查");
    await expect(
      page.getByRole("button", {
        name: "查看资源详情 " + asset.name,
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^删除/ })).toHaveCount(0);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        pickerRight: document
          .querySelector('[aria-label="切换当前受权业务"]')
          .getBoundingClientRect().right,
      }));
      report({ stage: "mobile-resource-layout", ...geometry });
      assert(
        geometry.document <= width + 1 && geometry.pickerRight <= width,
        JSON.stringify(geometry)
      );
    }
    await page.screenshot({
      path: path.join(directory, "resource-readonly-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      (await resources()).sources.some(item => item.name === deniedSource.name),
      false
    );
    await owner(
      "project.revokeMember",
      { projectId: input.projectId, userId: fixture.disabledUserId },
      true
    );
    await refresh();
    await expect(page.locator("[data-project-access-denied]")).toBeVisible();
    await expect(page.locator("[data-resource-center]")).toHaveCount(0);
    await expect(page.getByText(asset.name, { exact: true })).toHaveCount(0);
    await assert.rejects(
      viewer("data.resources", { projectId: input.projectId }),
      error => error.status === 403
    );
    await setRole("viewer");
    await expect(page.locator("[data-resource-center]")).toBeVisible();
    report({
      stage: "business-view-revocation",
      cachedResourceViewCleared: true,
      serverReadDenied: true,
      restoredReadAccess: true,
    });
    assert.deepEqual(errors, []);
    report({
      stage: "resource-access-acceptance",
      passed: true,
      roles: ["viewer", "operator", "designer", "owner"],
      mobileReadOnly: true,
      browserErrors: 0,
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
    if (browser) await browser.close();
    if (fixture?.projectId) {
      try {
        report({
          output: (
            await remote({ action: "cleanup_native_schedule", fixture, login })
          ).trim(),
        });
      } catch (error) {
        failed = true;
        console.error("Schedule cleanup failed: " + error.message);
      }
    }
    if (fixture?.userId) {
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
