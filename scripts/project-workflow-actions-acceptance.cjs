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
  const saveFixture = () =>
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture),
      "utf8"
    );
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    assert(fixture?.projectId && fixture.workflows.length === 3);
    fixture.projectActions = true;
    saveFixture();
    await owner("auth.login", login, true);
    const projectInput = { projectId: fixture.projectId };
    const state = fixture.workflows.find(item => item.flowType === "state");
    const control = fixture.workflows.find(item => item.flowType === "control");
    const data = fixture.workflows.find(item => item.flowType === "data");
    const initial = await owner("project.workflows", projectInput);
    const settings = await owner("config.settings");
    const independent =
      settings.approval.reviewerMode === "independent_reviewer";
    for (const item of initial) {
      const candidate = item.status === "draft" && item.auditStatus === "init";
      assert.equal(item.actions.canReview, candidate && !independent);
      assert.equal(
        Boolean(item.actions.reviewBlockedReason),
        candidate && independent
      );
    }
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
    const loginUI = async credentials => {
      await page.goto(base);
      await page
        .getByLabel("用户名", { exact: true })
        .fill(credentials.username);
      await page.getByLabel("密码", { exact: true }).fill(credentials.password);
      await page
        .getByRole("button", { name: "登录流程引擎", exact: true })
        .click();
      await page.locator('input[type="password"]').waitFor({ state: "hidden" });
      await page.goto(`${base}#/flows/project/${fixture.projectId}`);
      await page
        .locator("[data-project-workflow-row]:visible")
        .first()
        .waitFor();
    };
    const row = flow =>
      page.locator(`[data-project-workflow-row="${flow.id}"]:visible`);
    const more = flow =>
      row(flow)
        .getByRole("button", {
          name: "更多信息与操作：" + flow.name,
          exact: true,
        })
        .click();
    const refresh = async (scope = page) => {
      await Promise.all([
        page.waitForResponse(
          response =>
            response.url().includes("project.workflows") &&
            response.request().method() === "GET"
        ),
        scope
          .getByRole("button", {
            name: scope === page ? "刷新业务权限" : "刷新流程权限",
            exact: true,
          })
          .click(),
      ]);
    };
    const mutateUI = async (button, method) => {
      const [response] = await Promise.all([
        page.waitForResponse(
          response =>
            response.url().includes(method) &&
            response.request().method() === "POST"
        ),
        button.click(),
      ]);
      return response;
    };
    const setRole = async (role, refreshUI = true) => {
      await owner(
        "project.grantMember",
        { ...projectInput, userId: fixture.disabledUserId, role },
        true
      );
      const members = await owner("project.members", projectInput);
      for (const grant of members.filter(
        item =>
          Number(item.userId) === fixture.disabledUserId && item.role !== role
      ))
        await owner(
          "project.revokeMember",
          {
            ...projectInput,
            userId: fixture.disabledUserId,
            assignmentId: grant.id,
          },
          true
        );
      if (refreshUI) await refresh();
    };
    await loginUI(login);
    await more(state);
    const stateCandidate =
      initial.find(item => item.id === state.id).auditStatus === "init";
    if (independent && stateCandidate)
      await expect(
        page.getByText("独立复核模式下，请由其他业务管理员审核此流程。", {
          exact: true,
        })
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "审核通过", exact: true })
    ).toHaveCount(!independent && stateCandidate ? 1 : 0);
    report({
      stage: "workflow-review-policy",
      reviewerMode: settings.approval.reviewerMode,
      serverAndUIAgree: true,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /退出/ }).click();
    await remote({ action: "prepare_project_actions", fixture, login });
    await viewer("auth.login", memberLogin, true);
    await loginUI(memberLogin);
    for (const flow of fixture.workflows) {
      await expect(
        row(flow).getByRole("button", { name: /^(发起流程|执行数据流程)：/ })
      ).toHaveCount(0);
      await expect(
        row(flow).getByRole("button", {
          name: "查看画布：" + flow.name,
          exact: true,
        })
      ).toBeVisible();
    }
    report({
      stage: "workflow-viewer",
      readonlyCanvasAvailable: true,
      launchHidden: true,
      configuredReviewPolicyRespected: true,
    });

    await owner(
      "workflow.grantMember",
      {
        workflowId: state.id,
        userId: fixture.disabledUserId,
        role: "operator",
      },
      true
    );
    await refresh();
    await expect(
      row(state).getByRole("button", {
        name: "发起流程：" + state.name,
        exact: true,
      })
    ).toBeVisible();
    await expect(
      row(control).getByRole("button", { name: /^发起流程：/ })
    ).toHaveCount(0);
    await expect(
      row(data).getByRole("button", { name: /^执行数据流程：/ })
    ).toHaveCount(0);
    await owner(
      "workflow.revokeMember",
      {
        workflowId: state.id,
        userId: fixture.disabledUserId,
        role: "operator",
      },
      true
    );
    await refresh();
    await expect(
      row(state).getByRole("button", { name: /^发起流程：/ })
    ).toHaveCount(0);
    report({
      stage: "workflow-direct-role",
      oneFlowOnly: true,
      revocationRefreshed: true,
    });

    const current = await owner("workflow.get", { id: control.id });
    await owner(
      "workflow.unpublish",
      { id: control.id, expectedDefinitionVersion: current.definitionVersion },
      true
    );
    fixture.workflowRoleCode = "custom_" + tag;
    saveFixture();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.workflowRoleCode,
        name: "流程权限验收_" + tag,
        scope: "workflow",
        permissions: ["workflow:view", "workflow:publish"],
      },
      true
    );
    await owner(
      "workflow.assignCustomRole",
      {
        workflowId: control.id,
        userId: fixture.disabledUserId,
        roleCode: fixture.workflowRoleCode, expectedConfigToken: await roleSnapshotToken(),
      },
      true
    );
    await refresh();
    let rows = await viewer("project.workflows", projectInput);
    assert.equal(
      rows.find(item => item.id === control.id).actions.canPublish,
      true
    );
    assert.equal(
      rows.find(item => item.id === state.id).actions.canUnpublish,
      false
    );
    await more(control);
    assert.equal(
      (
        await mutateUI(
          page.getByRole("button", { name: "发布流程", exact: true }),
          "workflow.publish"
        )
      ).status(),
      200
    );
    await expect(row(control)).toContainText("已发布");
    await more(control);
    await expect(
      page.getByRole("button", { name: "取消发布", exact: true })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const bindings = await owner("workflow.customRoleAssignments", {
      workflowId: control.id,
      page: 0,
      query: fixture.workflowRoleCode,
    });
    const binding = bindings.items.find(
      item =>
        item.roleCode === fixture.workflowRoleCode &&
        Number(item.userId) === fixture.disabledUserId
    );
    assert(binding);
    await owner(
      "workflow.revokeCustomRole",
      { workflowId: control.id, assignmentId: binding.id },
      true
    );
    await refresh();
    await more(control);
    await expect(
      page.getByRole("button", { name: "取消发布", exact: true })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    report({
      stage: "workflow-custom-publisher",
      publishedWithoutProjectManagement: true,
      scopedToOneFlow: true,
      revokedEntryHidden: true,
    });

    await setRole("operator");
    await row(control)
      .getByRole("button", { name: "发起流程：" + control.name, exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "发起流程", exact: true });
    const draft = "运行上下文_" + tag;
    await dialog.getByLabel("业务信息一", { exact: true }).fill(draft);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toContainText(
      "放弃本次发起填写"
    );
    await page.getByRole("button", { name: "继续填写", exact: true }).click();
    await expect(dialog.getByLabel("业务信息一", { exact: true })).toHaveValue(
      draft
    );
    await setRole("viewer", false);
    assert.equal(
      (
        await mutateUI(
          dialog.getByRole("button", { name: "确认发起", exact: true }),
          "workflow.run"
        )
      ).status(),
      403
    );
    await expect(
      dialog.getByRole("button", { name: "确认发起", exact: true })
    ).toBeDisabled();
    await expect(dialog.getByLabel("业务信息一", { exact: true })).toHaveValue(
      draft
    );
    await setRole("operator", false);
    await refresh(dialog);
    await expect(
      dialog.getByRole("button", { name: "确认发起", exact: true })
    ).toBeEnabled();
    await expect(dialog.getByLabel("业务信息一", { exact: true })).toHaveValue(
      draft
    );
    let entered, release;
    const held = new Promise(resolve => {
      entered = resolve;
    });
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const holdRun = async route => {
      if (
        route.request().method() === "POST" &&
        route.request().url().includes("workflow.run")
      ) {
        entered();
        await gate;
      }
      await route.fallback();
    };
    await page.route("**/api/trpc/**", holdRun);
    const responseWait = page.waitForResponse(
      response =>
        response.url().includes("workflow.run") &&
        response.request().method() === "POST"
    );
    void responseWait.catch(() => {});
    await dialog.getByRole("button", { name: "确认发起", exact: true }).click();
    try {
      await Promise.race([
        held,
        sleep(15000).then(() => {
          throw new Error("Run request interception timed out");
        }),
      ]);
      await expect(
        dialog.getByLabel("业务信息一", { exact: true })
      ).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "取消", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
    } finally {
      release();
    }
    const response = await responseWait;
    assert.equal(response.status(), 200);
    const payload = await response.json();
    const result = Array.isArray(payload)
      ? payload.find(item => item.result?.data?.json?.runId)
      : payload;
    assert(result?.result?.data?.json?.runId);
    fixture.runs = [
      { id: result.result.data.json.runId, workflowId: control.id },
    ];
    saveFixture();
    const submitted = JSON.parse(response.request().postData());
    const requestInput =
      submitted.json ??
      Object.values(submitted).find(
        item => item?.json?.workflowId === control.id
      )?.json;
    assert.equal(requestInput.input.businessInformationOne, draft);
    await page.unroute("**/api/trpc/**", holdRun);
    await expect(dialog).toHaveCount(0);
    const run = await poll(
      "formal control run",
      () => owner("workflow.runDetail", { runId: fixture.runs[0].id }),
      item => ["waiting", "success"].includes(item.status)
    );
    assert.equal(run.workflowId, control.id);
    assert.equal(run.triggeredByUserId, fixture.disabledUserId);
    report({
      stage: "workflow-launch-draft",
      escapeProtected: true,
      revocationStoppedSubmit: true,
      restoredDraftSubmitted: true,
      busyInputsLocked: true,
      realRunAccepted: true,
    });
    await setRole("designer");
    rows = await viewer("project.workflows", projectInput);
    assert(
      rows.every(item => !item.actions.canRun && item.actions.canUnpublish)
    );
    await page.setViewportSize({ width: 390, height: 844 });
    for (const flow of fixture.workflows) {
      await expect(
        row(flow).getByRole("button", { name: /^(发起流程|执行数据流程)：/ })
      ).toHaveCount(0);
      await expect(
        row(flow).getByRole("button", {
          name: "查看画布：" + flow.name,
          exact: true,
        })
      ).toBeVisible();
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    await page.screenshot({
      path: path.join(directory, "workflow-actions-mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    report({
      stage: "project-workflow-actions",
      passed: true,
      browserErrors: 0,
      threeProfiles: true,
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

// Fixture setup confirms the role immediately before a sequential grant; UI conflict tests submit captured tokens.
async function roleSnapshotToken() {
  return (await owner("iam.customRoleConfiguration", { code: fixture.workflowRoleCode })).configToken;
}
