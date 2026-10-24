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
(async () => {
  let browser,
    page,
    fingerprint,
    failed = false;
  const owner = session(),
    metrics = [],
    errors = [],
    runRequests = [];
  try {
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
      formPreview: true,
    });
    await owner("auth.login", login, true);
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.route("**/*", route => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        /(?:workflow\.run|data\.run)(?:\?|$)/.test(request.url())
      )
        runRequests.push(request.url().split("?")[0]);
      return request.url().startsWith(base) ? route.continue() : route.abort();
    });
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    let view = 0;
    const openEditor = async flow => {
      await page.goto(
        `${base}?editorLayoutView=${++view}#/flows/workflow/${flow.id}/editor`
      );
      await page.locator('[data-editor-viewport="true"]').waitFor();
      await expect(page.getByLabel("流程名称", { exact: true })).toHaveValue(
        flow.name
      );
    };
    const nodePicker = () =>
      page.getByRole("combobox", { name: "定位并配置节点", exact: true });
    const paletteTrigger = () =>
      page
        .locator("[data-canvas-palette-trigger]")
        .filter({ hasText: "添加节点" });
    const palette = () =>
      page.getByRole("dialog", { name: "添加流程节点", exact: true });
    const settle = () =>
      page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
    const savedNode = async (flow, nodeId) =>
      (await owner("workflow.get", { id: flow.id })).definition.nodes.find(
        node => node.id === nodeId
      );
    for (const flow of fixture.workflows) {
      assert(["state", "control", "data"].includes(flow.flowType));
      const nodeId = flow.flowType === "data" ? "source" : "review";
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openEditor(flow);
      await nodePicker().selectOption(nodeId);
      await page.locator("[data-workflow-inspector]").waitFor();
      for (const viewport of [
        { width: 1440, height: 1000 },
        { width: 1024, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => scrollTo(0, 0));
        await settle();
        const result = await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          const graph = rect("[data-flow-canvas-viewport]"),
            root = rect("[data-workflow-editor]"),
            panel = rect("[data-workflow-inspector]");
          return {
            width: innerWidth,
            height: innerHeight,
            graph,
            root,
            panel,
            visibleGraphHeight: Math.max(
              0,
              Math.min(innerHeight, graph.bottom) - Math.max(0, graph.top)
            ),
            documentHeight: document.documentElement.scrollHeight,
            horizontalOverflow:
              document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
        assert.equal(result.horizontalOverflow, false);
        assert(
          result.root.bottom <= viewport.height + 1,
          JSON.stringify(result)
        );
        assert(
          result.documentHeight <= viewport.height + 1,
          JSON.stringify(result)
        );
        assert(
          result.visibleGraphHeight >= (viewport.width === 1440 ? 644 : 432),
          JSON.stringify(result)
        );
        assert(result.graph.width >= 550, JSON.stringify(result));
        assert(
          result.panel.width >= 280 && result.panel.width <= 401,
          JSON.stringify(result)
        );
        metrics.push({ flowType: flow.flowType, ...result });
        if (viewport.width === 1440)
          await page.screenshot({
            path: path.join(directory, `workspace-${flow.flowType}.png`),
            fullPage: false,
          });
      }
      // Long configurations scroll inside the inspector while the commands remain reachable.
      await page.setViewportSize({ width: 1024, height: 640 });
      await settle();
      if (flow.flowType !== "data")
        await page
          .getByRole("tab", { name: "表单与时限", exact: true })
          .click();
      const content = page.locator("[data-workflow-inspector-content]");
      const scrollBefore = await page.evaluate(() => scrollY);
      const scroll = await content.evaluate(element => {
        const range = element.scrollHeight - element.clientHeight;
        element.scrollTop = 160;
        return {
          range,
          moved: element.scrollTop,
          overflow: getComputedStyle(element).overflowY,
        };
      });
      assert(
        scroll.range > 20 && scroll.moved > 0 && scroll.overflow === "auto",
        JSON.stringify(scroll)
      );
      assert.equal(await page.evaluate(() => scrollY), scrollBefore);
      await expect(
        page.getByRole("button", { name: "保存画布", exact: true })
      ).toBeInViewport();
      await page
        .getByRole("button", { name: "最大化面板", exact: true })
        .click();
      await expect(page.locator("[data-workflow-editor]")).toHaveAttribute(
        "data-inspector-mode",
        "maximized"
      );
      await page
        .getByRole("button", { name: "最小化面板", exact: true })
        .click();
      await expect(page.locator("[data-workflow-editor]")).toHaveAttribute(
        "data-inspector-mode",
        "compact"
      );
      await page
        .getByRole("button", { name: "恢复配置面板", exact: true })
        .click();
      if (flow.flowType !== "data")
        await page.getByRole("tab", { name: "基本信息", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await settle();
      const savedBefore = await owner("workflow.get", { id: flow.id });
      // Escape restores focus; adding a node closes the portal and moves focus to its configuration.
      await paletteTrigger().click();
      await expect(palette()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(palette()).toBeHidden();
      await expect(paletteTrigger()).toBeFocused();
      const nodeCount = await nodePicker().locator("option").count();
      await paletteTrigger().click();
      await palette().getByRole("button", { name: /^添加/ }).first().click();
      await expect(palette()).toBeHidden();
      await expect(nodePicker().locator("option")).toHaveCount(nodeCount + 1);
      await expect(
        page.locator("[data-workflow-inspector-heading]")
      ).toBeFocused();
      await page.getByRole("button", { name: "撤销", exact: true }).click();
      await expect(nodePicker().locator("option")).toHaveCount(nodeCount);
      assert.deepEqual(
        (await owner("workflow.get", { id: flow.id })).definition,
        savedBefore.definition
      );
      await nodePicker().selectOption(nodeId);
      await page
        .getByRole("button", { name: "定位与显示", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "定位并配置连线", exact: true })
        .selectOption("edge-0");
      await expect(
        page.locator("[data-workflow-inspector-heading]")
      ).toHaveText("连线配置");
      await nodePicker().selectOption(nodeId);
      await page
        .getByRole("button", { name: "定位与显示", exact: true })
        .click();
      await page
        .getByRole("button", { name: "高亮节点关联", exact: true })
        .click();
      await expect(page.locator("[data-workflow-neighborhood]")).toBeVisible();
      await page.keyboard.press("Escape");
      // A native fullscreen portal must remain inside the fullscreen element.
      await page.getByRole("button", { name: "全屏展示", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              document.fullscreenElement?.matches("[data-workflow-editor]")
            )
          )
        )
        .toBe(true);
      await paletteTrigger().click();
      await expect(palette()).toBeVisible();
      assert(
        await palette().evaluate(element =>
          document.fullscreenElement.contains(element)
        )
      );
      await paletteTrigger().click();
      await expect(palette()).toBeHidden();
      await page.getByRole("button", { name: "退出全屏", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
      // Merely opening the new visible run command must never create an execution.
      const runLabel =
        flow.flowType === "data"
          ? "执行数据流程"
          : flow.flowType === "state"
            ? "运行状态流程"
            : "运行控制流程";
      await page.getByRole("button", { name: runLabel, exact: true }).click();
      const runDialog = page
        .getByRole("dialog")
        .filter({ hasText: /本次会直接真实执行/ });
      await expect(runDialog).toBeVisible();
      await runDialog
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await expect(runDialog).toBeHidden();
      assert.equal(runRequests.length, 0);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 920 });
        await nodePicker().selectOption(nodeId);
        await expect(
          page.locator("[data-workflow-inspector-heading]")
        ).toBeInViewport();
        const name = `布局验收-${flow.flowType}-${width}`;
        await page.getByLabel("节点名称", { exact: true }).fill(name);
        const commandBar = page.locator("[data-editor-command-bar]");
        await expect(commandBar).toBeInViewport();
        const mobile = await page.evaluate(() => {
          const bar = document
            .querySelector("[data-editor-command-bar]")
            .getBoundingClientRect();
          const heading = document
            .querySelector("[data-workflow-inspector-heading]")
            .getBoundingClientRect();
          return {
            horizontalOverflow:
              document.documentElement.scrollWidth > innerWidth + 1,
            headingTop: heading.top,
            commandBottom: bar.bottom,
            buttons: [
              ...document.querySelectorAll(
                "[data-editor-primary-actions] > button"
              ),
            ].map(element => ({
              width: element.getBoundingClientRect().width,
              height: element.getBoundingClientRect().height,
              overflow: element.scrollWidth > element.clientWidth + 1,
            })),
          };
        });
        assert.equal(mobile.horizontalOverflow, false, JSON.stringify(mobile));
        assert(
          mobile.headingTop >= mobile.commandBottom - 1,
          JSON.stringify(mobile)
        );
        assert(
          mobile.buttons.every(
            button =>
              button.width >= 43 && button.height >= 44 && !button.overflow
          ),
          JSON.stringify(mobile)
        );
        await page
          .getByRole("button", { name: "保存画布", exact: true })
          .click();
        await poll(
          "mobile node saved",
          () => savedNode(flow, nodeId),
          node => node.name === name
        );
        await expect(
          page.getByRole("button", { name: "保存画布", exact: true })
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "返回画布", exact: true })
          .click();
        await expect(nodePicker()).toBeInViewport();
        if (width === 390)
          await page.screenshot({
            path: path.join(directory, `mobile-${flow.flowType}.png`),
            fullPage: false,
          });
      }
      report({
        stage: "editor-workspace",
        flowType: flow.flowType,
        independentInspectorScroll: true,
        paletteFocusAndUndo: true,
        fullscreenPortal: true,
        visibleRunStillRequiresConfirmation: true,
        mobileSaved: [320, 390],
      });
    }
    // Publish and execute only the owned data sample. Verify the compact notice and unpublish cancellation.
    const data = fixture.workflows.find(flow => flow.flowType === "data");
    await remote({
      action: "prepare_native_schedule",
      fixture,
      login,
      reviewOnly: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openEditor(data);
    await page.getByRole("button", { name: "预检流程", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "发布", exact: true })
    ).toBeEnabled();
    await page.getByRole("button", { name: "发布", exact: true }).click();
    await poll(
      "published owned flow",
      () => owner("workflow.get", { id: data.id }),
      value => value.status === "published"
    );
    await openEditor(data);
    const notice = page.locator("[data-editor-publication-details]");
    await expect(notice).not.toHaveAttribute("open", "");
    await notice.locator("summary").click();
    await expect(
      notice.getByText("正在查看已发布版本", { exact: true })
    ).toBeVisible();
    await notice.locator("summary").click();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "取消发布", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: /^取消发布/ });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole("button", { name: "保持发布", exact: true })
      .click();
    await expect(confirmation).toBeHidden();
    await expect(
      page.getByRole("button", { name: "更多操作", exact: true })
    ).toBeFocused();
    assert.equal(
      (await owner("workflow.get", { id: data.id })).status,
      "published"
    );
    const started = await owner(
      "data.run",
      { projectId: fixture.projectId, workflowId: data.id },
      true
    );
    const result = await poll(
      "published sample execution",
      () =>
        owner("data.runDetail", {
          projectId: fixture.projectId,
          runId: started.runId,
        }),
      value => ["success", "failed"].includes(value.status)
    );
    assert.equal(result.status, "success", JSON.stringify(result.error));
    assert.equal(result.executionSource, "published_plan");
    assert.deepEqual(result.output.terminals[0].rows, [
      { id: 1, amount: 120, status: "paid" },
    ]);
    assert.equal(runRequests.length, 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(directory, "editor-layout-metrics.json"),
      JSON.stringify({ tag, metrics }, null, 2)
    );
    report({
      stage: "editor-workspace-complete",
      tag,
      metrics,
      publishedNotice: true,
      unpublishCancelAndFocus: true,
      publishedSampleRun: true,
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
        (text, secret) => text.replaceAll(secret, "[credential]"),
        error.stack ?? error.message
      )
    );
  } finally {
    if (browser) await browser.close();
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
