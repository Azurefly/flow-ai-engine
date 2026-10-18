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
    report({ stage: "numeric-fixture", tag });
    await remote({ action: "prepare_numeric_nodes", fixture, login });
    await owner("auth.login", login, true);
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
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    const openNode = async flow => {
      await page.goto(`${base}#/flows/workflow/${flow.id}/editor`);
      await page.locator("[data-workflow-editor]").waitFor();
      await page
        .locator(
          `.react-flow__node[data-id="${flow.flowType === "data" ? "numeric_quality" : "numeric_wait"}"]`
        )
        .click();
      const inspector = page.locator("[data-workflow-inspector]");
      await inspector.waitFor();
      const configTab = inspector.getByRole("tab", {
        name: "节点配置",
        exact: true,
      });
      if (await configTab.count()) await configTab.click();
      return inspector;
    };
    const data = fixture.workflows.find(item => item.flowType === "data");
    const inspector = await openNode(data);
    const rate = inspector.getByRole("spinbutton", { name: /最大空值率/ });
    await rate.fill("0.05");
    await rate.focus();
    const stepMismatch = await rate.evaluate(
      element => element.validity.stepMismatch
    );
    await page.keyboard.press("Control+s");
    await sleep(1200);
    const current = await owner("workflow.get", { id: data.id });
    const persisted = current.definition.nodes.find(
      item => item.id === "numeric_quality"
    ).config.maxNullRate;
    if (process.env.FLOW_UI_NUMERIC_REPRO === "1") {
      assert.equal(stepMismatch, true);
      assert.equal(persisted, 1);
      report({
        stage: "numeric-reproduction",
        entered: "0.05",
        nativeStepMismatch: stepMismatch,
        persisted,
        bugConfirmed: true,
      });
    } else {
      assert.equal(persisted, 0.05);
      assert.equal(stepMismatch, false);
      const savedValue = async (flow, nodeId, key, value) =>
        poll(
          "numeric draft persisted",
          () => owner("workflow.get", { id: flow.id }),
          row =>
            row.definition.nodes.find(item => item.id === nodeId).config[
              key
            ] === value
        );
      const saveFocused = async (flow, input, nodeId, key, value) => {
        await input.focus();
        await page.keyboard.press("Control+s");
        await savedValue(flow, nodeId, key, value);
      };
      const rejectDraft = async (flow, input, raw, nodeId, key) => {
        const before = await owner("workflow.get", { id: flow.id });
        await input.fill(raw);
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await expect(page.locator("[data-workflow-draft-error]")).toBeVisible();
        await expect(page.getByRole("button", { name: /保存画布/ })).toBeDisabled();
        await page.keyboard.press("Control+s");
        const after = await owner("workflow.get", { id: flow.id });
        assert.equal(after.definitionVersion, before.definitionVersion);
        assert.equal(
          after.definition.nodes.find(item => item.id === nodeId).config[key],
          before.definition.nodes.find(item => item.id === nodeId).config[key]
        );
        await expect(input).toHaveValue(raw);
      };
      await rate.press("ArrowUp");
      await expect(rate).toHaveValue("0.06");
      await saveFocused(data, rate, "numeric_quality", "maxNullRate", 0.06);
      for (const raw of ["1e-", "1.1", ""]) {
        await rejectDraft(data, rate, raw, "numeric_quality", "maxNullRate");
        await rate.fill("0.06");
        await expect(page.locator("[data-workflow-draft-error]")).toHaveCount(
          0
        );
      }
      await rate.fill("0.2");
      await saveFocused(data, rate, "numeric_quality", "maxNullRate", 0.2);
      await openNode(data);
      const reopenedRate = page
        .locator("[data-workflow-inspector]")
        .getByRole("spinbutton", { name: /最大空值率/ });
      await expect(reopenedRate).toHaveValue("0.2");
      report({
        stage: "numeric-decimal-draft",
        focusedShortcutSaved: true,
        invalidDraftBlocked: true,
        keyboardStepCorrect: true,
        reopenedValuePreserved: true,
      });

      for (const flow of fixture.workflows.filter(
        item => item.flowType !== "data"
      )) {
        const panel = await openNode(flow);
        const seconds = panel.getByRole("spinbutton", { name: /等待时长/ });
        for (const raw of ["2.5", "-", ""]) {
          await rejectDraft(
            flow,
            seconds,
            raw,
            "numeric_wait",
            "durationSeconds"
          );
          await seconds.fill("2");
          await expect(page.locator("[data-workflow-draft-error]")).toHaveCount(
            0
          );
        }
        await seconds.press("ArrowUp");
        await expect(seconds).toHaveValue("3");
        await saveFocused(flow, seconds, "numeric_wait", "durationSeconds", 3);
        await openNode(flow);
        await expect(
          page
            .locator("[data-workflow-inspector]")
            .getByRole("spinbutton", { name: /等待时长/ })
        ).toHaveValue("3");
        report({
          stage: "numeric-integer-draft",
          flowType: flow.flowType,
          invalidAndEmptyBlocked: true,
          focusedShortcutSaved: true,
          reopenedValuePreserved: true,
        });
      }
      await remote({ action: "prepare_native_schedule", fixture, login });
      const runAtThreshold = async expectedStatus => {
        const started = await owner(
          "data.run",
          { projectId: fixture.projectId, workflowId: data.id },
          true
        );
        const result = await poll(
          "quality gate run",
          () =>
            owner("data.runDetail", {
              projectId: fixture.projectId,
              runId: started.runId,
            }),
          item => item && ["failed", "success"].includes(item.status)
        );
        assert.equal(result.status, expectedStatus);
        return result;
      };
      const rejected = await runAtThreshold("failed");
      assert.match(JSON.stringify(rejected.error), /0\.2500/);
      const published = await owner("workflow.get", { id: data.id });
      await owner(
        "workflow.unpublish",
        { id: data.id, expectedDefinitionVersion: published.definitionVersion },
        true
      );
      const panel = await openNode(data);
      const finalRate = panel.getByRole("spinbutton", { name: /最大空值率/ });
      await finalRate.fill("0.3");
      await saveFocused(data, finalRate, "numeric_quality", "maxNullRate", 0.3);
      const next = await owner("workflow.get", { id: data.id });
      await owner(
        "workflow.publish",
        { id: data.id, expectedDefinitionVersion: next.definitionVersion },
        true
      );
      const accepted = await runAtThreshold("success");
      assert.deepEqual(accepted.output.terminals[0].rows, [
        { id: 1, amount: 120, status: "paid", note: null },
      ]);
      report({
        stage: "numeric-runtime-threshold",
        actualNullRate: 0.25,
        threshold02Rejected: true,
        threshold03Accepted: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      report({
        stage: "numeric-config",
        passed: true,
        threeProfiles: true,
        browserErrors: errors.length,
      });
    }
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: path.join(directory, "numeric-config.png"),
      fullPage: true,
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
