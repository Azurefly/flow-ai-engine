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
  const persist = () =>
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture)
    );
  try {
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    const flow = fixture.workflows.find(item => item.flowType === "data");
    let current = await owner("workflow.get", { id: flow.id });
    assert.equal(current.ownerUserId, fixture.userId);
    const original = structuredClone(current.definition);
    const originalAssetId = original.nodes.find(node => node.id === "source")
      .config.assetId;
    const catalog = await owner("data.resources", {
      projectId: fixture.projectId,
    });
    const originalAsset = catalog.assets.find(
      asset => asset.id === originalAssetId
    );
    assert(originalAsset?.sourceId);
    const schema = [
      { name: "id", type: "number" },
      { name: "amount", type: "number" },
      { name: "status", type: "string" },
    ];
    const unavailable = [];
    for (const sourceType of ["api", "file", "jdbc"]) {
      const source = await owner(
        "data.createSource",
        {
          projectId: fixture.projectId,
          name: sourceType + "能力_" + tag,
          sourceType,
          connection: {
            description: "仅验证能力边界，不发起外部连接",
            endpoint:
              sourceType === "jdbc"
                ? "postgres://unreachable.invalid/demo"
                : base + "readyz",
          },
        },
        true
      );
      const asset = await owner(
        "data.createAsset",
        {
          projectId: fixture.projectId,
          sourceId: source.id,
          name: sourceType + "仅登记_" + tag,
          assetType: "dataset",
          schema,
          sample: [{ id: 1, amount: 999, status: "paid" }],
        },
        true
      );
      unavailable.push({ sourceType, sourceId: source.id, assetId: asset.id });
    }
    const crossSpec = {
      code: tag.toUpperCase() + "_CROSS",
      name: "能力跨业务_" + tag,
    };
    fixture.pendingProjects ??= [];
    fixture.pendingProjects.push(crossSpec);
    persist();
    const cross = await owner("project.create", crossSpec, true);
    fixture.projects.push({ id: cross.id, ...crossSpec });
    persist();
    const foreign = await owner(
      "data.createAsset",
      {
        projectId: cross.id,
        name: "跨业务样本_" + tag,
        assetType: "dataset",
        schema,
        sample: [{ id: 1, amount: 1234, status: "paid" }],
      },
      true
    );
    unavailable.push({ sourceType: "foreign-project", assetId: foreign.id });
    const runs = () =>
      owner("data.runs", {
        projectId: fixture.projectId,
        workflowId: flow.id,
        limit: 200,
      });
    const snapshot = async () => {
      const row = await owner("workflow.get", { id: flow.id });
      return {
        status: row.status,
        version: Number(row.definitionVersion),
        definition: JSON.stringify(row.definition),
        auditStatus: row.auditStatus,
      };
    };
    const publishRejected = async () => {
      await remote({
        action: "prepare_native_schedule",
        fixture,
        login,
        reviewOnly: true,
      });
      const before = await snapshot();
      await assert.rejects(
        owner(
          "workflow.publish",
          { id: flow.id, expectedDefinitionVersion: before.version },
          true
        ),
        error => error.status === 400
      );
      assert.deepEqual(
        await snapshot(),
        before,
        "被拒绝的发布不能修改定义、版本或审核状态"
      );
    };
    for (const item of unavailable) {
      current = await owner("workflow.get", { id: flow.id });
      const definition = structuredClone(original);
      definition.nodes.find(node => node.id === "source").config.assetId =
        item.assetId;
      await owner(
        "workflow.update",
        {
          id: flow.id,
          definition,
          expectedDefinitionVersion: current.definitionVersion,
        },
        true
      );
      const check = await owner("workflow.compile", { id: flow.id }, true);
      assert.equal(check.ok, false);
      assert(
        check.diagnostics.some(
          diagnostic =>
            diagnostic.code === "DATAFLOW_RESOURCE_UNAVAILABLE" &&
            diagnostic.location.nodeId === "source" &&
            diagnostic.location.field === "assetId"
        )
      );
      await publishRejected();
      const count = (await runs()).length;
      await assert.rejects(
        owner(
          "data.run",
          { projectId: fixture.projectId, workflowId: flow.id, mode: "test" },
          true
        ),
        error => error.status === 400
      );
      assert.equal(
        (await runs()).length,
        count,
        "准入拒绝不创建运行记录或读取999/1234样本"
      );
    }
    report({
      stage: "capability-rejections",
      tag,
      unsupportedAndForeignAssets: unavailable.length,
      publishRolledBack: true,
      rejectedBeforeRunCreation: true,
    });
    current = await owner("workflow.get", { id: flow.id });
    await owner(
      "workflow.update",
      {
        id: flow.id,
        definition: original,
        expectedDefinitionVersion: current.definitionVersion,
      },
      true
    );
    assert.equal(
      (await owner("workflow.compile", { id: flow.id }, true)).ok,
      true
    );
    // Metadata changes after a successful preflight must still block publication.
    await owner(
      "data.updateSource",
      {
        projectId: fixture.projectId,
        sourceId: originalAsset.sourceId,
        status: "disabled",
      },
      true
    );
    await publishRejected();
    await assert.rejects(
      owner(
        "data.testSource",
        { projectId: fixture.projectId, sourceId: originalAsset.sourceId },
        true
      ),
      error => error.status === 400
    );
    assert.equal(
      (
        await owner("data.resources", { projectId: fixture.projectId })
      ).sources.find(source => source.id === originalAsset.sourceId).status,
      "disabled"
    );
    await owner(
      "data.updateSource",
      {
        projectId: fixture.projectId,
        sourceId: originalAsset.sourceId,
        status: "draft",
      },
      true
    );
    await remote({ action: "prepare_native_schedule", fixture, login });
    current = await owner("workflow.get", { id: flow.id });
    const publishedVersion = Number(current.definitionVersion);
    await owner(
      "data.updateSource",
      {
        projectId: fixture.projectId,
        sourceId: originalAsset.sourceId,
        status: "disabled",
      },
      true
    );
    const count = (await runs()).length;
    await assert.rejects(
      owner(
        "data.run",
        { projectId: fixture.projectId, workflowId: flow.id },
        true
      ),
      error => error.status === 400
    );
    assert.equal((await runs()).length, count);
    const beforeRestore = await snapshot();
    await assert.rejects(
      owner(
        "workflow.rollbackVersion",
        {
          workflowId: flow.id,
          targetVersion: publishedVersion,
          expectedDefinitionVersion: beforeRestore.version,
        },
        true
      ),
      error => error.status === 400
    );
    assert.deepEqual(await snapshot(), beforeRestore);
    // Restoring a repairable draft remains possible even when resources are unavailable.
    await owner(
      "workflow.rollbackVersion",
      {
        workflowId: flow.id,
        targetVersion: publishedVersion,
        expectedDefinitionVersion: beforeRestore.version,
        restoreAsDraft: true,
      },
      true
    );
    assert.equal((await snapshot()).status, "draft");
    report({
      stage: "capability-lifecycle",
      preflightThenDisableBlocksPublish: true,
      disabledInlineCannotRun: true,
      disabledTestRejected: true,
      publishedRestoreBlocked: true,
      draftRestoreAllowed: true,
    });
    const ready = await owner(
      "data.createAsset",
      {
        projectId: fixture.projectId,
        name: "可读取样本_" + tag,
        assetType: "dataset",
        schema,
        sample: [{ id: 1, amount: 700, status: "paid" }],
      },
      true
    );
    const options = await owner("data.resourceOptions", {
      projectId: fixture.projectId,
    });
    for (const item of unavailable.filter(
      item => item.sourceType !== "foreign-project"
    )) {
      assert.equal(
        options.assets.find(option => option.value === item.assetId).disabled,
        true
      );
    }
    assert.equal(
      options.assets.find(option => option.value === originalAssetId).disabled,
      true
    );
    assert.equal(
      options.assets.find(option => option.value === ready.id).disabled,
      false
    );
    assert(
      !JSON.stringify(options).includes("postgres://"),
      "选项不能携带连接地址"
    );
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
    await page.goto(`${base}#/flows/workflow/${flow.id}/editor`);
    await page.locator("[data-workflow-editor]").waitFor();
    await page.locator('.react-flow__node[data-id="source"]').click();
    const panel = page.locator("[data-workflow-inspector]");
    await panel.waitFor();
    const configTab = panel.getByRole("tab", { name: "节点配置", exact: true });
    if (await configTab.count()) await configTab.click();
    const resourceSelect = panel.getByRole("combobox", { name: /资源/ });
    await expect(resourceSelect).toHaveValue(originalAssetId);
    await expect(
      resourceSelect.locator(`option[value="${originalAssetId}"]`)
    ).toBeDisabled();
    await expect(
      panel.getByRole("alert").filter({ hasText: "停用" })
    ).toBeVisible();
    for (const item of unavailable.filter(
      item => item.sourceType !== "foreign-project"
    ))
      await expect(
        resourceSelect.locator(`option[value="${item.assetId}"]`)
      ).toBeDisabled();
    await resourceSelect.selectOption(ready.id);
    await expect(resourceSelect).not.toHaveAttribute("aria-invalid", "true");
    assert.equal(
      (await owner("workflow.get", { id: flow.id })).definition.nodes.find(
        node => node.id === "source"
      ).config.assetId,
      originalAssetId
    );
    await page.getByRole("button", { name: /保存画布/ }).click();
    await poll(
      "readable source saved",
      () => owner("workflow.get", { id: flow.id }),
      row =>
        row.definition.nodes.find(node => node.id === "source").config
          .assetId === ready.id
    );
    assert.equal(
      (await owner("workflow.compile", { id: flow.id }, true)).ok,
      true
    );
    await remote({ action: "prepare_native_schedule", fixture, login });
    const started = await owner(
      "data.run",
      { projectId: fixture.projectId, workflowId: flow.id },
      true
    );
    const result = await poll(
      "readable replacement runs",
      () =>
        owner("data.runDetail", {
          projectId: fixture.projectId,
          runId: started.runId,
        }),
      row => row && ["success", "failed"].includes(row.status)
    );
    assert.equal(result.status, "success", JSON.stringify(result.error));
    assert.deepEqual(result.output.terminals[0].rows, [
      { id: 1, amount: 700, status: "paid" },
    ]);
    report({
      stage: "capability-recovery",
      disabledSelectionPreserved: true,
      unsupportedOptionsDisabled: true,
      selectedNewReadableAsset: true,
      savedAndPublished: true,
      outputAmount: 700,
    });
    await viewer("auth.login", memberLogin, true);
    const readonlyOptions = await viewer("data.resourceOptions", {
      projectId: fixture.projectId,
    });
    assert.equal(
      readonlyOptions.assets.find(option => option.value === ready.id).disabled,
      false
    );
    await assert.rejects(
      viewer("data.resourceOptions", { projectId: cross.id }),
      error => error.status === 403
    );
    await page.goto(`${base}#/flows/project/${fixture.projectId}`);
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await page.locator("[data-resource-center]").waitFor();
    await page
      .locator("[data-resource-category-desktop]")
      .getByRole("button", { name: /^数据源/ })
      .click();
    await page.getByRole("button", { name: "添加数据源", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "添加数据源",
      exact: true,
    });
    await dialog
      .getByLabel("数据源名称", { exact: true })
      .fill("页面文件登记_" + tag);
    await dialog
      .getByLabel("连接说明", { exact: true })
      .fill("能力说明与受控登记验证");
    for (const type of ["api", "jdbc", "file"]) {
      await dialog.getByLabel("数据源类型", { exact: true }).selectOption(type);
      await expect(dialog.getByRole("note")).toContainText(
        type === "api"
          ? "尚不支持"
          : type === "jdbc"
            ? "mysql://"
            : "未提供文件上传"
      );
    }
    for (const width of [320, 390, 1024, 1920]) {
      await page.setViewportSize({ width, height: 920 });
      const box = await dialog.boundingBox();
      assert(box && box.x >= -1 && box.x + box.width <= width + 1);
      assert(
        await dialog.evaluate(
          element => element.scrollWidth <= element.clientWidth + 1
        )
      );
      if ([390, 1920].includes(width))
        await page.screenshot({
          path: path.join(directory, `source-capability-${width}.png`),
          fullPage: false,
        });
    }
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog).toBeHidden();
    const savedCatalog = await poll(
      "file metadata registered",
      () => owner("data.resources", { projectId: fixture.projectId }),
      value =>
        value.sources.some(source => source.name === "页面文件登记_" + tag)
    );
    assert.equal(
      savedCatalog.sources.find(source => source.name === "页面文件登记_" + tag)
        .sourceType,
      "file"
    );
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "页面文件登记_" + tag })
        .getByRole("button", { name: "暂不支持测试", exact: true })
    ).toBeDisabled();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 920 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
    }
    assert.equal(errors.length, 0, errors.join("\n"));
    report({
      stage: "capability-complete",
      tag,
      fileRegistrationRetained: true,
      unsupportedProbeDisabled: true,
      widths: [320, 390, 1024, 1920],
      pageErrors: 0,
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
