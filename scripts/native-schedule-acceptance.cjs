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
  let browser, page, input;
  let failed = false;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    assert(fixture?.projectId && fixture.workflows.length === 3);
    report({ stage: "fixture-created", tag, directory });
    report({
      output: (
        await remote({ action: "prepare_native_schedule", fixture, login })
      ).trim(),
    });
    const flow = fixture.workflows.find(item => item.flowType === "data");
    input = { projectId: fixture.projectId, workflowId: flow.id };
    await owner("auth.login", login, true);
    await viewer("auth.login", memberLogin, true);
    const list = () => owner("data.schedules", { projectId: input.projectId });
    const current = async () =>
      (await list()).find(item => item.workflowId === input.workflowId);
    const runs = () =>
      owner("data.runs", { ...input, summaryOnly: true, limit: 30 });
    await assert.rejects(
      viewer(
        "data.saveScheduleDraft",
        { ...input, cronExpression: "0 * * * * *" },
        true
      ),
      error => error.status === 403
    );
    assert.equal((await list()).length, 0);

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
    await page.locator('input[autocomplete="username"]').fill(login.username);
    await page.locator('input[type="password"]').fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(`${base}#/flows/project/${input.projectId}`);
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await page
      .locator("[data-resource-category-desktop]")
      .getByRole("button", { name: /^数据流/ })
      .click();
    await page
      .getByRole("navigation", { name: "数据流工作区视图" })
      .getByRole("button", { name: /^调度计划/ })
      .click();
    await page.getByLabel("已发布数据流").selectOption(input.workflowId);
    const cron = page.getByLabel("Cron 表达式（UTC）", { exact: true });
    const clickMutation = async (button, name) => {
      const response = page.waitForResponse(
        response =>
          response.url().includes(`data.${name}`) &&
          response.request().method() === "POST"
      );
      const [result] = await Promise.all([response, button.click()]);
      return result;
    };
    await page.getByLabel("快速填写计划（UTC）").selectOption("0 0 * * * *");
    await expect(cron).toHaveValue("0 0 * * * *");
    await cron.fill("0 0 25 * * *");
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "保存调度草稿", exact: true }),
          "saveScheduleDraft"
        )
      ).status(),
      400
    );
    await expect(cron).toHaveValue("0 0 25 * * *");
    await cron.fill("0 * * * * *");
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "保存调度草稿", exact: true }),
          "saveScheduleDraft"
        )
      ).status(),
      200
    );
    let schedule = await poll(
      "paused draft",
      current,
      item => item?.status === "paused"
    );
    assert.equal(schedule.schedulerType, "internal");
    assert.equal(schedule.revision, 1);
    assert.equal(schedule.nextRunAt, null);
    assert.equal(schedule.activationAvailable, true);
    await expect(
      page.getByRole("button", { name: "启用计划", exact: true })
    ).toBeEnabled();
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "启用计划", exact: true }),
          "activateSchedule"
        )
      ).status(),
      200
    );
    schedule = await poll(
      "active plan",
      current,
      item => item?.status === "active"
    );
    assert(schedule.nextRunAt.endsWith("Z"));
    await expect(
      page.getByRole("button", { name: "保存调度草稿", exact: true })
    ).toBeDisabled();
    report({
      stage: "plan-enabled",
      nextRunAt: schedule.nextRunAt,
      revision: schedule.revision,
      validationPreserved: true,
      presets: true,
      viewerDenied: true,
    });
    const notice = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "调度计划已启用" });
    await expect(notice).toBeVisible();
    assert.equal(
      await notice.evaluate(element => getComputedStyle(element).pointerEvents),
      "none"
    );
    const closeNotice = notice.getByRole("button", {
      name: "关闭提示",
      exact: true,
    });
    const closeBox = await closeNotice.boundingBox();
    assert(closeBox && closeBox.width >= 44 && closeBox.height >= 44);
    await closeNotice.click();
    report({
      stage: "toast-interaction",
      passiveBody: true,
      closeAvailable: true,
    });
    await page.screenshot({
      path: path.join(directory, "active-plan.png"),
      fullPage: true,
    });

    const completed = await poll(
      "real UTC worker trigger",
      runs,
      items =>
        items.some(
          item => item.triggerType === "schedule" && item.status === "success"
        ),
      95000
    );
    assert.equal(completed.length, 1);
    const detail = await owner("data.runDetail", {
      projectId: input.projectId,
      runId: completed[0].id,
    });
    assert.equal((await current()).lastRunId, detail.id);
    assert.equal(completed[0].triggeredByUserId, fixture.userId);
    assert.deepEqual(detail.output.terminals[0].rows, [
      { id: 1, amount: 120, status: "paid" },
    ]);
    report({
      stage: "run-observed-before-pause",
      runId: detail.id,
      status: detail.status,
    });
    fs.writeFileSync(
      path.join(directory, "before-pause.txt"),
      await page.locator("body").innerText(),
      "utf8"
    );
    await page.screenshot({
      path: path.join(directory, "before-pause.png"),
      fullPage: true,
    });
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "暂停计划", exact: true }),
          "pauseSchedule"
        )
      ).status(),
      200
    );
    schedule = await poll(
      "paused after execution",
      current,
      item => item?.status === "paused"
    );
    assert.equal(schedule.nextRunAt, null);
    const pauseObservationUntil = Math.ceil(Date.now() / 60000) * 60000 + 3000;
    report({
      stage: "real-trigger-completed",
      runId: detail.id,
      status: detail.status,
      rowCount: 1,
    });
    await assert.rejects(
      owner(
        "data.activateSchedule",
        { ...input, expectedRevision: schedule.revision - 1 },
        true
      ),
      error => error.status === 409
    );
    await assert.rejects(
      viewer(
        "data.activateSchedule",
        { ...input, expectedRevision: schedule.revision },
        true
      ),
      error => error.status === 403
    );
    const race = await Promise.allSettled(
      [0, 1].map(() =>
        owner(
          "data.activateSchedule",
          { ...input, expectedRevision: schedule.revision },
          true
        )
      )
    );
    assert.equal(race.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(
      race.find(item => item.status === "rejected").reason.status,
      409
    );
    schedule = await current();
    await owner(
      "data.pauseSchedule",
      { ...input, expectedRevision: schedule.revision },
      true
    );
    report({
      stage: "activation-race",
      singleWinner: true,
      staleRevisionDenied: true,
      nextObservation: new Date(pauseObservationUntil).toISOString(),
    });
    while (Date.now() < pauseObservationUntil) {
      assert.equal((await runs()).length, 1);
      await sleep(Math.min(2000, pauseObservationUntil - Date.now()));
    }
    assert.equal((await runs()).length, 1);
    report({ stage: "paused-next-boundary", noAdditionalRun: true });
    const refreshed = page.waitForResponse(
      response =>
        response.url().includes("data.schedules") &&
        response.request().method() === "GET"
    );
    await page.getByRole("button", { name: "刷新状态", exact: true }).click();
    await refreshed;
    await expect(
      page.getByRole("button", { name: "启用计划", exact: true })
    ).toBeVisible();
    await page
      .getByRole("button", { name: "删除计划 " + flow.name, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    schedule = await current();
    await owner(
      "data.saveScheduleDraft",
      {
        ...input,
        cronExpression: "0 */5 * * * *",
        expectedRevision: schedule.revision,
      },
      true
    );
    const backgroundRefresh = page.waitForResponse(
      response =>
        response.url().includes("data.schedules") &&
        response.request().method() === "GET"
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await backgroundRefresh;
    const staleDelete = await clickMutation(
      dialog.getByRole("button", { name: "确认删除", exact: true }),
      "deleteSchedule"
    );
    assert.equal(staleDelete.status(), 409);
    const deleteBody = staleDelete.request().postDataJSON();
    assert.equal(
      (deleteBody.json ?? deleteBody[0].json).expectedRevision,
      schedule.revision
    );
    await expect(dialog.getByRole("alert")).toContainText("调度已被更新");
    assert(await current());
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("button", { name: "读取最新计划并替换填写", exact: true })
      .click();
    await expect(cron).toHaveValue("0 */5 * * * *");
    await page.screenshot({
      path: path.join(directory, "schedule-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByText("配置调度计划", { exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "保存调度草稿", exact: true })
    ).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    await page.screenshot({
      path: path.join(directory, "schedule-mobile.png"),
      fullPage: true,
    });
    report({
      stage: "schedule-ui",
      desktopAndMobile: true,
      staleDeletePreserved: true,
      explicitReload: true,
    });
    await page
      .getByRole("button", { name: "删除计划 " + flow.name, exact: true })
      .click();
    assert.equal(
      (
        await clickMutation(
          dialog.getByRole("button", { name: "确认删除", exact: true }),
          "deleteSchedule"
        )
      ).status(),
      200
    );
    await poll("plan removed", list, items => items.length === 0);
    assert.equal(
      (
        await clickMutation(
          page.getByRole("button", { name: "保存调度草稿", exact: true }),
          "saveScheduleDraft"
        )
      ).status(),
      200
    );
    schedule = await current();
    assert.equal(schedule.status, "paused");
    await owner("workflow.delete", { id: input.workflowId }, true);
    await owner(
      "data.deleteSchedule",
      { ...input, expectedRevision: schedule.revision },
      true
    );
    assert.deepEqual(errors, []);
    report({
      stage: "native-schedule-acceptance",
      passed: true,
      recreatedAfterDelete: true,
      browserErrors: 0,
    });
  } catch (error) {
    failed = true;
    const message = [login.password, memberLogin.password].reduce(
      (text, secret) => text.replaceAll(secret, "[credential]"),
      error.stack ?? error.message
    );
    console.error(message);
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (fixture?.projectId) {
      try {
        report({
          output: (
            await remote({ action: "cleanup_native_schedule", fixture, login })
          ).trim(),
        });
      } catch (error) {
        failed = true;
        console.error("Schedule cleanup failed: " + error.message);
      }
    }
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
