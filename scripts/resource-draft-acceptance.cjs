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
    assert(fixture?.projectId);
    await owner("auth.login", login, true);
    const sourceId = (
      await owner("data.resources", { projectId: fixture.projectId })
    ).sources[0].id;
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
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    // Wait for login's initial route restoration before entering through the UI.
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible();
    await page
      .getByLabel("搜索业务名称、代号或工作域", { exact: true })
      .fill(tag);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await page
      .getByRole("row")
      .filter({ hasText: tag })
      .getByRole("button", { name: "进入", exact: true })
      .click();
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    const category = async value => {
      const mobile = page.locator("[data-resource-category-select]");
      if (await mobile.isVisible()) await mobile.selectOption(value);
      if (!(await mobile.isVisible())) {
        const labels = {
          sources: "数据源",
          assets: "资源探查",
          udfs: "函数",
          tags: "标签",
          plugins: "项目插件",
        };
        await page
          .locator("[data-resource-category-desktop]")
          .getByRole("button", { name: new RegExp("^" + labels[value]) })
          .click();
      }
    };
    let failReads = false,
      failedReads = 0,
      failMutation = "",
      rejectedWrites = 0;
    const actualWrites = new Map();
    await page.route("**/api/trpc/**", async route => {
      const request = route.request(),
        url = request.url();
      const names = decodeURIComponent(
        new URL(url).pathname.split("/api/trpc/")[1]
      ).split(",");
      if (request.method() === "POST") {
        const method = names.find(name =>
          /^data\.create(Source|Asset|Udf|Tag|Plugin)$/.test(name)
        );
        if (method) {
          assert.equal(names.length, 1);
          const raw = request.postDataJSON(),
            input = raw.json ?? raw["0"]?.json;
          assert.equal(input.projectId, fixture.projectId);
          if (failMutation === method) {
            failMutation = "";
            rejectedWrites++;
            const value = {
              error: {
                json: {
                  message: "测试提交失败，尚未写入",
                  code: -32603,
                  data: {
                    code: "INTERNAL_SERVER_ERROR",
                    httpStatus: 503,
                    path: method,
                  },
                },
              },
            };
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              json: url.includes("batch=1") ? [value] : value,
            });
            return;
          }
          actualWrites.set(method, (actualWrites.get(method) ?? 0) + 1);
        }
      }
      if (
        failReads &&
        request.method() === "GET" &&
        names.includes("data.resources")
      ) {
        failedReads++;
        // Keep unrelated batched business/permission reads authoritative.
        const response = await route.fetch(),
          payload = await response.json();
        const value = {
          error: {
            json: {
              message: "测试资源列表读取失败",
              code: -32603,
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 503,
                path: "data.resources",
              },
            },
          },
        };
        if (Array.isArray(payload)) {
          payload[names.indexOf("data.resources")] = value;
          await route.fulfill({ response, json: payload });
        } else await route.fulfill({ response, json: value });
      } else await route.fallback();
    });
    const focusRefresh = () =>
      page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        window.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        window.dispatchEvent(new Event("visibilitychange"));
      });
    const specs = [
      {
        key: "sources",
        title: "添加数据源",
        label: "数据源名称",
        method: "data.createSource",
      },
      {
        key: "assets",
        title: "资源探查结果",
        label: "资源名称",
        method: "data.createAsset",
      },
      {
        key: "udfs",
        title: "注册函数",
        label: "函数名称",
        method: "data.createUdf",
      },
      {
        key: "tags",
        title: "新建标签",
        label: "标签名称",
        method: "data.createTag",
      },
      {
        key: "plugins",
        title: "登记项目插件",
        label: "插件名称",
        method: "data.createPlugin",
      },
    ];
    for (const [index, spec] of specs.entries()) {
      await category(spec.key);
      await page.getByRole("button", { name: spec.title, exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: spec.title,
        exact: true,
      });
      const visibleToasts = page.locator(
        '[data-sonner-toast][data-visible="true"]:not([data-removed="true"])'
      );
      await expect(visibleToasts).toHaveCount(0);
      const name = "列表失败保留_" + spec.key + "_" + tag;
      const field = dialog.getByLabel(spec.label, { exact: true });
      await field.fill(name);
      await field.evaluate(element => {
        element.dataset.draftIdentity = "preserved";
      });
      if (spec.key === "sources")
        await dialog
          .getByLabel("连接说明", { exact: true })
          .fill("尚未提交的完整说明");
      if (spec.key === "assets") {
        await dialog
          .getByRole("combobox", { name: /^关联数据源/ })
          .selectOption(sourceId);
        await dialog
          .getByPlaceholder("字段名", { exact: true })
          .first()
          .fill("order_id");
      }
      failReads = true;
      await focusRefresh();
      await expect(page.locator("[data-resource-error]")).toBeVisible({
        timeout: 25000,
      });
      assert(failedReads > 0);
      if (process.env.FLOW_UI_RESOURCE_DRAFT_REPRO === "1") {
        assert.equal(await dialog.count(), 0);
        report({
          stage: "resource-read-failure-reproduction",
          bugConfirmed: true,
          openDialogAndDraftUnmounted: true,
          failedReads,
        });
        break;
      }
      await expect(dialog).toBeVisible();
      await expect(field).toHaveValue(name);
      await expect(field).toHaveAttribute("data-draft-identity", "preserved");
      await expect(field).toBeEnabled();
      const save = dialog.getByRole("button", { name: "保存", exact: true });
      await expect(save).toBeDisabled();
      await expect(
        dialog.locator("[data-resource-catalog-notice]")
      ).toContainText("填写内容已保留");
      assert.equal(actualWrites.get(spec.method) ?? 0, 0);
      await expect(page.locator("[data-resource-table-desktop]")).toHaveCount(
        0
      );
      const previousReads = failedReads;
      await dialog
        .getByRole("button", { name: "重新读取资源", exact: true })
        .click();
      await expect.poll(() => failedReads).toBeGreaterThan(previousReads);
      await expect(
        dialog.getByRole("button", { name: "重新读取资源", exact: true })
      ).toBeEnabled();
      await expect(field).toHaveValue(name);
      await expect(save).toBeDisabled();
      if (spec.key === "assets") {
        await expect(
          dialog.getByRole("combobox", { name: /^关联数据源/ })
        ).toBeDisabled();
        await expect(
          dialog
            .getByRole("combobox", { name: /^关联数据源/ })
            .locator("option")
        ).toHaveCount(1);
        await expect(
          dialog.getByPlaceholder("字段名", { exact: true }).first()
        ).toHaveValue("order_id");
      }
      await page.screenshot({
        path: path.join(directory, `${spec.key}-read-failure.png`),
        animations: "disabled",
      });
      failReads = false;
      await dialog
        .getByRole("button", { name: "重新读取资源", exact: true })
        .click();
      await expect(
        dialog.locator("[data-resource-catalog-notice]")
      ).toHaveCount(0);
      await expect(save).toBeEnabled();
      report({
        stage: "resource-read-recovered",
        category: spec.key,
        sameInputRetained: true,
      });
      if (spec.key === "assets")
        await expect(
          dialog.getByRole("combobox", { name: /^关联数据源/ })
        ).toHaveValue(sourceId);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-resource-draft-summary]")).toContainText(
        "1 类资源"
      );
      await category(spec.key === "tags" ? "sources" : "tags");
      await category(spec.key);
      if (index === 0) {
        const leave = page.getByRole("alertdialog", {
          name: "离开前保留资源填写",
          exact: true,
        });
        for (const action of [
          page.getByRole("button", { name: /^权限配置中心/ }),
          page.getByRole("tab", { name: "流程仓库", exact: true }),
          page.getByRole("button", { name: "退出", exact: true }),
        ]) {
          await action.click();
          await expect(leave).toBeVisible();
          await leave
            .getByRole("button", { name: "继续编辑", exact: true })
            .click();
          await expect(action).toBeFocused();
          await expect(page.locator("[data-resource-center]")).toBeVisible();
        }
        const beforeUnload = page.waitForEvent("dialog"),
          cancelled = page.reload().catch(() => {});
        const native = await beforeUnload;
        assert.equal(native.type(), "beforeunload");
        await native.dismiss();
        await cancelled;
        await expect(page.locator("[data-resource-center]")).toBeVisible();
      }
      await page.getByRole("button", { name: spec.title, exact: true }).click();
      await expect(field).toHaveValue(name);
      await page.setViewportSize({ width: index % 2 ? 390 : 320, height: 844 });
      await expect(dialog).toHaveCSS("opacity", "1");
      const bounds = await dialog.boundingBox();
      assert(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= (index % 2 ? 391 : 321) &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 845
      );
      await expect(save).toBeInViewport();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      await page.screenshot({
        path: path.join(directory, `${spec.key}-mobile.png`),
        animations: "disabled",
      });
      failMutation = spec.method;
      await save.click();
      await expect(dialog.getByRole("alert")).toContainText("测试提交失败");
      await expect(visibleToasts).toHaveCount(0);
      await expect(field).toHaveValue(name);
      await expect(save).toBeEnabled();
      assert.equal(actualWrites.get(spec.method) ?? 0, 0);
      const saving = page.waitForResponse(
        response =>
          response.url().includes(spec.method) &&
          response.request().method() === "POST"
      );
      await save.click();
      assert.equal((await saving).status(), 200);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-resource-draft-summary]")).toHaveCount(
        0
      );
      const rows = (
        await owner("data.resources", { projectId: fixture.projectId })
      )[spec.key];
      assert.equal(rows.filter(row => row.name === name).length, 1);
      assert.equal(actualWrites.get(spec.method), 1);
      await page.setViewportSize({ width: 1440, height: 1000 });
      report({
        stage: "resource-draft",
        category: spec.key,
        readFailureRetainedSameInput: true,
        failedRetryRetained: true,
        cachedListsHidden: true,
        categorySwitchRetained: true,
        rejectedWriteRetained: true,
        actualSaveCount: 1,
      });
    }
    if (process.env.FLOW_UI_RESOURCE_DRAFT_REPRO !== "1") {
      await category("tags");
      await page.getByRole("button", { name: "新建标签", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "新建标签",
        exact: true,
      });
      await dialog
        .getByLabel("标签名称", { exact: true })
        .fill("放弃的标签_" + tag);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: /^权限配置中心/ }).click();
      const leave = page.getByRole("alertdialog", {
        name: "离开前保留资源填写",
        exact: true,
      });
      await leave
        .getByRole("button", { name: "放弃填写并离开", exact: true })
        .click();
      await expect(page.locator("[data-resource-center]")).toHaveCount(0);
      await page
        .getByRole("button", { name: "资源配置中心", exact: true })
        .click();
      await expect(page.locator("[data-resource-draft-summary]")).toHaveCount(
        0
      );
      assert.equal(rejectedWrites, 5);
      assert.deepEqual(errors, []);
      report({
        stage: "resource-draft-complete",
        categories: 5,
        actualOwnedCreates: 5,
        failedCreatesNeverForwarded: 5,
        localAndGlobalExitGuarded: true,
        nativeReloadGuarded: true,
        explicitDiscard: true,
        browserErrors: 0,
      });
    }
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
          animations: "disabled",
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
