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
const sqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-info-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const workflowInfoIntent=" +
    JSON.stringify({ action, fixture, ...extra }) +
    ";\n" +
    sqlHelper;
  const encoded = Buffer.from(code).toString("base64");
  const command =
    "sudo -n docker exec -i flow-ai-engine-app-1 node --input-type=module -e \"await import('data:text/javascript;base64," +
    encoded +
    "').catch(error=>{console.error(error.code+': '+error.message);process.exitCode=1})\"";
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
      command,
    ],
    { windowsHide: true }
  );
  let stdout = "",
    stderr = "",
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        try {
          const value = JSON.parse(line);
          if (value.barrierReady) readyResolve(value);
        } catch {}
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", error => {
      readyReject(error);
      reject(error);
    });
    child.on("close", status => {
      if (status !== 0) {
        const error = new Error(
          "Fixture SQL " + action + " failed: " + stderr.slice(-1500)
        );
        readyReject(error);
        reject(error);
      } else {
        const result = JSON.parse(stdout.trim().split("\n").at(-1));
        readyResolve(result);
        resolve(result);
      }
    });
  });
  done.catch(() => {});
  if (!action.startsWith("hold_")) child.stdin.end();
  return {
    ready,
    done,
    release: async () => {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      return done;
    },
  };
}
function rootFixtureStatement(statement) {
  assert(/^(CREATE|DROP) TRIGGER flow_write_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("flow_write_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      fixture.workflows.every(flow => statement.includes(flow.id)) &&
        statement.includes("isolated_workflow_audit_rejected")
    );
  return new Promise((resolve, reject) => {
    // The existing container supplies its own admin credential; never read or print it.
    const command = `sudo -n docker exec -i flow-ai-engine-mysql-1 sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --skip-column-names "$MYSQL_DATABASE"'`;
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
        command,
      ],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", code =>
      code === 0
        ? resolve()
        : reject(new Error("Scoped fixture trigger failed: " + stderr))
    );
    child.stdin.end("DELIMITER $$\n" + statement + "$$\nDELIMITER ;\n");
  });
}
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const sql = async (action, extra = {}) => {
  const result = await sqlProcess(action, extra).done;
  if (result.statement) await rootFixtureStatement(result.statement);
  return result;
};
const snap = flow => sql("snapshot", { workflowId: flow.id });
const stable = row =>
  Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => !["name", "description", "infoAudits"].includes(key)
    )
  );
