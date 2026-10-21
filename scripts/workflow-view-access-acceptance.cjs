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

const has = (access, permission) =>
  Array.isArray(access.permissions)
    ? access.permissions.includes(permission)
    : Boolean(access.permissions?.has?.(permission));
async function grant(role = "designer") {
  await owner(
    "project.grantMember",
    { projectId: fixture.projectId, userId: fixture.disabledUserId, role },
    true
  );
}
async function revoke() {
  const members = await owner("project.members", {
    projectId: fixture.projectId,
  });
  for (const item of members.filter(
    item => Number(item.userId) === fixture.disabledUserId && !item.revokedAt
  )) {
    assert.notEqual(Number(item.userId), fixture.userId);
    await owner(
      "project.revokeMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        assignmentId: item.id,
      },
      true
    );
  }
}
async function refresh(page, success = true) {
  const response = page.waitForResponse(
    row =>
      row.url().includes("workflow.access") && row.request().method() === "GET"
  );
  await page.evaluate(() => {
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    }
  });
  const actual = await response;
  assert([200, 207, 503].includes(actual.status()));
  const names = decodeURIComponent(
    new URL(actual.url()).pathname.split("/api/trpc/")[1]
  ).split(",");
  const payload = await actual.json();
  const entry = Array.isArray(payload)
    ? payload[names.indexOf("workflow.access")]
    : payload;
  assert(
    success ? entry?.result : entry?.error,
    "Check the access result independently of other batched reads"
  );
}

