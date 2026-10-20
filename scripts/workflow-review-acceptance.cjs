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

async function verifyReviews() {
  const projectId = fixture.projectId;
  const configBefore = (
    await remote({ action: "settings_fingerprint" })
  ).trim();
  await owner(
    "iam.updateUserStatus",
    { userId: fixture.disabledUserId, status: "active" },
    true
  );
  await owner(
    "project.grantMember",
    { projectId, userId: fixture.disabledUserId, role: "owner" },
    true
  );
  await viewer("auth.login", memberLogin, true);
  const policy = await owner("config.settings");
  const baseline = flow => ({
    expectedDefinitionVersion: Number(flow.definitionVersion),
    expectedAuditStatus: flow.auditStatus,
  });
  const get = id => owner("workflow.get", { id });
  const audit = (flow, status) =>
    viewer(
      "project.auditWorkflow",
      {
        projectId,
        workflowId: flow.id,
        auditStatus: status,
        ...baseline(flow),
      },
      true
    );
  const history = id =>
    owner("project.workflowAudit", { projectId, workflowId: id });
  let browser, page;
  const errors = [],
    posts = [];
  let loseStateResponse = true,
    failReload = false,
    holdDataResponse = false,
    heldSeen,
    releaseHeld;
  const held = new Promise(resolve => {
    releaseHeld = resolve;
  });
  const seen = new Promise(resolve => {
    heldSeen = resolve;
  });
  try {
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
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/trpc/**", async route => {
      const request = route.request(),
        names = decodeURIComponent(
          new URL(request.url()).pathname.split("/api/trpc/")[1]
        ).split(",");
      if (
        request.method() === "POST" &&
        names.includes("project.auditWorkflow")
      ) {
        const raw = request.postDataJSON(),
          input = raw.json ?? raw["0"]?.json;
        assert.equal(input.projectId, projectId);
        assert(fixture.workflows.some(flow => flow.id === input.workflowId));
        assert(Number.isSafeInteger(input.expectedDefinitionVersion));
        assert(
          ["init", "approved", "rejected"].includes(input.expectedAuditStatus)
        );
        posts.push(input);
        const spec = fixture.workflows.find(
          flow => flow.id === input.workflowId
        );
        if (
          spec.flowType === "state" &&
          loseStateResponse &&
          input.expectedDefinitionVersion > 2
        ) {
          loseStateResponse = false;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
          return;
        }
        if (spec.flowType === "data" && holdDataResponse) {
          holdDataResponse = false;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          heldSeen();
          await held;
          await route.fulfill({ response });
          return;
        }
      }
      if (
        failReload &&
        request.method() === "GET" &&
        names.includes("project.workflows")
      ) {
        const response = await route.fetch(),
          payload = await response.json();
        const value = {
          error: {
            json: {
              message: "读取审核版本测试失败",
              code: -32603,
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 503,
                path: "project.workflows",
              },
            },
          },
        };
        if (Array.isArray(payload)) {
          payload[names.indexOf("project.workflows")] = value;
          await route.fulfill({ response, json: payload });
        } else await route.fulfill({ response, json: value });
        return;
      }
      await route.fallback();
    });
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
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
    const focusRefresh = async () => {
      const response = page.waitForResponse(
        r =>
          r.url().includes("project.workflows") &&
          r.request().method() === "GET"
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
      await response;
    };
    const open = async flow => {
      await page
        .getByRole("button", {
          name: "更多信息与操作：" + flow.name,
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: "审核通过", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "确认审核通过",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    const clickDecision = async (dialog, status) => {
      const response = page.waitForResponse(
        r =>
          r.url().includes("project.auditWorkflow") &&
          r.request().method() === "POST"
      );
      await dialog
        .getByRole("button", { name: "确认通过", exact: true })
        .click();
      assert.equal((await response).status(), status);
    };
    for (const spec of fixture.workflows) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const first = await get(spec.id);
      assert.equal(first.auditStatus, "init");
      let dialog = await open(spec);
      await expect(
        dialog.getByText("v" + first.definitionVersion, { exact: true })
      ).toBeVisible();
      if (spec.flowType === "state") {
        const definition = structuredClone(first.definition);
        definition.nodes[0].name = "开始_审核冲突_" + tag;
        await owner(
          "workflow.update",
          {
            id: spec.id,
            expectedDefinitionVersion: Number(first.definitionVersion),
            definition,
          },
          true
        );
        await focusRefresh();
        await expect(
          dialog.getByText("v" + first.definitionVersion, { exact: true })
        ).toBeVisible();
        await clickDecision(dialog, 409);
        await expect(dialog.getByRole("alert")).toContainText("流程定义已变化");
        await expect(
          dialog.getByRole("button", { name: "确认通过", exact: true })
        ).toBeDisabled();
        failReload = true;
        await dialog
          .getByRole("button", { name: "重新读取审核版本", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toContainText(
          "读取审核版本测试失败",
          { timeout: 25000 }
        );
        await expect(
          dialog.getByText("v" + first.definitionVersion, { exact: true })
        ).toBeVisible();
        failReload = false;
        await dialog
          .getByRole("button", { name: "重新读取审核版本", exact: true })
          .click();
        await expect(
          dialog.getByText("v" + (Number(first.definitionVersion) + 1), {
            exact: true,
          })
        ).toBeVisible();
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({
            width,
            height: width === 1440 ? 1000 : 844,
          });
          // Viewport emulation resolves before responsive layout/observers settle.
          await expect
            .poll(
              async () =>
                dialog.evaluate(element => {
                  const bounds = element.getBoundingClientRect();
                  return (
                    element.scrollWidth <= element.clientWidth + 1 &&
                    document.documentElement.scrollWidth <= innerWidth + 1 &&
                    bounds.left >= -1 &&
                    bounds.right <= innerWidth + 1
                  );
                }),
              { timeout: 5000 }
            )
            .toBe(true);
          await page.keyboard.press("Tab");
          assert(
            await dialog.evaluate(element =>
              element.contains(document.activeElement)
            )
          );
          if (width === 390 || width === 1440)
            await page.screenshot({
              path: path.join(directory, "review-" + width + ".png"),
              animations: "disabled",
            });
        }
        await dialog
          .getByRole("button", { name: "确认通过", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toContainText(
          "上次审核结果尚未确认"
        );
        assert.equal((await get(spec.id)).auditStatus, "approved");
        await dialog
          .getByRole("button", { name: "核对审核结果", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        const attempted = posts.filter(p => p.workflowId === spec.id);
        assert.deepEqual(attempted.at(-1), attempted.at(-2));
        const logs = (await history(spec.id)).filter(
          row =>
            row.operation === "workflow_audited" &&
            Number(row.details?.definitionVersion) ===
              Number(first.definitionVersion) + 1
        );
        assert.equal(logs.length, 1);
        await page
          .getByRole("button", { name: "审批记录", exact: true })
          .click();
        await page
          .getByLabel("选择流程查看审批记录", { exact: true })
          .selectOption(spec.id);
        const auditDialog = page.getByRole("dialog", {
          name: "审批记录",
          exact: true,
        });
        await expect(auditDialog).toContainText(
          "定义 v" + (Number(first.definitionVersion) + 1)
        );
        await auditDialog
          .getByRole("button", { name: "关闭", exact: true })
          .click();

        report({
          stage: "workflow-review-definition",
          staleVersionDenied: true,
          backgroundRefreshKeptBaseline: true,
          failedReloadKeptBaseline: true,
          responseLossReconciled: true,
          oneAudit: true,
          mobileWidths: [320, 390],
        });
      } else if (spec.flowType === "control") {
        await audit(first, "rejected");
        await clickDecision(dialog, 409);
        await expect(dialog.getByRole("alert")).toContainText(
          "审核状态已被其他人更新"
        );
        await dialog
          .getByRole("button", { name: "重新读取审核版本", exact: true })
          .click();
        await expect(
          dialog.getByRole("button", { name: "确认通过", exact: true })
        ).toBeDisabled();
        await expect(dialog.getByText("已驳回", { exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await viewer(
          "project.resetWorkflowAudit",
          {
            projectId,
            workflowId: spec.id,
            expectedDefinitionVersion: Number(first.definitionVersion),
            expectedAuditStatus: "rejected",
          },
          true
        );
        await focusRefresh();
        dialog = await open(spec);
        await clickDecision(dialog, 200);
        await expect(dialog).toHaveCount(0);
        report({
          stage: "workflow-review-state",
          oppositeDecisionNotOverwritten: true,
          resetKeptDefinition: true,
          freshDecisionConfirmed: true,
        });
      } else {
        await owner(
          "project.grantMember",
          { projectId, userId: fixture.disabledUserId, role: "viewer" },
          true
        );
        const members = await owner("project.members", { projectId });
        for (const item of members.filter(
          m => Number(m.userId) === fixture.disabledUserId && m.role === "owner"
        ))
          await owner(
            "project.revokeMember",
            {
              projectId,
              userId: fixture.disabledUserId,
              assignmentId: item.id,
            },
            true
          );
        await clickDecision(dialog, 403);
        await expect(
          dialog.getByRole("button", { name: "确认通过", exact: true })
        ).toBeDisabled();
        await expect(
          dialog.getByText("v" + first.definitionVersion, { exact: true })
        ).toBeVisible();
        assert.equal((await get(spec.id)).auditStatus, "init");
        await owner(
          "project.grantMember",
          { projectId, userId: fixture.disabledUserId, role: "owner" },
          true
        );
        await dialog
          .getByRole("button", { name: "重新读取审核版本", exact: true })
          .click();
        await expect(
          dialog.getByRole("button", { name: "确认通过", exact: true })
        ).toBeEnabled();
        holdDataResponse = true;
        await dialog
          .getByRole("button", { name: "确认通过", exact: true })
          .click();
        await seen;
        await expect(
          dialog.getByRole("button", { name: "取消", exact: true })
        ).toBeDisabled();
        await expect(
          dialog.getByRole("button", { name: "正在确认…", exact: true })
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        releaseHeld();
        await expect(dialog).toHaveCount(0);
        report({
          stage: "workflow-review-permission",
          revokedPermissionDenied: true,
          restoredSameBaseline: true,
          pendingCloseLocked: true,
        });
      }
    }
    await page.unroute("**/api/trpc/**");
    const spec = fixture.workflows.find(flow => flow.flowType === "control");
    let current = await get(spec.id);
    const revise = async () => {
      const definition = structuredClone(current.definition);
      definition.nodes[0].name =
        "开始_并发复核_" + randomBytes(4).toString("hex");
      await owner(
        "workflow.update",
        {
          id: spec.id,
          expectedDefinitionVersion: Number(current.definitionVersion),
          definition,
        },
        true
      );
      current = await get(spec.id);
    };
    await revise();
    const race = await Promise.allSettled([
      audit(current, "approved"),
      audit(current, "rejected"),
    ]);
    assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(
      race.filter(r => r.status === "rejected" && r.reason.status === 409)
        .length,
      1
    );
    assert.equal(
      (await history(spec.id)).filter(
        row =>
          row.operation === "workflow_audited" &&
          Number(row.details?.definitionVersion) ===
            Number(current.definitionVersion)
      ).length,
      1
    );
    await revise();
    const repeated = await Promise.all(
      Array.from({ length: 10 }, () => audit(current, "approved"))
    );
    assert(repeated.every(value => value === true));
    assert.equal(
      (await history(spec.id)).filter(
        row =>
          row.operation === "workflow_audited" &&
          Number(row.details?.definitionVersion) ===
            Number(current.definitionVersion)
      ).length,
      1
    );
    await assert.rejects(
      viewer(
        "project.auditWorkflow",
        { projectId, workflowId: spec.id, auditStatus: "approved" },
        true
      ),
      error => error.status === 400
    );
    if (policy.approval.requireProjectApproval) {
      const outcomes = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        current = await get(spec.id);
        if (current.status === "published") {
          await owner(
            "workflow.unpublish",
            {
              id: spec.id,
              expectedDefinitionVersion: Number(current.definitionVersion),
            },
            true
          );
          current = await get(spec.id);
        }
        await revise();
        await audit(current, "approved");
        current = await get(spec.id);
        const results = await Promise.allSettled([
          audit(current, "rejected"),
          owner(
            "workflow.publish",
            {
              id: spec.id,
              expectedDefinitionVersion: Number(current.definitionVersion),
            },
            true
          ),
        ]);
        const actual = await get(spec.id);
        assert(
          !(actual.status === "published" && actual.auditStatus !== "approved")
        );
        assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
        assert.equal(
          results.filter(
            r => r.status === "rejected" && r.reason.status === 409
          ).length,
          1
        );
        outcomes.push({
          status: actual.status,
          auditStatus: actual.auditStatus,
        });
      }
      report({
        stage: "workflow-review-publish-races",
        trials: outcomes.length,
        outcomes,
        noUnapprovedPublishedVersion: true,
      });
    }
    assert.equal(
      (await remote({ action: "settings_fingerprint" })).trim(),
      configBefore
    );
    assert.deepEqual(errors, []);
    report({
      stage: "workflow-review-complete",
      threeTypes: true,
      oppositeDecisionsSerialized: true,
      sameDecisionConcurrentRequests: 10,
      oneAuditPerDecision: true,
      globalSettingsUnchanged: true,
      browserErrors: errors.length,
    });
  } catch (error) {
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: true,
          animations: "disabled",
        })
        .catch(() => {});
    throw error;
  } finally {
    releaseHeld?.();
    if (browser) await browser.close();
    assert.equal(
      (await remote({ action: "settings_fingerprint" })).trim(),
      configBefore
    );
  }
}

(async () => {
  let failed = false;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    if (process.env.FLOW_UI_WORKFLOW_REVIEW_REPRO !== "1") {
      await verifyReviews();
      return;
    }
    for (const flow of fixture.workflows) {
      const before = await owner("workflow.get", { id: flow.id });
      assert.equal(before.status, "draft");
      const definition = structuredClone(before.definition);
      definition.nodes[0].name = "开始_变更待复核_" + tag;
      await owner(
        "workflow.update",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(before.definitionVersion),
          definition,
        },
        true
      );
      const changed = await owner("workflow.get", { id: flow.id });
      assert.equal(changed.auditStatus, "init");
      assert.equal(
        Number(changed.definitionVersion),
        Number(before.definitionVersion) + 1
      );
      await owner(
        "project.auditWorkflow",
        {
          projectId: fixture.projectId,
          workflowId: flow.id,
          auditStatus: "approved",
          expectedDefinitionVersion: Number(before.definitionVersion),
          expectedAuditStatus: before.auditStatus,
        },
        true
      );
      const actual = await owner("workflow.get", { id: flow.id });
      assert.equal(actual.auditStatus, "approved");
      report({
        stage: "stale-workflow-review-reproduction",
        flowType: flow.flowType,
        reviewedVersion: Number(before.definitionVersion),
        actualVersion: Number(actual.definitionVersion),
        unseenDefinitionApproved: true,
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
  } finally {
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