(async () => {
  let browser,
    page,
    fingerprint,
    failed = false;
  const member = session(),
    errors = [];
  const latest = flow => owner("workflow.get", { id: flow.id });
  const payload = async (flow, name, description = "基本信息真实验收") => ({
    projectId: fixture.projectId,
    workflowId: flow.id,
    name,
    description,
    expectedConfigToken: (await latest(flow)).infoConfigToken,
  });
  const syncNames = async () => {
    for (const flow of fixture.workflows) {
      const current = await latest(flow);
      assert(current.name.endsWith(tag));
      flow.name = current.name;
    }
    remember();
  };
  try {
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    await sql("activate");
    await owner(
      "project.grantMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        role: "designer",
      },
      true
    );
    await member("auth.login", memberLogin, true);
    for (const flow of fixture.workflows) {
      const before = await snap(flow),
        input = await payload(
          flow,
          "基本信息_" + flow.flowType + "_" + tag,
          "分级办理说明\n只更新名称和说明"
        );
      const missing = { ...input };
      delete missing.expectedConfigToken;
      await assert.rejects(
        member("project.updateWorkflowInfo", missing, true),
        e => e.status === 412
      );
      await member("project.updateWorkflowInfo", input, true);
      const after = await snap(flow);
      assert.deepEqual(stable(after), stable(before));
      assert.equal(Number(after.infoAudits), Number(before.infoAudits) + 1);
      await member("project.updateWorkflowInfo", input, true);
      assert.deepEqual(await snap(flow), after);
      await assert.rejects(
        member(
          "project.updateWorkflowInfo",
          { ...input, name: "不能覆盖_" + tag },
          true
        ),
        e => e.status === 409
      );
      assert.deepEqual(await snap(flow), after);
      await syncNames();
    }
    report({
      stage: "info-api",
      threeTypes: true,
      missingSnapshotRejected: true,
      staleSnapshotRejected: true,
      lostAckReplayNoExtraAudit: true,
      definitionsAndVersionsUnchanged: true,
    });
    const flow = fixture.workflows[0],
      heldInput = await payload(flow, "等待后不能覆盖_" + tag),
      heldName = "锁定期间他人修改_" + tag;
    let barrier = sqlProcess("hold_workflow", {
      workflowId: flow.id,
      name: heldName,
    });
    await barrier.ready;
    const waiting = member("project.updateWorkflowInfo", heldInput, true).then(
      () => ({ ok: true }),
      e => ({ ok: false, status: e.status })
    );
    await poll(
      "real workflow row wait",
      () => sql("waiter", { workflowId: flow.id }),
      v => v.waiting
    );
    await barrier.release();
    assert.deepEqual(await waiting, { ok: false, status: 409 });
    assert.equal((await latest(flow)).name, heldName);
    await syncNames();
    const deniedInput = await payload(flow, "失权后不能修改_" + tag),
      beforeDenied = await snap(flow);
    barrier = sqlProcess("hold_project_revoke", { workflowId: flow.id });
    await barrier.ready;
    const denied = member("project.updateWorkflowInfo", deniedInput, true).then(
      () => ({ ok: true }),
      e => ({ ok: false, status: e.status })
    );
    await poll(
      "real project row wait",
      () => sql("waiter", { workflowId: flow.id }),
      v => v.waiting
    );
    await barrier.release();
    assert.deepEqual(await denied, { ok: false, status: 403 });
    assert.deepEqual(await snap(flow), beforeDenied);
    await owner(
      "project.grantMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        role: "designer",
      },
      true
    );
    report({
      stage: "info-locks",
      observedWorkflowSqlWait: true,
      changedSnapshot409: true,
      observedProjectSqlWait: true,
      revokedEditor403: true,
    });
    await sql("fail_audit");
    try {
      for (const target of fixture.workflows) {
        const before = await snap(target);
        await assert.rejects(
          member(
            "project.updateWorkflowInfo",
            await payload(target, "审计失败不应保存_" + tag),
            true
          ),
          e => e.status === 500
        );
        assert.deepEqual(await snap(target), before);
      }
    } finally {
      await sql("restore_audit");
    }
    const concurrent = await payload(flow, "并发第一份_" + tag),
      beforeConcurrent = await snap(flow);
    const outcomes = await Promise.allSettled([
      member("project.updateWorkflowInfo", concurrent, true),
      owner(
        "project.updateWorkflowInfo",
        { ...concurrent, name: "并发第二份_" + tag },
        true
      ),
    ]);
    assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
    assert.equal(
      outcomes.filter(x => x.status === "rejected" && x.reason.status === 409)
        .length,
      1
    );
    assert.equal(
      Number((await snap(flow)).infoAudits),
      Number(beforeConcurrent.infoAudits) + 1
    );
    await syncNames();
    const data = fixture.workflows.find(x => x.flowType === "data");
    await remote({
      action: "prepare_native_schedule",
      fixture,
      login,
      reviewOnly: true,
    });
    let published = await latest(data);
    await owner(
      "workflow.publish",
      { id: data.id, expectedDefinitionVersion: published.definitionVersion },
      true
    );
    const beforePublished = await snap(data);
    await member(
      "project.updateWorkflowInfo",
      await payload(data, "已发布信息更新_" + tag),
      true
    );
    assert.deepEqual(stable(await snap(data)), stable(beforePublished));
    await syncNames();
    report({
      stage: "info-transactions",
      auditRollbackTypes: 3,
      concurrentWinner: 1,
      publishedDefinitionAndReviewUnchanged: true,
    });
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(base + "#/flows/workflow/" + flow.id + "/detail");
    const open = page.getByRole("button", {
      name: "编辑基本信息",
      exact: true,
    });
    await expect(open).toBeEnabled();
    await open.click();
    const dialog = () =>
      page.getByRole("dialog", { name: "编辑流程基本信息", exact: true });
    await expect(dialog()).toBeVisible();
    const nameInput = () => dialog().getByLabel("流程名称", { exact: true }),
      descriptionInput = () => dialog().getByLabel("流程说明", { exact: true }),
      save = () =>
        dialog().getByRole("button", { name: "保存基本信息", exact: true });
    const draftName = "浏览器保留填写_" + tag;
    await nameInput().fill(draftName);
    await descriptionInput().fill("当前填写不能被后台读取覆盖");
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await dialog().evaluate(el => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          width: innerWidth,
          overflow: el.scrollWidth > el.clientWidth + 1,
          title: getComputedStyle(el.querySelector("h2")).fontSize,
          input: getComputedStyle(el.querySelector("input")).fontSize,
        };
      });
      assert(
        metrics.left >= -1 && metrics.right <= width + 1 && !metrics.overflow
      );
      assert.equal(metrics.title, "18px");
      assert.equal(metrics.input, "14px");
    }
    await page.screenshot({
      path: path.join(directory, "workflow-info-form.png"),
    });
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    const closing = page.getByRole("alertdialog");
    await expect(closing).toBeVisible();
    await closing
      .getByRole("button", { name: "继续填写", exact: true })
      .click();
    await expect(nameInput()).toHaveValue(draftName);
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await closing
      .getByRole("button", { name: "暂存并关闭", exact: true })
      .click();
    await expect(dialog()).toBeHidden();
    await open.click();
    await expect(nameInput()).toHaveValue(draftName);
    await owner(
      "project.updateWorkflowInfo",
      await payload(flow, "浏览器期间他人修改_" + tag),
      true
    );
    await syncNames();
    await dialog()
      .getByRole("button", { name: "读取并核对当前信息", exact: true })
      .click();
    await expect(save()).toBeDisabled();
    await expect(nameInput()).toHaveValue(draftName);
    await dialog()
      .getByRole("button", {
        name: "已核对，保留填写并以当前信息为准",
        exact: true,
      })
      .click();
    await expect(save()).toBeEnabled();
    await save().click();
    await expect(dialog()).toBeHidden();
    assert.equal((await latest(flow)).name, draftName);
    await syncNames();
    report({
      stage: "info-ui",
      widths: [320, 390, 1024, 1440],
      retainedDraft: true,
      explicitReconfirmation: true,
      titlePx: 18,
      inputPx: 14,
    });
    await expect(open).toBeEnabled();
    await open.click();
    const ackName = "丢失保存响应_" + tag;
    await nameInput().fill(ackName);
    const beforeAck = await snap(flow);
    await page.route(
      "**/api/trpc/project.updateWorkflowInfo*",
      async route => {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("failed");
      },
      { times: 1 }
    );
    await save().click();
    await expect(dialog().getByRole("alert")).toBeVisible();
    await expect(nameInput()).toBeDisabled();
    await expect(save()).toBeDisabled();
    await dialog()
      .getByRole("button", { name: "读取并核对当前信息", exact: true })
      .click();
    await expect(dialog()).toBeHidden();
    assert.equal((await latest(flow)).name, ackName);
    assert.equal(
      Number((await snap(flow)).infoAudits),
      Number(beforeAck.infoAudits) + 1
    );
    await syncNames();
    await expect(open).toBeEnabled();
    await open.click();
    const notSent = "请求未送达后重试_" + tag;
    await nameInput().fill(notSent);
    await page.route(
      "**/api/trpc/project.updateWorkflowInfo*",
      route => route.abort("failed"),
      { times: 1 }
    );
    await save().click();
    await expect(nameInput()).toBeDisabled();
    await dialog()
      .getByRole("button", { name: "读取并核对当前信息", exact: true })
      .click();
    await expect(dialog()).toBeVisible();
    await expect(nameInput()).toHaveValue(notSent);
    await dialog()
      .getByRole("button", {
        name: "已核对，保留填写并以当前信息为准",
        exact: true,
      })
      .click();
    await save().click();
    await expect(dialog()).toBeHidden();
    assert.equal((await latest(flow)).name, notSent);
    await syncNames();
    await expect(open).toBeEnabled();
    await open.click();
    await nameInput().fill("进行中保护_" + tag);
    await page.route(
      "**/api/trpc/project.updateWorkflowInfo*",
      async route => {
        await sleep(1500);
        await route.continue();
      },
      { times: 1 }
    );
    await save().click();
    await expect(nameInput()).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeVisible();
    await expect(
      dialog().getByRole("button", { name: "取消", exact: true })
    ).toBeDisabled();
    await expect(dialog()).toBeHidden();
    await syncNames();
    report({
      stage: "info-recovery",
      acknowledgedLostResponseReconciledWithoutRewrite: true,
      unsentRequestExplicitlyReconfirmed: true,
      busyCloseAndInputsLocked: true,
      pageErrors: errors.length,
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    failed = true;
    console.error(error.stack || String(error));
    if (page)
      await page
        .screenshot({ path: path.join(directory, "failure.png") })
        .catch(() => {});
  } finally {
    if (fixture) {
      try {
        await sql("restore_audit");
        await owner("auth.login", login, true);
        await syncNames();
        report(
          JSON.parse(
            (await remote({ action: "cleanup", fixture, login }))
              .trim()
              .split("\n")
              .at(-1)
          )
        );
      } catch (error) {
        failed = true;
        console.error("Cleanup: " + error.message);
      }
    }
    if (fingerprint) {
      try {
        assert.equal(
          (await remote({ action: "settings_fingerprint" })).trim(),
          fingerprint
        );
      } catch (error) {
        failed = true;
        console.error("Settings changed: " + error.message);
      }
    }
    if (browser) await browser.close();
  }
  if (failed) process.exitCode = 1;
})();
