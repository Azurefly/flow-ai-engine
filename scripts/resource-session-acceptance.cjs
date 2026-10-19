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
    failed = false,
    releaseHeld;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    const original = await owner("data.resources", {
      projectId: fixture.projectId,
    });
    const sourceId = original.sources[0].id;
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
    const signIn = async (credentials, navigate = true) => {
      if (navigate) await page.goto(base);
      await page
        .getByLabel("用户名", { exact: true })
        .fill(credentials.username);
      await page.getByLabel("密码", { exact: true }).fill(credentials.password);
      await page
        .getByRole("button", { name: "登录流程引擎", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "业务中心", exact: true })
      ).toBeVisible();
    };
    const enterResources = async () => {
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
    };
    await signIn(login);
    await enterResources();
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
    ].map(spec => ({ ...spec, name: "会话恢复_" + spec.key + "_" + tag }));
    const category = async value => {
      const mobile = page.locator("[data-resource-category-select]");
      if (await mobile.isVisible()) await mobile.selectOption(value);
      else {
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
    const dialogFor = spec =>
      page.getByRole("dialog", { name: spec.title, exact: true });
    const openForm = async spec => {
      await category(spec.key);
      await page.getByRole("button", { name: spec.title, exact: true }).click();
      return dialogFor(spec);
    };
    const reproduce = process.env.FLOW_UI_RESOURCE_SESSION_REPRO === "1";
    for (const spec of reproduce ? specs.slice(0, 1) : specs) {
      const dialog = await openForm(spec);
      await dialog.getByLabel(spec.label, { exact: true }).fill(spec.name);
      if (spec.key === "sources")
        await dialog
          .getByLabel("连接说明", { exact: true })
          .fill("整批网络中断前的完整连接说明");
      if (spec.key === "assets") {
        await dialog
          .getByRole("combobox", { name: "关联数据源", exact: true })
          .selectOption(sourceId);
        await dialog
          .getByLabel("字段结构第 1 行字段名", { exact: true })
          .fill("order_id");
        await dialog
          .getByRole("button", { name: "+ 添加一行", exact: true })
          .nth(1)
          .click();
        await dialog
          .getByLabel("一行样本第 1 行字段名", { exact: true })
          .fill("order_id");
        await dialog
          .getByLabel("一行样本第 1 行样本值", { exact: true })
          .fill("draft-order-7");
      }
      if (spec.key === "plugins")
        await dialog.getByLabel("版本", { exact: true }).fill("1.2.3");
      if (!reproduce && spec.key !== "plugins")
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
    }
    let failReads = true,
      failedBatches = 0,
      holding = false,
      heldSeen,
      holdResponse;
    const actualWrites = new Map();
    await page.route("**/api/trpc/**", async route => {
      const request = route.request();
      const names = decodeURIComponent(
        new URL(request.url()).pathname.split("/api/trpc/")[1]
      ).split(",");
      const method = names.find(name =>
        /^data\.create(Source|Asset|Udf|Tag|Plugin)$/.test(name)
      );
      if (request.method() === "POST" && method) {
        assert.equal(names.length, 1);
        const raw = request.postDataJSON(),
          input = raw.json ?? raw["0"]?.json;
        assert.equal(input.projectId, fixture.projectId);
        actualWrites.set(method, (actualWrites.get(method) ?? 0) + 1);
        if (method === "data.createPlugin" && holding) {
          // Commit on the real server before delaying only the browser's acknowledgement.
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          heldSeen();
          await holdResponse;
          await route.fulfill({ response });
          return;
        }
      }
      if (
        failReads &&
        request.method() === "GET" &&
        names.some(name =>
          ["project.get", "project.access", "data.resources"].includes(name)
        )
      ) {
        failedBatches++;
        await route.abort("failed");
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
    const retry = page.getByRole("button", {
      name: "重试读取业务",
      exact: true,
    });
    await focusRefresh();
    await expect(retry).toBeVisible();
    await expect(page.locator("[data-resource-center]")).toHaveCount(0);
    if (reproduce) {
      failReads = false;
      await retry.click();
      await page
        .getByRole("button", { name: "资源配置中心", exact: true })
        .click();
      const dialog = await openForm(specs[0]);
      await expect(
        dialog.getByLabel(specs[0].label, { exact: true })
      ).toHaveValue("");
      report({
        stage: "resource-session-reproduction",
        batchAbortLostDraft: true,
        failedBatches,
      });
      return;
    }
    const recovery = page.locator("[data-resource-draft-recovery]");
    await expect(recovery).toContainText("5 类资源");
    assert.equal(actualWrites.size, 0);
    await expect(
      page.getByText(original.sources[0].name, { exact: true })
    ).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await recovery
      .getByRole("button", { name: "导出资源填写", exact: true })
      .click();
    const download = await downloading,
      exportedFile = path.join(directory, "session-drafts.json");
    await download.saveAs(exportedFile);
    const exported = JSON.parse(fs.readFileSync(exportedFile, "utf8"));
    assert.equal(new Set(exported.drafts.map(draft => draft.category)).size, 5);
    assert(
      exported.drafts.every(draft => draft.projectId === fixture.projectId)
    );
    assert(
      exported.drafts.every(
        draft =>
          !["open", "submitError", "view", "category"].includes(draft.field)
      )
    );
    assert(!JSON.stringify(exported).includes(original.sources[0].name));
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      await expect(
        recovery.getByRole("button", { name: "导出资源填写", exact: true })
      ).toBeInViewport();
      await page.screenshot({
        path: path.join(directory, `recovery-${width}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const leave = page.getByRole("alertdialog", {
      name: "离开前保留资源填写",
      exact: true,
    });
    for (const action of [
      page.getByRole("tab", { name: "流程仓库", exact: true }),
      page.getByRole("button", { name: "退出", exact: true }),
    ]) {
      await action.click();
      await expect(leave).toBeVisible();
      await leave
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(action).toBeFocused();
      await expect(recovery).toContainText("5 类资源");
    }
    const nativeEvent = page.waitForEvent("dialog"),
      cancelled = page.reload().catch(() => {});
    const native = await nativeEvent;
    assert.equal(native.type(), "beforeunload");
    await native.dismiss();
    await cancelled;
    const beforeFailedRetry = failedBatches;
    await retry.click();
    await expect.poll(() => failedBatches).toBeGreaterThan(beforeFailedRetry);
    await expect(recovery).toContainText("5 类资源");
    failReads = false;
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(dialogFor(specs[4])).toBeVisible();
    await expect(
      dialogFor(specs[4]).getByLabel("插件名称", { exact: true })
    ).toHaveValue(specs[4].name);
    await expect(
      dialogFor(specs[4]).getByLabel("版本", { exact: true })
    ).toHaveValue("1.2.3");
    await dialogFor(specs[4])
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(page.locator("[data-resource-draft-summary]")).toContainText(
      "5 类资源"
    );
    report({
      stage: "resource-session-recovered",
      categoriesRetained: 5,
      localExportOnly: true,
      failedRetryRetained: true,
      hiddenCachedMetadata: true,
      exitAndReloadGuardedWhileUnmounted: true,
    });
    for (const [index, spec] of specs.slice(0, 4).entries()) {
      const dialog = await openForm(spec);
      await expect(dialog.getByLabel(spec.label, { exact: true })).toHaveValue(
        spec.name
      );
      if (spec.key === "sources")
        await expect(
          dialog.getByLabel("连接说明", { exact: true })
        ).toHaveValue("整批网络中断前的完整连接说明");
      if (spec.key === "assets") {
        await expect(
          dialog.getByRole("combobox", { name: "关联数据源", exact: true })
        ).toHaveValue(sourceId);
        await expect(
          dialog.getByLabel("字段结构第 1 行字段名", { exact: true })
        ).toHaveValue("order_id");
        await expect(
          dialog.getByLabel("一行样本第 1 行样本值", { exact: true })
        ).toHaveValue("draft-order-7");
      }
      const response = page.waitForResponse(
        response =>
          response.url().includes(spec.method) &&
          response.request().method() === "POST"
      );
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      assert.equal((await response).status(), 200);
      await expect(dialog).toHaveCount(0);
      await expect(page.locator("[data-resource-draft-summary]")).toContainText(
        `${4 - index} 类资源`
      );
      assert.equal(
        (await owner("data.resources", { projectId: fixture.projectId }))[
          spec.key
        ].filter(row => row.name === spec.name).length,
        1
      );
      assert.equal(actualWrites.get(spec.method), 1);
    }
    const spec = specs[4],
      dialog = await openForm(spec);
    holding = true;
    holdResponse = new Promise(resolve => {
      releaseHeld = resolve;
    });
    const committed = new Promise(resolve => {
      heldSeen = resolve;
    });
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await Promise.race([
      committed,
      sleep(15000).then(() => {
        throw new Error("Server acknowledgement not observed");
      }),
    ]);
    assert.equal(
      (
        await owner("data.resources", { projectId: fixture.projectId })
      ).plugins.filter(row => row.name === spec.name).length,
      1
    );
    failReads = true;
    await focusRefresh();
    await expect(retry).toBeVisible();
    await expect(page.locator("[data-resource-center]")).toHaveCount(0);
    await page.getByRole("tab", { name: "流程仓库", exact: true }).click();
    await expect(leave).toHaveCount(0);
    await expect(retry).toBeVisible();
    failReads = false;
    await retry.click();
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "保存", exact: true })
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "关闭", exact: true })
    ).toBeDisabled();
    await expect(dialog.getByLabel("插件名称", { exact: true })).toBeDisabled();
    releaseHeld();
    holding = false;
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-resource-draft-summary]")).toHaveCount(0);
    assert.equal(actualWrites.get(spec.method), 1);
    assert.equal(
      (
        await owner("data.resources", { projectId: fixture.projectId })
      ).plugins.filter(row => row.name === spec.name).length,
      1
    );
    report({
      stage: "resource-session-acknowledgement",
      committedBeforePageUnmount: true,
      pendingLockRetainedAcrossRemount: true,
      acknowledgedDraftCleared: true,
      actualCreateCount: 1,
    });
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await owner(
      "project.grantMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        role: "designer",
      },
      true
    );
    const sourceDialog = await openForm(specs[0]);
    const accountOnlyName = "仅原账号填写_" + tag;
    await sourceDialog
      .getByLabel("数据源名称", { exact: true })
      .fill(accountOnlyName);
    await sourceDialog
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await leave
      .getByRole("button", { name: "放弃填写并离开", exact: true })
      .click();
    await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
    await signIn(memberLogin, false);
    await enterResources();
    const fresh = await openForm(specs[0]);
    await expect(fresh.getByLabel("数据源名称", { exact: true })).toHaveValue(
      ""
    );
    await expect(page.locator("[data-resource-draft-summary]")).toHaveCount(0);
    await expect(page.getByText(accountOnlyName, { exact: true })).toHaveCount(
      0
    );
    assert.deepEqual(errors, []);
    report({
      stage: "resource-session-complete",
      allFiveSavedOnce: true,
      accountSwitchIsolated: true,
      browserErrors: 0,
    });
  } catch (error) {
    failed = true;
    if (page) {
      const boundary = await page
        .locator('main[role="alert"] details p')
        .allTextContents()
        .catch(() => []);
      if (boundary.length)
        report({
          stage: "render-boundary",
          messages: boundary.map(text => text.slice(0, 1200)),
        });
    }
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
    releaseHeld?.();
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
