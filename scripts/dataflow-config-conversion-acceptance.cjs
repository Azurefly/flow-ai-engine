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
    failed = false,
    view = 0;
  try {
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    const data = fixture.workflows.find(flow => flow.flowType === "data");
    let current = await owner("workflow.get", { id: data.id });
    assert.equal(current.ownerUserId, fixture.userId);
    const assetId = current.definition.nodes.find(node => node.id === "source")
      .config.assetId;
    const resources = await owner("data.resources", {
      projectId: fixture.projectId,
    });
    const asset = resources.assets.find(item => item.id === assetId);
    assert(asset);
    const lookup = await owner(
      "data.createAsset",
      {
        projectId: fixture.projectId,
        sourceId: asset.sourceId,
        name: "关联核对_" + tag,
        assetType: "dataset",
        schema: [
          { name: "id", type: "number" },
          { name: "label", type: "string" },
        ],
        sample: [
          { id: 1, label: "匹配订单" },
          { id: 3, label: "无订单" },
        ],
      },
      true
    );
    const node = (id, type, config, x, y = 80) => ({
      id,
      type,
      name: id,
      config,
      position: { x, y },
    });
    const legacy = {
      ...current.definition,
      nodes: [
        node("start", "start", {}, 0),
        node("orders", "source", { assetId, limit: 10 }, 220),
        node("lookup", "source", { assetId: lookup.id, limit: 10 }, 220, 260),
        node(
          "join",
          "join",
          {
            kind: "left",
            leftKeys: ["id"],
            rightKeys: ["id"],
            extension: "retained",
          },
          440
        ),
        node(
          "agg",
          "aggregate",
          {
            groupBy: [],
            metrics: [
              { as: "totalAmount", op: "sum", field: "amount", unit: "元" },
            ],
          },
          660
        ),
        node("output", "output", { outputName: "汇总输出" }, 880),
        node("end", "end", {}, 1100),
      ],
      edges: [
        ["start", "orders"],
        ["start", "lookup"],
        ["orders", "join"],
        ["lookup", "join"],
        ["join", "agg"],
        ["agg", "output"],
        ["output", "end"],
      ].map(([sourceNodeId, targetNodeId], i) => ({
        id: "conversion_" + i,
        sourceNodeId,
        targetNodeId,
      })),
    };
    await owner(
      "workflow.update",
      {
        id: data.id,
        definition: legacy,
        expectedDefinitionVersion: current.definitionVersion,
      },
      true
    );
    current = await owner("workflow.get", { id: data.id });
    const original = JSON.stringify(current.definition),
      originalVersion = Number(current.definitionVersion);
    const beforeCompile = await owner(
      "workflow.compile",
      { id: data.id },
      true
    );
    assert.equal(beforeCompile.ok, false);
    assert(
      beforeCompile.diagnostics.some(item => /聚合|关联/.test(item.message))
    );
    const conflictDefinition = structuredClone(legacy);
    conflictDefinition.nodes.find(
      node => node.id === "agg"
    ).config.metrics[0].name = "conflictingName";
    const conflictName = "转换冲突_" + tag;
    const conflict = await owner(
      "project.createWorkflow",
      {
        projectId: fixture.projectId,
        name: conflictName,
        flowType: "data",
        definition: conflictDefinition,
      },
      true
    );
    fixture.workflows.push({
      id: conflict.id,
      name: conflictName,
      flowType: "conversion-conflict",
    });
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture)
    );
    report({
      stage: "conversion-fixture",
      tag,
      originalVersion,
      legacyCompileRejected: true,
    });
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      acceptDownloads: true,
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
    const openEditor = async flow => {
      await page.goto(
        `${base}?conversionView=${++view}#/flows/workflow/${flow.id}/editor`
      );
      await page.locator("[data-workflow-editor]").waitFor();
      await expect(page.getByLabel("流程名称", { exact: true })).toHaveValue(
        flow.name
      );
    };
    const openCheck = async () => {
      await page.getByTitle("更多操作", { exact: true }).click();
      await page
        .getByRole("menuitem", { name: "检查存量数据配置", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "检查存量数据配置",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const unchanged = async () => {
      const saved = await owner("workflow.get", { id: data.id });
      assert.equal(JSON.stringify(saved.definition), original);
      assert.equal(Number(saved.definitionVersion), originalVersion);
    };
    const apply = async dialog => {
      await dialog.getByRole("checkbox").check();
      await dialog
        .getByRole("button", { name: "确认转换到当前填写", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "撤销本次转换", exact: true })
      ).toBeEnabled();
    };
    await openEditor(data);
    let dialog = await openCheck();
    await expect(
      dialog.getByText("2 个节点有转换建议", { exact: false })
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "确认转换到当前填写", exact: true })
    ).toBeDisabled();
    await expect(dialog.getByText(/计算方式.*求和/)).toBeVisible();
    for (const width of [320, 390, 1024, 1920]) {
      await page.setViewportSize({ width, height: 920 });
      const box = await dialog.boundingBox();
      assert(box && box.x >= -1 && box.x + box.width <= width + 1);
      assert(box.y >= -1 && box.y + box.height <= 921);
      assert(
        await dialog.evaluate(
          element => element.scrollWidth <= element.clientWidth + 1
        )
      );
      const button = dialog.getByRole("button", {
        name: "确认转换到当前填写",
        exact: true,
      });
      assert.equal(
        await button.evaluate(element => getComputedStyle(element).fontSize),
        "14px"
      );
      if ([390, 1920].includes(width))
        await page.screenshot({
          path: path.join(directory, `preview-${width}.png`),
          fullPage: false,
        });
    }
    const downloadPromise = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "导出检查结果", exact: true })
      .click();
    const download = await downloadPromise;
    await download.saveAs(path.join(directory, "conversion-check.json"));
    const exported = JSON.parse(
      fs.readFileSync(path.join(directory, "conversion-check.json"), "utf8")
    );
    assert.equal(exported.changesApplied, false);
    assert.equal(exported.changes.length, 2);
    assert.equal(exported.source, "current-editor-input");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await unchanged();
    dialog = await openCheck();
    await apply(dialog);
    await unchanged();
    await page
      .getByRole("button", { name: "撤销本次转换", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "撤销本次转换", exact: true })
    ).toHaveCount(0);
    dialog = await openCheck();
    await expect(
      dialog.getByText("2 个节点有转换建议", { exact: false })
    ).toBeVisible();
    await apply(dialog);
    // A later edit must not be overwritten by the conversion's quick undo.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.react-flow__node[data-id="agg"]').dblclick();
    const nodeName = page.getByLabel("节点名称", { exact: true });
    await nodeName.fill("汇总核对");
    await expect(
      page.getByRole("button", { name: "撤销本次转换", exact: true })
    ).toBeDisabled();
    await unchanged();
    await page.getByRole("button", { name: /保存画布/ }).click();
    const saved = await poll(
      "converted draft saved",
      () => owner("workflow.get", { id: data.id }),
      value =>
        value.definition.nodes.find(node => node.id === "agg").config.metrics[0]
          .name === "totalAmount"
    );
    const aggregate = saved.definition.nodes.find(node => node.id === "agg");
    assert.deepEqual(aggregate.config.metrics, [
      { name: "totalAmount", operation: "sum", field: "amount", unit: "元" },
    ]);
    assert.equal(aggregate.name, "汇总核对");
    const join = saved.definition.nodes.find(node => node.id === "join");
    assert.equal(join.config.leftInputNodeId, "orders");
    assert.equal(join.config.rightInputNodeId, "lookup");
    assert.equal(join.config.extension, "retained");
    assert.equal(
      (await owner("workflow.compile", { id: data.id }, true)).ok,
      true
    );
    await openEditor(data);
    dialog = await openCheck();
    await expect(
      dialog.getByText("未发现可转换", { exact: false })
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "确认转换到当前填写", exact: true })
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await openEditor({ ...conflict, name: conflictName });
    dialog = await openCheck();
    await expect(dialog.getByText(/as 与 name 不一致/)).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "确认转换到当前填写", exact: true })
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    report({
      stage: "conversion-ui",
      previewWidths: [320, 390, 1024, 1920],
      cancelledWithoutWrite: true,
      appliedOnlyToDraft: true,
      undo: true,
      laterEditProtected: true,
      conflictsBlocked: true,
    });
    // Reuse the scoped reviewer/publisher helper; it never writes global policy.
    await remote({ action: "prepare_native_schedule", fixture, login });
    const started = await owner(
      "data.run",
      { projectId: fixture.projectId, workflowId: data.id },
      true
    );
    const result = await poll(
      "converted dataflow run",
      () =>
        owner("data.runDetail", {
          projectId: fixture.projectId,
          runId: started.runId,
        }),
      value => value && ["success", "failed"].includes(value.status)
    );
    assert.equal(result.status, "success", JSON.stringify(result.error));
    assert.deepEqual(result.output.terminals[0].rows, [{ totalAmount: 200 }]);
    const published = await owner("workflow.get", { id: data.id });
    assert.equal(published.status, "published");
    assert.equal(result.definitionVersion, Number(published.definitionVersion));
    assert.equal(result.executionSource, "published");
    report({
      stage: "conversion-runtime",
      runSucceeded: true,
      totalAmount: 200,
      countNotSubstituted: true,
      leftBindingPreserved: true,
    });
    await viewer("auth.login", memberLogin, true);
    const denied = await viewer("workflow.get", { id: data.id });
    assert.equal(denied.id, data.id);
    await assert.rejects(
      viewer(
        "workflow.update",
        {
          id: data.id,
          definition: denied.definition,
          expectedDefinitionVersion: denied.definitionVersion,
        },
        true
      )
    );
    const readerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await readerContext.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    const readerPage = await readerContext.newPage();
    readerPage.setDefaultTimeout(20000);
    await readerPage.goto(base);
    await readerPage
      .getByLabel("用户名", { exact: true })
      .fill(memberLogin.username);
    await readerPage
      .getByLabel("密码", { exact: true })
      .fill(memberLogin.password);
    await readerPage
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await readerPage
      .locator('input[type="password"]')
      .waitFor({ state: "hidden" });
    await readerPage.goto(`${base}#/flows/workflow/${data.id}/editor`);
    await readerPage.locator("[data-workflow-editor]").waitFor();
    await readerPage.getByTitle("更多操作", { exact: true }).click();
    await readerPage
      .getByRole("menuitem", { name: "检查存量数据配置", exact: true })
      .click();
    const readonlyDialog = readerPage.getByRole("dialog", {
      name: "检查存量数据配置",
      exact: true,
    });
    await expect(readonlyDialog).toBeVisible();
    await expect(readonlyDialog.getByRole("checkbox")).toBeDisabled();
    await expect(
      readonlyDialog.getByRole("button", {
        name: "确认转换到当前填写",
        exact: true,
      })
    ).toBeDisabled();
    await readerContext.close();
    // A failed lazy chunk is contained locally; the editor and its unsaved values remain mounted.
    const faultContext = await browser.newContext({
      storageState: await context.storageState(),
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
    });
    await faultContext.route("**/*", route =>
      route.request().url().startsWith(base) &&
      !/\/DataflowConfigConversionDialog-[^/]+\.js/.test(route.request().url())
        ? route.continue()
        : route.abort()
    );
    const faultPage = await faultContext.newPage();
    faultPage.setDefaultTimeout(20000);
    await faultPage.goto(`${base}#/flows/workflow/${conflict.id}/editor`);
    await faultPage.locator("[data-workflow-editor]").waitFor();
    await faultPage.locator('.react-flow__node[data-id="agg"]').dblclick();
    await faultPage
      .getByLabel("节点名称", { exact: true })
      .fill("未保存的窗口故障核对");
    await faultPage.getByTitle("更多操作", { exact: true }).click();
    await faultPage
      .getByRole("menuitem", { name: "检查存量数据配置", exact: true })
      .click();
    const faultDialog = faultPage.getByRole("dialog", {
      name: "配置检查未能加载",
      exact: true,
    });
    await expect(faultDialog).toBeVisible();
    await faultDialog
      .getByRole("button", { name: "关闭检查", exact: true })
      .click();
    await expect(faultPage.locator("[data-workflow-editor]")).toBeVisible();
    await expect(faultPage.getByLabel("节点名称", { exact: true })).toHaveValue(
      "未保存的窗口故障核对"
    );
    const conflictUnchanged = await owner("workflow.get", { id: conflict.id });
    assert.equal(
      conflictUnchanged.definition.nodes.find(node => node.id === "agg").name,
      "agg"
    );
    await faultContext.close();
    report({
      stage: "conversion-boundaries",
      readonlyCannotApply: true,
      unauthorizedWriteRejected: true,
      failedChunkRetainsUnsavedInput: true,
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    report({ stage: "conversion-complete", tag, pageErrors: 0 });
  } catch (error) {
    failed = true;
    const secrets = [login.password, memberLogin.password];
    console.error(
      secrets.reduce(
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
      console.error("Cleanup/fingerprint failed: " + error.message);
    }
    process.exitCode = failed ? 1 : 0;
  }
})();
