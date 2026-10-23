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

const sqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-lifecycle-fixtures.mjs"),
  "utf8"
);
const creationSqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-creation-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const workflowWriteIntent=" +
    JSON.stringify({ action, fixture, ...extra }) +
    ";\n" +
    (action === "creation_receipts" ? creationSqlHelper : sqlHelper);
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
  if (!["hold_project", "hold_actor"].includes(action)) child.stdin.end();
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
  assert(/^(CREATE|DROP) TRIGGER flow_life_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("flow_life_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes("NEW.actorUserId IN") &&
        statement.includes(String(fixture.userId)) &&
        statement.includes(String(fixture.disabledUserId)) &&
        statement.includes("isolated_workflow_lifecycle_audit_rejected")
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
const sql = async (action, extra) => {
  const result = await sqlProcess(action, extra).done;
  if (!result.statement) return result;
  await rootFixtureStatement(result.statement);
  const state = await sqlProcess("audit_state").done;
  assert.equal(state.present, action === "fail_audit");
  return action === "fail_audit"
    ? { fixtureAuditFailureEnabled: true }
    : { fixtureAuditFailureRemoved: true };
};
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const baseline = process.env.FLOW_UI_WORKFLOW_CREATION_BASELINE === "1";
const track = workflow => {
  if (!fixture.workflows.some(row => row.id === workflow.id))
    fixture.workflows.push({
      id: workflow.id,
      name: workflow.name,
      flowType: "creation-check",
    });
  remember();
  return workflow;
};
async function receiptScenarios() {
  const sample = fixture.workflows.find(row => row.flowType === "control");
  for (const kind of ["global", "project", "duplicate"]) {
    const requestKey = randomBytes(24).toString("hex"),
      name = "回执_" + kind + "_" + tag;
    const method =
      kind === "global"
        ? "workflow.create"
        : kind === "project"
          ? "project.createWorkflow"
          : "workflow.duplicate";
    const input =
      kind === "global"
        ? { name, requestKey }
        : kind === "project"
          ? {
              projectId: fixture.projectId,
              processCode: "REC_" + tag.slice(9),
              name,
              flowType: "control",
              requestKey,
            }
          : { id: sample.id, name, requestKey };
    const results = await Promise.all([
      owner(method, input, true),
      owner(method, input, true),
      owner(method, input, true),
    ]);
    assert(results.every(row => row.id === results[0].id));
    track(results[0]);
    assert.equal((await owner(method, input, true)).id, results[0].id);
    await assert.rejects(
      owner(method, { ...input, name: "冲突_" + kind + "_" + tag }, true),
      error => error.status === 409
    );
    const receipts = (await sql("creation_receipts")).receipts.filter(
      row => row.workflowId === results[0].id
    );
    assert.equal(receipts.length, 1);
    assert.equal(Number(receipts[0].versions), 1);
    assert.equal(Number(receipts[0].audits), 1);
    await owner(
      "workflow.delete",
      {
        id: results[0].id,
        expectedDefinitionVersion: results[0].definitionVersion,
      },
      true
    );
    await assert.rejects(
      owner(method, input, true),
      error => error.status === 409
    );
    report({
      stage: "creation-receipt",
      kind,
      parallelSameId: true,
      singleVersionAndAudit: true,
      changedPayloadRejected: true,
      archivedReplayRejected: true,
    });
  }
  const before = await sql("creation_receipts"),
    flowsBefore = await sql("own_flows");
  await sql("fail_audit");
  try {
    await assert.rejects(
      owner(
        "workflow.create",
        {
          name: "事务故障_" + tag,
          requestKey: randomBytes(24).toString("hex"),
        },
        true
      )
    );
    assert.deepEqual(await sql("creation_receipts"), before);
    assert.deepEqual(await sql("own_flows"), flowsBefore);
  } finally {
    await sql("restore_audit");
  }
  await owner(
    "iam.updateUserStatus",
    { userId: fixture.disabledUserId, status: "active" },
    true
  );
  await grant();
  await viewer("auth.login", memberLogin, true);
  const capability = await viewer("workflow.operationAccess", {
    workflowId: sample.id,
  });
  assert.equal(capability.canCopy, true);
  assert.equal(capability.canArchive, false);
  const payload = {
    id: sample.id,
    name: "设计者副本_" + tag,
    requestKey: randomBytes(24).toString("hex"),
  };
  const copy = await viewer("workflow.duplicate", payload, true);
  assert.equal(copy.ownerUserId, fixture.disabledUserId);
  await revoke();
  await assert.rejects(
    viewer("workflow.duplicate", payload, true),
    error => error.status === 403
  );
  report({
    stage: "creation-authorization",
    designerCanCopy: true,
    designerCannotArchive: true,
    replayAfterRevocationRejected: true,
    auditFailureRolledBackWorkflowAndReceipt: true,
  });
}
async function creationUi(page, form) {
  const alert = page.getByRole("alertdialog");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(form.getByLabel("流程名称", { exact: true })).toHaveValue(
    "未提交创建_" + tag
  );
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await alert
    .getByRole("button", { name: "已核对，放弃填写", exact: true })
    .click();
  await expect(form).toBeHidden();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [320, 390, 1024, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "新增流程", exact: true }).click();
    form = page.getByRole("dialog", { name: "新增流程", exact: true });
    await expect(
      form.getByRole("button", { name: "创建并设计", exact: true })
    ).toBeEnabled();
    await form
      .getByLabel("流程名称", { exact: true })
      .fill("界面创建_" + width + "_" + tag);
    await form
      .getByLabel("流程代号", { exact: true })
      .fill("UI_" + width + "_" + tag.slice(9));
    await form
      .getByLabel("流程类型", { exact: true })
      .selectOption(
        width === 320 ? "data" : width === 390 ? "control" : "state"
      );
    const geometry = await form.evaluate(el => ({
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      overflow: el.scrollWidth > el.clientWidth + 1,
      font: getComputedStyle(el.querySelector("label")).fontSize,
    }));
    assert(
      geometry.left >= 0 && geometry.right <= width + 1 && !geometry.overflow
    );
    assert.equal(geometry.font, "14px");
    await page.screenshot({
      path: path.join(directory, "workflow-create-" + width + ".png"),
      animations: "disabled",
    });
    if (width !== 1920) {
      await form.getByRole("button", { name: "取消", exact: true }).click();
      await alert
        .getByRole("button", { name: "已核对，放弃填写", exact: true })
        .click();
      continue;
    }
    let release,
      committed,
      posts = 0,
      firstKey;
    const gate = new Promise(resolve => (release = resolve));
    const intercept = async route => {
      if (
        !route.request().url().includes("project.createWorkflow") ||
        route.request().method() !== "POST"
      )
        return route.continue();
      posts++;
      const body = JSON.parse(route.request().postData());
      firstKey = (body[0] ?? body).json.requestKey;
      const response = await route.fetch();
      const payload = await response.json();
      const entry = Array.isArray(payload) ? payload[0] : payload;
      assert(!entry.error);
      committed = entry.result.data.json;
      track(committed);
      await gate;
      await route.abort("failed");
    };
    await page.route("**/api/trpc/**", intercept);
    await form.getByRole("button", { name: "创建并设计", exact: true }).click();
    try {
      await expect.poll(() => Boolean(committed)).toBe(true);
      await expect(form.getByLabel("流程名称", { exact: true })).toBeDisabled();
      await expect(
        form.getByRole("button", { name: "取消", exact: true })
      ).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(form).toBeVisible();
      assert.equal(posts, 1);
    } finally {
      release();
    }
    await expect(
      form.getByText(
        "上次创建结果尚未确认。填写已锁定；重试将核对同一次提交，不会重复创建。",
        { exact: true }
      )
    ).toBeVisible();
    await page.unroute("**/api/trpc/**", intercept);
    const capture = request => {
      if (
        request.url().includes("project.createWorkflow") &&
        request.method() === "POST"
      ) {
        posts++;
        const body = JSON.parse(request.postData());
        assert.equal((body[0] ?? body).json.requestKey, firstKey);
      }
    };
    page.on("request", capture);
    await form
      .getByRole("button", { name: "重试并核对结果", exact: true })
      .click();
    await expect(form).toBeHidden();
    await expect(page.locator("[data-workflow-editor]")).toBeVisible();
    page.off("request", capture);
    assert.equal(posts, 2);
    const receipts = (await sql("creation_receipts")).receipts.filter(
      row => row.workflowId === committed.id
    );
    assert.equal(receipts.length, 1);
    assert.equal(Number(receipts[0].audits), 1);
    report({
      stage: "creation-ui",
      widths: [320, 390, 1024, 1920],
      dirtyCloseProtected: true,
      busyEscapeAndFieldsLocked: true,
      responseLossRecoveredOriginalRequest: true,
      singleCreatedWorkflow: true,
    });
  }
  const sample = fixture.workflows.find(row => row.flowType === "control");
  await page.goto(base + "#/flows/workflow/" + sample.id + "/editor");
  await expect(page.locator("[data-workflow-editor]")).toBeVisible();
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "创建副本", exact: true }).click();
  const copyForm = page.getByRole("dialog", {
    name: "创建流程副本",
    exact: true,
  });
  await expect(
    copyForm.getByRole("button", { name: "创建副本", exact: true })
  ).toBeEnabled();
  await copyForm
    .getByLabel("流程名称", { exact: true })
    .fill("窗口副本_" + tag);
  const old = await owner("workflow.get", { id: sample.id });
  await owner(
    "workflow.update",
    {
      id: sample.id,
      definition: old.definition,
      name: "更新来源_" + tag,
      expectedDefinitionVersion: old.definitionVersion,
    },
    true
  );
  sample.name = "更新来源_" + tag;
  remember();
  await copyForm
    .getByRole("button", { name: "重新读取权限与来源", exact: true })
    .click();
  await expect(copyForm.getByText(/源流程已变化/)).toBeVisible();
  await expect(
    copyForm.getByRole("button", { name: "创建副本", exact: true })
  ).toBeDisabled();
  await copyForm
    .getByRole("button", { name: "确认使用当前保存版本", exact: true })
    .click();
  await expect(copyForm.getByLabel("流程名称", { exact: true })).toHaveValue(
    "窗口副本_" + tag
  );
  const done = page.waitForResponse(
    response =>
      response.url().includes("workflow.duplicate") &&
      response.request().method() === "POST"
  );
  await copyForm.getByRole("button", { name: "创建副本", exact: true }).click();
  const response = await done;
  const payload = await response.json();
  const copied = track(
    (Array.isArray(payload) ? payload[0] : payload).result.data.json
  );
  await expect(copyForm).toBeHidden();
  await expect(page.getByLabel("流程名称", { exact: true })).toHaveValue(
    copied.name
  );
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "归档至流程仓库", exact: true })
    .click();
  const archive = page.getByRole("dialog", { name: "归档流程", exact: true });
  await expect(
    archive.getByRole("button", { name: "确认归档", exact: true })
  ).toBeEnabled();
  let archivedOnServer = false,
    releaseArchive,
    archivePosts = 0;
  const archiveGate = new Promise(resolve => (releaseArchive = resolve));
  const loseArchiveAck = async route => {
    if (
      !route.request().url().includes("workflow.delete") ||
      route.request().method() !== "POST"
    )
      return route.continue();
    archivePosts++;
    const response = await route.fetch();
    assert(response.ok());
    archivedOnServer = true;
    await archiveGate;
    await route.abort("failed");
  };
  await page.route("**/api/trpc/**", loseArchiveAck);
  await archive.getByRole("button", { name: "确认归档", exact: true }).click();
  try {
    await expect.poll(() => archivedOnServer).toBe(true);
    await expect(
      archive.getByRole("button", { name: "取消", exact: true })
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(archive).toBeVisible();
    assert.equal(archivePosts, 1);
  } finally {
    releaseArchive();
  }
  await expect(
    archive.getByRole("button", { name: "重新读取权限与归档结果", exact: true })
  ).toBeEnabled();
  await page.unroute("**/api/trpc/**", loseArchiveAck);
  await archive
    .getByRole("button", { name: "重新读取权限与归档结果", exact: true })
    .click();
  await expect(
    archive.getByRole("button", { name: "已核对，完成归档", exact: true })
  ).toBeEnabled();
  await archive
    .getByRole("button", { name: "已核对，完成归档", exact: true })
    .click();
  assert.equal(archivePosts, 1);
  await expect(archive).toBeHidden();
  assert((await owner("workflow.get", { id: copied.id })).archivedAt);
  assert.deepEqual(errors, []);
  report({
    stage: "copy-archive-ui",
    sourceChangeRequiresConfirmation: true,
    customCopyNamePreserved: true,
    archiveCompleted: true,
    archiveResponseLossRecoveredWithoutSecondWrite: true,
    browserErrors: 0,
  });
}
async function designerUi(browser) {
  await grant();
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
    serviceWorkers: "block",
  });
  await context.route("**/*", route =>
    route.request().url().startsWith(base) ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    const sample = fixture.workflows.find(row => row.flowType === "control");
    await page.goto(base + "#/flows");
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(page.locator("[data-aiflow-business-center]")).toBeVisible();
    await page.goto(base + "#/flows/workflow/" + sample.id + "/editor");
    await expect(page.locator("[data-workflow-editor]")).toBeVisible();
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "归档至流程仓库", exact: true })
    ).toHaveCount(0);
    await page.getByRole("menuitem", { name: "创建副本", exact: true }).click();
    const form = page.getByRole("dialog", {
      name: "创建流程副本",
      exact: true,
    });
    await expect(
      form.getByRole("button", { name: "创建副本", exact: true })
    ).toBeEnabled();
    await form.getByLabel("流程名称", { exact: true }).fill("权限保留_" + tag);
    await revoke();
    await form
      .getByRole("button", { name: "重新读取权限与来源", exact: true })
      .click();
    await expect(form.getByLabel("流程名称", { exact: true })).toBeHidden();
    await expect(
      form.getByRole("button", { name: "创建副本", exact: true })
    ).toBeDisabled();
    await expect(form.getByText(/复制来源：/)).toHaveCount(0);
    await grant();
    await form
      .getByRole("button", { name: "重新读取权限与来源", exact: true })
      .click();
    await expect(form.getByLabel("流程名称", { exact: true })).toHaveValue(
      "权限保留_" + tag
    );
    await expect(
      form.getByRole("button", { name: "创建副本", exact: true })
    ).toBeEnabled();
    await form.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "已核对，放弃填写", exact: true })
      .click();
    report({
      stage: "designer-copy-ui",
      copyVisibleWithoutManagePermission: true,
      archiveHidden: true,
      viewLossHidesSourceCache: true,
      typedNameRestoredAfterPermissionRecovery: true,
    });
  } finally {
    await context.close();
    await revoke();
  }
}
(async () => {
  let browser,
    failed = false,
    fingerprint;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await owner("auth.login", login, true);
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    const folder = await owner(
      "project.createFolder",
      { projectId: fixture.projectId, name: "复制隔离目录_" + tag },
      true
    );
    const resources = await owner("data.resources", {
      projectId: fixture.projectId,
    });
    assert(resources.sources.length);
    for (const type of ["state", "control", "data"]) {
      const sample = fixture.workflows.find(row => row.flowType === type);
      const definition = (await owner("workflow.get", { id: sample.id }))
        .definition;
      const source = await owner(
        "project.createWorkflow",
        {
          projectId: fixture.projectId,
          processCode: "COPY_" + type.toUpperCase() + "_" + tag.slice(9),
          name: "复制来源_" + type + "_" + tag,
          flowType: type,
          folderId: folder.id,
          dataSourceId: type === "data" ? resources.sources[0].id : null,
          definition,
        },
        true
      );
      fixture.workflows.push({
        id: source.id,
        name: source.name,
        flowType: "copy-source",
      });
      remember();
      const copy = await owner(
        "workflow.duplicate",
        {
          id: source.id,
          name: "复制结果_" + type + "_" + tag,
          expectedDefinitionVersion: source.definitionVersion,
        },
        true
      );
      fixture.workflows.push({
        id: copy.id,
        name: copy.name,
        flowType: "copy-result",
      });
      remember();
      if (baseline) {
        assert.equal(copy.folderId, null);
        assert.equal(copy.processCode, null);
        if (type === "data") assert.equal(copy.dataSourceId, null);
      } else {
        assert.equal(copy.folderId, folder.id);
        assert.match(copy.processCode, /^[A-Z][A-Z0-9_-]{1,63}$/);
        assert.equal(copy.dataSourceId, source.dataSourceId);
        assert.deepEqual(copy.definition, source.definition);
      }
      report({
        flowType: type,
        copyMetadataComplete: !baseline,
        folderPreserved: copy.folderId === source.folderId,
        codeAssigned: Boolean(copy.processCode),
        dataSourcePreserved: copy.dataSourceId === source.dataSourceId,
      });
    }
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
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + "#/flows", { waitUntil: "domcontentloaded" });
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(page.locator("[data-aiflow-business-center]")).toBeVisible({
      timeout: 20000,
    });
    await page.goto(base + "#/flows/project/" + fixture.projectId);
    await page.getByRole("button", { name: "新增流程", exact: true }).click();
    let form = page.getByRole("dialog", { name: "新增流程", exact: true });
    await form
      .getByLabel("流程代号", { exact: true })
      .fill("DRAFT_" + tag.slice(9));
    await form
      .getByLabel("流程名称", { exact: true })
      .fill("未提交创建_" + tag);
    await form.getByRole("button", { name: "取消", exact: true }).click();
    if (baseline) {
      await expect(form).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "返回业务中心", exact: true })
        .click();
      await expect(page.locator("[data-aiflow-business-center]")).toBeVisible();
      await page.goto(base + "#/flows/project/" + fixture.projectId);
      await page.getByRole("button", { name: "新增流程", exact: true }).click();
      await expect(form.getByLabel("流程名称", { exact: true })).toHaveValue(
        ""
      );
      report({
        baseline: true,
        closeUnconfirmed: true,
        workspaceUnmountLostCreationDraft: true,
      });
    } else {
      await creationUi(page, form);
      await receiptScenarios();
      await designerUi(browser);
    }
    report({ workflowCreation: true, baseline, passed: true, tag });
  } catch (error) {
    failed = true;
    console.error(error.stack ?? error.message);
  } finally {
    await browser?.close();
    if (fixture)
      try {
        if (!baseline) {
          await sql("restore_audit");
          for (const flow of (await sql("own_flows")).flows) {
            assert(flow.name.endsWith(tag));
            assert(
              [fixture.userId, fixture.disabledUserId].includes(
                Number(flow.ownerUserId)
              )
            );
            if (Number(flow.ownerUserId) === fixture.userId) track(flow);
            else if (!flow.archivedAt)
              await owner(
                "workflow.delete",
                {
                  id: flow.id,
                  expectedDefinitionVersion: flow.definitionVersion,
                },
                true
              );
          }
        }
        if (fingerprint)
          assert.equal(
            (await remote({ action: "settings_fingerprint" })).trim(),
            fingerprint
          );
        report({
          output: (await remote({ action: "cleanup", fixture, login })).trim(),
        });
      } catch (error) {
        failed = true;
        console.error("Cleanup failed: " + error.stack);
      }
    process.exitCode = failed ? 1 : 0;
  }
})();
