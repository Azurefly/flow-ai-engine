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

const readFlow = flow => owner("workflow.get", { id: flow.id });
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
    assert(fixture?.workflows.length === 3);
    report({ stage: "workspace-fixture", tag });
    await owner("auth.login", login, true);
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const searches = [];
    page.on("request", request => {
      if (request.url().includes("/api/trpc/workflow.search"))
        searches.push(request.url());
    });
    const signIn = async (target, credentials) => {
      await target.goto(base);
      await target
        .getByLabel("用户名", { exact: true })
        .fill(credentials.username);
      await target
        .getByLabel("密码", { exact: true })
        .fill(credentials.password);
      await target
        .getByRole("button", { name: "登录流程引擎", exact: true })
        .click();
      await target
        .locator('input[type="password"]')
        .waitFor({ state: "hidden" });
    };
    await signIn(page, login);
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible();
    const nav = page.getByRole("tablist", {
      name: "流程工作台主导航",
      exact: true,
    });
    const bounds = await nav.boundingBox();
    const panel = await page.locator("#aiflow-console-panel").boundingBox();
    assert(
      bounds.x < 24 &&
        bounds.width >= 180 &&
        bounds.height >= 700 &&
        panel.x >= bounds.x + bounds.width
    );
    assert.equal(searches.length, 0);
    await page.screenshot({
      path: path.join(directory, "workspace-business-center.png"),
      fullPage: false,
      animations: "disabled",
    });
    await page.keyboard.press("Control+k");
    const command = page.getByRole("dialog", { name: "快捷查找", exact: true });
    const input = command.getByRole("combobox", {
      name: "搜索业务、流程或页面",
      exact: true,
    });
    await expect(input).toBeFocused();
    await sleep(400);
    assert.equal(searches.length, 0);
    await input.fill(tag);
    const projectOption = command
      .getByRole("option")
      .filter({ hasText: "界面隔离验收_" + tag });
    await expect(projectOption).toBeVisible();
    for (const flow of fixture.workflows)
      await expect(
        command.getByRole("option").filter({ hasText: flow.name })
      ).toBeVisible();
    const projected = await owner("workflow.search", { search: tag });
    assert.equal(projected.length, 3);
    for (const item of projected)
      assert.deepEqual(Object.keys(item).sort(), [
        "flowType",
        "id",
        "name",
        "status",
      ]);
    assert(Buffer.byteLength(JSON.stringify(projected)) < 3000);
    await projectOption.click();
    await expect(page).toHaveURL(
      new RegExp("#/flows/project/" + fixture.projectId + "$")
    );
    report({
      stage: "workspace-search",
      lazy: true,
      ownedProjectsAndThreeFlows: true,
      minimalProjection: true,
      contextualNavigation: true,
    });

    for (const flow of fixture.workflows) {
      const before = await readFlow(flow);
      await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
      await page.locator("[data-workflow-editor]").waitFor();
      const middle = before.definition.nodes[1];
      await page
        .getByRole("combobox", { name: "定位并配置节点", exact: true })
        .selectOption(middle.id);
      const inspector = page.locator("[data-workflow-inspector]");
      await expect(inspector).toBeVisible();
      const highlight = page.getByRole("button", {
        name: "高亮节点关联",
        exact: true,
      });
      await highlight.click();
      await expect(highlight).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-workflow-neighborhood]")).toContainText(
        "静态连接"
      );
      assert(
        (await page.locator(".react-flow__node.aiflow-related-node").count()) >
          0
      );
      assert.deepEqual((await readFlow(flow)).definition, before.definition);
      await page.screenshot({
        path: path.join(directory, `workspace-${flow.flowType}-canvas.png`),
        fullPage: false,
        animations: "disabled",
      });
      const nodeName = inspector.getByRole("textbox", {
        name: "节点名称",
        exact: true,
      });
      const original = await nodeName.inputValue();
      const draft = original + "_待保存_" + tag;
      await nodeName.fill(draft);
      await expect(
        page.getByRole("button", { name: /^保存画布/ })
      ).toBeEnabled();
      const element = await nodeName.elementHandle();
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
      await sleep(600);
      assert(await element.evaluate(element => element.isConnected));
      await expect(nodeName).toHaveValue(draft);
      await page.keyboard.press("Control+k");
      await command.getByRole("option").filter({ hasText: "流程仓库" }).click();
      const warning = page.getByRole("dialog", {
        name: "离开前保留流程修改",
        exact: true,
      });
      await expect(warning).toBeVisible();
      await warning
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(nodeName).toHaveValue(draft);
      await nodeName.fill(original);
      await expect(
        page.getByRole("button", { name: /^保存画布/ })
      ).toBeDisabled();
      await highlight.click();
      await expect(page.locator("[data-workflow-neighborhood]")).toHaveCount(0);
      assert.deepEqual((await readFlow(flow)).definition, before.definition);
      report({
        stage: "workspace-canvas",
        flowType: flow.flowType,
        staticNeighborhood: true,
        noDefinitionMutation: true,
        themeRetainedNodeAndDraft: true,
        commandNavigationGuarded: true,
      });
    }

    await page.goto(base + "#/system/identity");
    await page
      .getByRole("textbox", { name: "搜索用户", exact: true })
      .fill(login.username);
    const userRow = page
      .locator("[data-iam-user-row]")
      .filter({ hasText: login.username });
    await userRow.locator("button[aria-pressed]").click();
    const userSummary = page.locator("[data-access-relationship]");
    await expect(userSummary).toBeVisible();
    await userSummary.getByRole("button", { name: /定位有效权限/ }).click();
    assert(
      await page.evaluate(() =>
        document.activeElement.hasAttribute("data-access-details-target")
      )
    );
    await page.getByRole("tab", { name: "角色与权限", exact: true }).click();
    const roleSummary = page.locator("[data-access-relationship]");
    await expect(roleSummary).toBeVisible();
    await roleSummary.getByRole("button", { name: /定位权限清单/ }).click();
    assert(
      await page.evaluate(() =>
        document.activeElement.hasAttribute("data-access-details-target")
      )
    );
    report({
      stage: "workspace-authorization",
      userAndRoleRelationships: true,
      actualEvidenceFocused: true,
    });

    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      await page
        .getByRole("button", { name: "快捷查找业务、流程或页面", exact: true })
        .click();
      await expect(command).toBeVisible();
      await expect(command).toHaveCSS("opacity", "1");
      const box = await command.boundingBox();
      assert(
        box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= 845
      );
      if (width < 400)
        await page.screenshot({
          path: path.join(directory, `workspace-command-${width}.png`),
          fullPage: false,
          animations: "disabled",
        });
      await page.keyboard.press("Escape");
      await expect(command).toBeHidden();
      await expect(
        page.getByRole("button", {
          name: "快捷查找业务、流程或页面",
          exact: true,
        })
      ).toBeFocused();
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "切换主题", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          document.getAnimations().filter(a => a.playState === "running").length
      ),
      0
    );
    const activeTab = nav.getByRole("tab", { selected: true });
    await activeTab.focus();
    await page.keyboard.press("ArrowUp");
    assert(
      await page.evaluate(
        () => document.activeElement.getAttribute("role") === "tab"
      )
    );
    report({
      stage: "workspace-responsive-motion",
      widths: [320, 390, 1024, 1440],
      commandFocusRestored: true,
      reducedMotion: true,
      navigationKeyboard: true,
    });
    await page.screenshot({
      path: path.join(directory, "workspace-role-overview.png"),
      fullPage: false,
      animations: "disabled",
    });

    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await viewer("auth.login", memberLogin, true);
    assert.deepEqual(await viewer("workflow.search", { search: tag }), []);
    const memberContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
    });
    await memberContext.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, memberLogin);
    await memberPage
      .getByRole("button", { name: "快捷查找业务、流程或页面", exact: true })
      .click();
    const memberCommand = memberPage.getByRole("dialog", {
      name: "快捷查找",
      exact: true,
    });
    await expect(
      memberCommand.getByRole("option").filter({ hasText: "人员与权限" })
    ).toHaveCount(0);
    await memberCommand
      .getByRole("combobox", { name: "搜索业务、流程或页面", exact: true })
      .fill(tag);
    await expect(
      memberCommand.getByText("没有找到可访问的结果，请换个关键词。", {
        exact: true,
      })
    ).toBeVisible();
    await memberContext.close();
    assert.deepEqual(errors, []);
    report({
      stage: "workspace-complete",
      ordinaryAccountCannotSeeOwnedSearchResults: true,
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
    if (fixture?.tag)
      try {
        report({
          output: (await remote({ action: "cleanup", fixture, login })).trim(),
        });
      } catch (error) {
        failed = true;
        console.error("Fixture cleanup failed: " + error.message);
      }
    process.exitCode = failed ? 1 : 0;
  }
})();
