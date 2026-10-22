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

const owner = session();
const poll = async (read, accept, label) => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("Timed out: " + label);
};
(async () => {
  let browser,
    page,
    failed = false,
    fingerprint;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await owner("auth.login", login, true);
    const flow = fixture.workflows.find(item => item.flowType === "state");
    const current = await owner("workflow.get", { id: flow.id });
    const definition = structuredClone(current.definition);
    const review = definition.nodes.find(node => node.id === "review");
    review.config = {
      ...review.config,
      assigneeUserId: fixture.userId,
      outcomeMode: "legacy_cancel",
      outcomes: [],
    };
    definition.nodes.splice(
      definition.nodes.findIndex(node => node.id === "done"),
      0,
      {
        id: "dispatch",
        name: "审批后路由",
        type: "router",
        position: { x: 720, y: 80 },
        config: {
          routes: [
            {
              handle: "continue",
              label: "继续",
              priority: -1,
              targetNodeId: "done",
            },
          ],
          defaultRoute: "continue",
        },
      }
    );
    definition.nodes.forEach((node, index) => {
      node.position = { x: index * 280, y: 80 };
    });
    definition.edges.find(edge => edge.sourceNodeId === "review").targetNodeId =
      "dispatch";
    definition.edges.find(edge => edge.sourceNodeId === "review").sourceHandle =
      "approved";
    definition.edges.push({
      id: "legacy-dispatch-done",
      sourceNodeId: "dispatch",
      sourceHandle: "continue",
      targetNodeId: "done",
    });
    await owner(
      "workflow.update",
      {
        id: flow.id,
        definition,
        expectedDefinitionVersion: Number(current.definitionVersion),
      },
      true
    );
    const saved = await owner("workflow.get", { id: flow.id });
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "block",
      reducedMotion: "reduce",
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
    await expect(page.locator("[data-aiflow-business-center]")).toBeVisible();
    await page.evaluate(
      hash => {
        location.hash = hash;
      },
      "#/flows/workflow/" + flow.id + "/editor"
    );
    await expect(page.locator("[data-workflow-editor]")).toBeVisible();
    const edgeId = definition.edges.find(
      edge => edge.sourceNodeId === "review"
    ).id;
    await expect
      .poll(() => page.locator(".react-flow__edge").count())
      .toBe(definition.edges.length);
    await expect(
      page
        .locator(".react-flow__edge")
        .filter({ has: page.locator("path.react-flow__edge-path") })
    ).toHaveCount(definition.edges.length);
    const rendered = await page
      .locator(".react-flow__edge")
      .evaluateAll(items =>
        items.map(el => ({
          id: el.getAttribute("data-id"),
          path: el
            .querySelector("path.react-flow__edge-path")
            ?.getAttribute("d"),
        }))
      );
    assert(
      rendered.find(edge => edge.id === edgeId)?.path,
      "Legacy operation-to-router path is missing"
    );
    await page.screenshot({
      path: path.join(directory, "legacy-operator-router.png"),
      animations: "disabled",
    });
    assert.equal(
      JSON.stringify((await owner("workflow.get", { id: flow.id })).definition),
      JSON.stringify(saved.definition),
      "Opening the canvas must not rewrite the definition"
    );
    report({
      stage: "legacy-operate-rendering",
      storedEdges: definition.edges.length,
      renderedEdges: rendered.length,
      approvedOutletVisible: true,
      definitionUnchanged: true,
    });
    for (const decision of ["approved", "rejected"]) {
      const run = await owner(
        "workflow.run",
        {
          workflowId: flow.id,
          triggerType: "test",
          idempotencyKey: tag + "_" + decision,
        },
        true
      );
      fixture.runs = [
        ...(fixture.runs ?? []),
        { id: run.runId, workflowId: flow.id },
      ];
      fs.writeFileSync(
        path.join(directory, "fixture.json"),
        JSON.stringify(fixture),
        "utf8"
      );
      const task = await poll(
        async () =>
          (
            await owner("task.list", {
              projectId: fixture.projectId,
              view: "todo",
              limit: 50,
            })
          ).find(item => item.runId === run.runId),
        Boolean,
        "isolated legacy task"
      );
      await owner(
        task.status === "claimed" ? "task.complete" : "task.execute",
        {
          taskId: task.id,
          result: {
            decision,
            outcome: decision,
            reason: "历史出口兼容验收",
            amount: 50,
          },
        },
        true
      );
      const detail = await poll(
        () => owner("workflow.runDetail", { runId: run.runId }),
        item => ["success", "cancelled", "failed"].includes(item.status),
        "isolated legacy continuation"
      );
      assert.equal(
        detail.status,
        decision === "approved" ? "success" : "cancelled"
      );
      if (decision === "approved")
        assert(
          detail.nodeRuns.some(
            node => node.nodeId === "dispatch" && node.status === "success"
          ),
          "Approval must reach the router"
        );
      else assert.equal(detail.endReason, "legacy_rejected");
      report({
        stage: "legacy-operate-runtime",
        decision,
        status: detail.status,
        routerReached: detail.nodeRuns.some(node => node.nodeId === "dispatch"),
        legacyCancellationPreserved: true,
      });
    }
    assert.deepEqual(errors, []);
    report({ stage: "legacy-operate-complete", browserErrors: 0, directory });
  } catch (error) {
    failed = true;
    console.error(
      String(error.stack ?? error).replaceAll(login.password, "[credential]")
    );
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          animations: "disabled",
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (fixture) {
      if (fingerprint)
        try {
          assert.equal(
            (await remote({ action: "settings_fingerprint" })).trim(),
            fingerprint
          );
        } catch (error) {
          failed = true;
          console.error(error.message);
        }
      try {
        report({ output: await remote({ action: "cleanup", fixture, login }) });
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
})();