async function verify(page) {
  const reproduction = process.env.FLOW_UI_WORKFLOW_ACCESS_REPRO === "1";
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const blocked = page.locator("[data-workflow-access-boundary]");
  const select = id =>
    page
      .getByRole("combobox", { name: "定位并配置节点", exact: true })
      .selectOption(id);
  const currentField = () =>
    page
      .locator("[data-workflow-inspector]")
      .getByRole("textbox", { name: "节点名称", exact: true });
  const retained = async flow => {
    await expect(blocked).toContainText("当前账号无权查看此流程", {
      timeout: 45000,
    });
    await expect(page.locator("[data-workflow-editor]")).toHaveCount(0);
    assert(!(await page.locator("body").innerText()).includes(flow.name));
    await expect(page.locator("[data-aiflow-workflow-library]")).toHaveCount(0);
  };
  const restore = async () => {
    await grant();
    await blocked
      .getByRole("button", { name: "重新检查流程权限", exact: true })
      .click();
  };
  for (const flow of fixture.workflows) {
    const server = await viewer("workflow.get", { id: flow.id });
    assert.notEqual(Number(server.ownerUserId), fixture.disabledUserId);
    const access = await viewer("workflow.access", { id: flow.id });
    assert(has(access, "workflow:view") && has(access, "workflow:edit"));
    await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
    await page.locator("[data-workflow-editor]").waitFor();
    const middle = server.definition.nodes.find(
      item => item.type === (flow.flowType === "data" ? "filter" : "operate")
    );
    assert(middle);
    await select(middle.id);
    const field = currentField(),
      original = await field.inputValue(),
      draft = original + "_授权恢复后继续_" + tag;
    await field.fill(draft);
    if (!reproduction && flow.flowType === "control") {
      const fail = async route => {
        const names = decodeURIComponent(
          new URL(route.request().url()).pathname.split("/api/trpc/")[1]
        ).split(",");
        if (
          route.request().method() !== "GET" ||
          !names.includes("workflow.access")
        )
          return route.fallback();
        const input = JSON.parse(
          new URL(route.request().url()).searchParams.get("input")
        );
        const candidate = input.json
          ? input
          : input[names.indexOf("workflow.access")];
        assert(fixture.workflows.some(item => item.id === candidate.json.id));
        const response = await route.fetch(),
          payload = await response.json();
        const error = {
          error: {
            json: {
              message: "权限读取测试中断",
              code: -32603,
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 503,
                path: "workflow.access",
              },
            },
          },
        };
        if (Array.isArray(payload))
          payload[names.indexOf("workflow.access")] = error;
        await route.fulfill({
          response,
          status: Array.isArray(payload) ? 207 : 503,
          json: Array.isArray(payload) ? payload : error,
        });
      };
      await page.route("**/api/trpc/**", fail);
      await refresh(page, false);
      await expect(blocked).toContainText("暂时无法确认流程访问权限");
      await expect(blocked).toContainText("未保存修改已保留");
      await expect(page.locator("[data-workflow-editor]")).toHaveCount(0);
      assert(!(await page.locator("body").innerText()).includes(flow.name));
      await page.unroute("**/api/trpc/**", fail);
      await blocked
        .getByRole("button", { name: "重新检查流程权限", exact: true })
        .click();
      await select(middle.id);
      await expect(field).toHaveValue(draft);
      await expect(field).toBeEnabled();
      await revoke();
      await grant("viewer");
      await refresh(page);
      await expect(field).toBeDisabled();
      await expect(field).toHaveValue(draft);
      await expect(blocked).toHaveCount(0);
      await revoke();
      await grant();
      await refresh(page);
      await expect(field).toBeEnabled();
      await expect(field).toHaveValue(draft);
      report({
        stage: "workflow-access-read-and-edit",
        accessFailureHidCachedContent: true,
        retryRestoredDraft: true,
        viewOnlyKeptReadableDraft: true,
        editRestoredWithoutReload: true,
      });
    }
    await revoke();
    const denied = await viewer("workflow.access", { id: flow.id });
    assert(!has(denied, "workflow:view") && !has(denied, "workflow:edit"));
    await assert.rejects(viewer("workflow.get", { id: flow.id }));
    if (reproduction || flow.flowType !== "state") await refresh(page);
    let expected = original;
    if (reproduction) {
      await expect(field).toBeDisabled();
      await expect(field).toHaveValue(draft);
      await expect(page.locator("[data-workflow-editor]")).toBeVisible();
      assert((await page.locator("body").innerText()).includes(flow.name));
      report({
        stage: "workflow-view-reproduction",
        flowType: flow.flowType,
        backendReadDenied: true,
        cachedDefinitionStillVisible: true,
        cachedWorkflowNameStillVisible: true,
        localDraftRetained: true,
      });
      await grant();
      await refresh(page);
      await expect(field).toBeEnabled();
    } else {
      await retained(flow);
      await expect(blocked).toContainText("未保存修改已保留");
      if (flow.flowType === "state") {
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({
            width,
            height: width === 1440 ? 1000 : 844,
          });
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
              )
            )
            .toBe(true);
          await expect(
            blocked.getByRole("button", {
              name: "重新检查流程权限",
              exact: true,
            })
          ).toBeVisible();
          if (width === 390)
            await page.screenshot({
              path: path.join(directory, "workflow-access-mobile.png"),
              animations: "disabled",
            });
        }
      }
      if (flow.flowType === "control") {
        const latest = await owner("workflow.get", { id: flow.id }),
          external = structuredClone(latest.definition);
        expected = "管理员已保存_" + tag;
        external.nodes.find(item => item.id === middle.id).name = expected;
        await owner(
          "workflow.update",
          {
            id: flow.id,
            definition: external,
            expectedDefinitionVersion: Number(latest.definitionVersion),
          },
          true
        );
      }
      await restore();
      await page.locator("[data-workflow-editor]").waitFor();
      await select(middle.id);
      await expect(field).toHaveValue(draft);
      await expect(field).toBeEnabled();
      report({
        stage: "workflow-view-restored",
        flowType: flow.flowType,
        backendReadDenied: true,
        cachedContentHidden: true,
        workflowNameHidden: true,
        sameAccountDraftRestored: true,
        foregroundPollingCovered: flow.flowType === "state",
      });
      if (flow.flowType === "control") {
        await page
          .locator("[data-workflow-publication-gate]")
          .getByRole("button", { name: "处理版本变化", exact: true })
          .click();
        const conflict = page.getByRole("dialog", {
          name: "流程已被更新，当前修改已保留",
          exact: true,
        });
        const downloading = page.waitForEvent("download");
        await conflict
          .getByRole("button", { name: "导出我的修改", exact: true })
          .click();
        const file = path.join(
          directory,
          "workflow-access-retained-draft.json"
        );
        await (await downloading).saveAs(file);
        assert.equal(
          JSON.parse(
            fs.readFileSync(file, "utf8")
          ).workflow.definition.nodes.find(item => item.id === middle.id).name,
          draft
        );
        await conflict
          .getByRole("button", { name: "读取最新版本并替换画布", exact: true })
          .click();
        await expect(conflict).toHaveCount(0);
        await select(middle.id);
        await expect(field).toHaveValue(expected);
        report({
          stage: "workflow-restoration-conflict",
          localDraftRetainedThroughRevocation: true,
          otherUserVersionNotOverwritten: true,
          exportedOnlyAfterRestoredView: true,
          explicitReloadSucceeded: true,
        });
      }
    }
    if (reproduction || flow.flowType !== "control") {
      await expect(field).toHaveValue(draft);
      await field.fill(original);
    }
    await expect(
      page.getByRole("button", { name: /^保存画布/ })
    ).toBeDisabled();
    assert.equal(
      (await owner("workflow.get", { id: flow.id })).definition.nodes.find(
        item => item.id === middle.id
      ).name,
      expected
    );
    if (!reproduction) {
      await page.goto(base + "#/flows/workflow/" + flow.id + "/detail");
      await page.locator("[data-aiflow-process-detail-page]").waitFor();
      await revoke();
      await refresh(page);
      await retained(flow);
      await expect(
        page.locator("[data-aiflow-process-detail-page]")
      ).toHaveCount(0);
      await restore();
      await page.locator("[data-aiflow-process-detail-page]").waitFor();
      if (flow.flowType === "control") {
        await grant("operator");
        const started = await viewer(
          "workflow.run",
          {
            workflowId: flow.id,
            triggerType: "test",
            idempotencyKey: tag + "_monitor_draft",
          },
          true
        );
        fixture.runs ??= [];
        fixture.runs.push({ id: started.runId, workflowId: flow.id });
        fs.writeFileSync(
          path.join(directory, "fixture.json"),
          JSON.stringify(fixture),
          "utf8"
        );
        await poll(
          "fixture run waiting for its assigned user",
          () => viewer("workflow.runDetail", { runId: started.runId }),
          row =>
            row.status === "waiting" && row.controlCapabilities?.canTerminate
        );
        await page.goto(
          base + "#/runs/monitor/" + flow.id + "/" + started.runId
        );
        await expect(page.getByLabel(flow.name, { exact: true })).toBeVisible();
        await page
          .getByRole("button", { name: "终止运行", exact: true })
          .click();
        const control = page.getByRole("dialog", {
          name: "确认终止运行",
          exact: true,
        });
        const reason = "恢复权限后继续填写_" + tag;
        await control
          .getByRole("textbox", { name: "终止原因", exact: true })
          .fill(reason);
        await revoke();
        await refresh(page);
        await retained(flow);
        await expect(control).toHaveCount(0);
        await expect(page.getByLabel(flow.name, { exact: true })).toHaveCount(
          0
        );
        assert.equal(
          (await owner("workflow.runDetail", { runId: started.runId })).status,
          "waiting"
        );
        await grant("operator");
        await restore();
        await expect(page.getByLabel(flow.name, { exact: true })).toBeVisible();
        await expect(control).toBeVisible();
        await expect(
          control.getByRole("textbox", { name: "终止原因", exact: true })
        ).toHaveValue(reason);
        await expect(
          control.getByRole("button", { name: "确认终止", exact: true })
        ).toBeEnabled();
        await control
          .getByRole("button", { name: "返回", exact: true })
          .click();
        assert.equal(
          (await viewer("workflow.runDetail", { runId: started.runId })).status,
          "waiting"
        );
        report({
          stage: "workflow-monitor-draft",
          hiddenWhileRevoked: true,
          reasonRetainedOnRestoration: true,
          noUnintendedRunControl: true,
        });
      }
      report({
        stage: "workflow-cached-views",
        flowType: flow.flowType,
        detailHiddenAfterRevocation: true,
        monitoringHiddenAfterRevocation: flow.flowType === "control",
      });
    }
  }
  assert.deepEqual(errors, []);
  report({ stage: "workflow-view-complete", reproduction, browserErrors: 0 });
}
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
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await grant();
    await viewer("auth.login", memberLogin, true);
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
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible({ timeout: 20000 });
    await verify(page);
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
    if (fixture?.tag)
      try {
        report({ output: await remote({ action: "cleanup", fixture, login }) });
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
    process.exitCode = failed ? 1 : 0;
  }
})();
