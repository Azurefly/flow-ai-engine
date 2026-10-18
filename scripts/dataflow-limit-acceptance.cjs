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
    failed = false,
    view = 0;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    assert(fixture?.projectId && fixture.workflows.length === 3);
    report({ stage: "optional-number-fixture", tag });
    await remote({ action: "prepare_optional_numbers", fixture, login });
    await owner("auth.login", login, true);
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
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    const openNode = async (flow, nodeId) => {
      await page.goto(
        `${base}?optionalView=${++view}#/flows/workflow/${flow.id}/editor`
      );
      await page.locator("[data-workflow-editor]").waitFor();
      await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
      const panel = page.locator("[data-workflow-inspector]");
      await panel.waitFor();
      const tab = panel.getByRole("tab", { name: "节点配置", exact: true });
      if (await tab.count()) await tab.click();
      if (nodeId === "optional_llm") {
        await panel
          .getByRole("tab", { name: "输出与失败处理", exact: true })
          .click();
      }
      return panel;
    };
    const saveValue = async (flow, input, nodeId, key, value) => {
      await input.fill(String(value));
      await expect(
        page.getByRole("button", { name: /保存画布/ })
      ).toBeEnabled();
      await input.focus();
      await page.keyboard.press("Control+s");
      await poll(
        "optional numeric value saved",
        () => owner("workflow.get", { id: flow.id }),
        row =>
          row.definition.nodes.find(n => n.id === nodeId).config[key] === value
      );
    };
    const data = fixture.workflows.find(item => item.flowType === "data");
    const publishAndRun = async expectedCount => {
      await remote({ action: "prepare_native_schedule", fixture, login });
      const started = await owner(
        "data.run",
        { projectId: fixture.projectId, workflowId: data.id },
        true
      );
      const result = await poll(
        "dataflow complete",
        () =>
          owner("data.runDetail", {
            projectId: fixture.projectId,
            runId: started.runId,
          }),
        row => row && ["success", "failed"].includes(row.status)
      );
      assert.equal(result.status, "success", JSON.stringify(result.error));
      const rows = result.output.terminals[0].rows;
      assert.equal(rows.length, expectedCount);
      if (expectedCount === 400) {
        for (let id = 1; id <= 200; id++)
          assert.equal(rows.filter(row => row.id === id).length, 2);
      }
      return rows;
    };
    let panel = await openNode(data, "optional_map");
    let limit = panel.getByRole("spinbutton", {
      name: "最大行数",
      exact: true,
    });
    await expect(limit).toHaveValue("2");
    await saveValue(data, limit, "optional_map", "limit", "");
    assert.equal(await limit.getAttribute("aria-invalid"), null);
    const reproduce = process.env.FLOW_UI_LIMIT_REPRO === "1";
    await publishAndRun(reproduce ? 0 : 400);
    report({
      stage: reproduce
        ? "optional-limit-reproduction"
        : "optional-limit-cleared",
      mergedInputRows: 400,
      outputRows: reproduce ? 0 : 400,
      bugConfirmed: reproduce,
    });
    if (!reproduce) {
      for (const value of [2, null, undefined, 200]) {
        let current = await owner("workflow.get", { id: data.id });
        if (current.status === "published")
          await owner(
            "workflow.unpublish",
            {
              id: data.id,
              expectedDefinitionVersion: current.definitionVersion,
            },
            true
          );
        current = await owner("workflow.get", { id: data.id });
        const definition = structuredClone(current.definition);
        const config = definition.nodes.find(
          node => node.id === "optional_map"
        ).config;
        if (value === undefined) delete config.limit;
        else config.limit = value;
        await owner(
          "workflow.update",
          {
            id: data.id,
            definition,
            expectedDefinitionVersion: current.definitionVersion,
          },
          true
        );
        panel = await openNode(data, "optional_map");
        limit = panel.getByRole("spinbutton", {
          name: "最大行数",
          exact: true,
        });
        await expect(limit).toHaveValue(
          value === undefined ? "200" : value === null ? "" : String(value)
        );
        await expect(limit).toHaveAttribute(
          "placeholder",
          "留空保留全部输入行"
        );
        const expected =
          value === undefined ? 200 : value === null ? 400 : value;
        await publishAndRun(expected);
        report({
          stage: "optional-limit-runtime",
          configured: value === undefined ? "absent" : value,
          outputRows: expected,
          displayMatchesRuntime: true,
        });
      }
      for (const type of ["transform", "project"]) {
        let current = await owner("workflow.get", { id: data.id });
        await owner(
          "workflow.unpublish",
          { id: data.id, expectedDefinitionVersion: current.definitionVersion },
          true
        );
        current = await owner("workflow.get", { id: data.id });
        const definition = structuredClone(current.definition);
        const node = definition.nodes.find(node => node.id === "optional_map");
        node.type = type;
        node.config =
          type === "transform"
            ? {
                mappings: {
                  id: "{{input.id}}",
                  amount: "{{input.amount}}",
                  status: "{{input.status}}",
                },
                limit: "",
              }
            : { fields: [{ source: "id", target: "id" }], limit: "" };
        await owner(
          "workflow.update",
          {
            id: data.id,
            definition,
            expectedDefinitionVersion: current.definitionVersion,
          },
          true
        );
        await publishAndRun(400);
        report({ stage: "optional-limit-legacy-node", type, outputRows: 400 });
      }
      for (const flow of fixture.workflows.filter(
        item => item.flowType !== "data"
      )) {
        panel = await openNode(flow, "optional_llm");
        const tokens = panel.getByRole("spinbutton", {
          name: "最大输出令牌",
          exact: true,
        });
        const timeout = panel.getByRole("spinbutton", {
          name: "超时（毫秒）",
          exact: true,
        });
        await expect(tokens).toHaveValue("1024");
        await expect(tokens).toHaveAttribute(
          "placeholder",
          "留空使用模型服务默认值"
        );
        await expect(timeout).toHaveValue("30000");
        await expect(timeout).toHaveAttribute(
          "placeholder",
          "留空使用 30000 毫秒"
        );
        await saveValue(flow, tokens, "optional_llm", "maxTokens", 512);
        await saveValue(flow, tokens, "optional_llm", "maxTokens", "");
        await saveValue(flow, timeout, "optional_llm", "timeoutMs", "");
        await openNode(flow, "optional_llm");
        await expect(tokens).toHaveValue("");
        await expect(timeout).toHaveValue("");
        report({
          stage: "optional-model-fields",
          flowType: flow.flowType,
          emptyDraftPreserved: true,
          providerInvoked: false,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      await page.screenshot({
        path: path.join(directory, "optional-numbers-mobile.png"),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      report({
        stage: "optional-numbers",
        passed: true,
        browserErrors: errors.length,
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
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
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
