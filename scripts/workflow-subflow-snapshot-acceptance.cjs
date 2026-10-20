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
const helper =
  fs
    .readFileSync(path.join(__dirname, "browser-config-fixtures.mjs"), "utf8")
    .replace(
      'else throw new Error("Unknown fixture action");',
      'else if (browserFixtureIntent.action !== "prepare_legacy_subflow") throw new Error("Unknown fixture action");'
    ) +
  String.raw`
if (browserFixtureIntent.action === "prepare_legacy_subflow") {
  const intent = browserFixtureIntent, fixture = intent.fixture;
  assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
  const own = fixture.workflows.find(item => item.id === intent.workflowId);
  assert(own && own.name.endsWith(fixture.tag));
  const { default: mysql } = await import("mysql2/promise");
  const pool = mysql.createPool(process.env.DATABASE_URL);
  try {
    const [rows] = await pool.query("SELECT id,ownerUserId,projectId,name,status,definitionJson,definitionVersion FROM workflow WHERE id=?", [own.id]);
    const row = rows[0];
    assert.equal(row.ownerUserId, fixture.userId); assert.equal(row.projectId, fixture.projectId); assert.equal(row.name, own.name); assert.equal(row.status, "draft");
    const [children] = await pool.query("SELECT ownerUserId,name FROM workflow_subflow WHERE id=?", [intent.childId]);
    assert.equal(children[0]?.ownerUserId, fixture.userId); assert(children[0].name.endsWith(fixture.tag));
    const definition = typeof row.definitionJson === "string" ? JSON.parse(row.definitionJson) : row.definitionJson;
    const child = definition.nodes.find(item => item.id === "child");
    assert.equal(child.config.subflowId, intent.childId);
    for (const key of ["resolvedSubflowId", "resolvedSubflowDefinition", "resolvedSubflowName", "resolvedSubflowUpdatedAt"]) delete child.config[key];
    const [result] = await pool.query("UPDATE workflow SET definitionJson=?,definitionVersion=definitionVersion+1,auditStatus='init',updatedAt=NOW() WHERE id=? AND ownerUserId=? AND definitionVersion=? AND status='draft'", [JSON.stringify(definition), own.id, fixture.userId, row.definitionVersion]);
    assert.equal(result.affectedRows, 1); console.log(JSON.stringify({ legacyFixtureReady: true }));
  } finally { await pool.end(); }
}
`;
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

const children = [];
const get = id => owner("workflow.get", { id });
const node = (id, type, config = {}, x = 0) => ({
  id,
  type,
  name: id,
  position: { x, y: 120 },
  config,
});
const graph = nodes => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes,
  edges: nodes.slice(0, -1).map((item, index) => ({
    id: "edge-" + index,
    sourceNodeId: item.id,
    targetNodeId: nodes[index + 1].id,
    sourceHandle: "default",
  })),
});
const states = flowType =>
  flowType === "state"
    ? [
        node(
          "initial",
          "state",
          {
            stateCode: "INITIAL",
            displayName: "已开始",
            stateType: "business",
          },
          100
        ),
      ]
    : [];
const terminal = flowType =>
  flowType === "state"
    ? [
        node(
          "terminal",
          "state",
          {
            stateCode: "TERMINAL",
            displayName: "已完成",
            stateType: "business",
          },
          400
        ),
      ]
    : [];
const childDefinition = (value, flowType = "control") =>
  graph([
    node("start", "start"),
    ...states(flowType),
    ...terminal(flowType),
    node("end", "end", { resultTemplate: value }, 600),
  ]);
const parentDefinition = (childId, flowType = "control") =>
  graph([
    node("start", "start"),
    ...states(flowType),
    node("child", "subflow", { subflowId: childId, input: "{{input}}" }, 260),
    ...terminal(flowType),
    node(
      "end",
      "end",
      { resultTemplate: "{{nodes.child.result.result}}" },
      520
    ),
  ]);
const childSnapshot = flow =>
  flow.definition.nodes.find(item => item.id === "child").config
    .resolvedSubflowDefinition;
const snapshotValue = flow =>
  childSnapshot(flow)?.nodes.find(item => item.id === "end").config
    .resultTemplate;
async function approve(flow) {
  return viewer(
    "project.auditWorkflow",
    {
      projectId: fixture.projectId,
      workflowId: flow.id,
      auditStatus: "approved",
      expectedDefinitionVersion: Number(flow.definitionVersion),
      expectedAuditStatus: flow.auditStatus,
    },
    true
  );
}
async function publish(flow) {
  return owner(
    "workflow.publish",
    { id: flow.id, expectedDefinitionVersion: Number(flow.definitionVersion) },
    true
  );
}
async function runPublished(flow, value) {
  const result = await owner(
    "workflow.run",
    {
      workflowId: flow.id,
      input: {},
      idempotencyKey: tag + "_" + randomBytes(4).toString("hex"),
    },
    true
  );
  fixture.runs ??= [];
  fixture.runs.push({ id: result.runId, workflowId: flow.id });
  const detail = await poll(
    "isolated subflow run",
    () => owner("workflow.runDetail", { runId: result.runId }),
    row => ["success", "failed", "cancelled", "terminated"].includes(row.status)
  );
  assert.equal(detail.status, "success");
  assert.equal(detail.executionSource, "published_plan");
  assert.equal(
    Number(detail.definitionVersion),
    Number(flow.definitionVersion)
  );
  const output =
    typeof detail.finalOutputJson === "string"
      ? JSON.parse(detail.finalOutputJson)
      : detail.finalOutputJson;
  assert.equal(output.result, value);
}

async function verify(page) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const required = Boolean(
    (await owner("config.settings")).approval.requireProjectApproval
  );
  for (const flow of fixture.workflows.filter(
    item => item.flowType !== "data"
  )) {
    const type = flow.flowType;
    const created = await owner(
      "workflow.createSubflow",
      {
        name: "快照一致性_" + type + "_" + tag,
        flowType: type,
        definition: childDefinition("审核过的A", type),
      },
      true
    );
    children.push(created.id);
    let current = await get(flow.id);
    current = await owner(
      "workflow.update",
      {
        id: flow.id,
        definition: parentDefinition(created.id, type),
        expectedDefinitionVersion: Number(current.definitionVersion),
      },
      true
    );
    const reproduction = process.env.FLOW_UI_SUBFLOW_REPRO === "1";
    if (!reproduction)
      assert.equal(
        snapshotValue(current),
        "审核过的A",
        "saving must capture the child before review"
      );
    await approve(current);
    await owner(
      "workflow.updateSubflow",
      { id: created.id, definition: childDefinition("未审核的B", type) },
      true
    );
    await page.goto(base + "#/flows/project/" + fixture.projectId);
    await page
      .getByRole("button", {
        name: "更多信息与操作：" + flow.name,
        exact: true,
      })
      .click();
    const response = page.waitForResponse(
      r =>
        r.url().includes("workflow.publish") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "发布流程", exact: true }).click();
    const actual = await response;
    assert.equal(actual.status(), 200);
    const raw = actual.request().postDataJSON(),
      input = raw.json ?? raw["0"]?.json;
    assert.equal(input.definition, undefined);
    current = await get(flow.id);
    if (reproduction) {
      assert.equal(snapshotValue(current), "未审核的B");
      await runPublished(current, "未审核的B");
      report({
        stage: "subflow-review-reproduction",
        flowType: type,
        libraryChangedAfterReview: true,
        omittedDefinitionPublishReplacedReviewedContent: true,
        runtimeExecutedUnreviewedChild: true,
      });
      continue;
    }
    assert.equal(snapshotValue(current), "审核过的A");
    await runPublished(current, "审核过的A");
    report({
      stage: "subflow-reviewed-snapshot",
      flowType: type,
      omittedDefinitionPublishKeptReviewedChild: true,
      runtimeExecutedReviewedChild: true,
    });
    current = await owner(
      "workflow.unpublish",
      {
        id: flow.id,
        expectedDefinitionVersion: Number(current.definitionVersion),
      },
      true
    );
    await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
    const notice = page.locator("[data-workflow-subflow-snapshots]");
    await expect(notice).toBeVisible();
    await notice.getByText("查看本页快照信息", { exact: true }).click();
    await expect(notice).toContainText("快照一致性_" + type + "_" + tag);
    await page
      .getByRole("combobox", { name: "定位并配置节点", exact: true })
      .selectOption("child");
    const field = page
      .locator("[data-workflow-inspector]")
      .getByRole("textbox", { name: "节点名称", exact: true });
    const draftName = "保留本页填写_" + type + "_" + tag;
    await field.fill(draftName);
    let release, seen;
    const committed = new Promise(resolve => {
      seen = resolve;
    });
    const held = new Promise(resolve => {
      release = resolve;
    });
    let writes = 0;
    const hold = async route => {
      writes++;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      seen();
      await held;
      await route.fulfill({ response });
    };
    if (type === "control")
      await page.route("**/api/trpc/workflow.update**", hold);
    const saving = page.waitForResponse(
      r =>
        r.url().includes("workflow.update") && r.request().method() === "POST"
    );
    await notice
      .getByRole("button", { name: "更新子流程快照并保存", exact: true })
      .click();
    let finalName = draftName;
    if (type === "control") {
      try {
        await Promise.race([
          committed,
          sleep(20000).then(() => {
            throw new Error("Timed out waiting for snapshot save commit");
          }),
        ]);
        await expect(
          notice.getByRole("button", { name: "正在更新并保存…", exact: true })
        ).toBeDisabled();
        await page.keyboard.press("Control+s");
        finalName += "_提交中继续填写";
        await field.fill(finalName);
        assert.equal(writes, 1);
      } finally {
        release();
      }
    }
    assert.equal((await saving).status(), 200);
    await expect(field).toHaveValue(finalName);
    if (type === "control") {
      await page.unroute("**/api/trpc/workflow.update**", hold);
      const saveAgain = page.waitForResponse(
        r =>
          r.url().includes("workflow.update") && r.request().method() === "POST"
      );
      await page.getByRole("button", { name: /^保存画布/ }).click();
      assert.equal((await saveAgain).status(), 200);
      await expect(field).toHaveValue(finalName);
    }
    await expect(
      page.getByRole("button", { name: /^保存画布/ })
    ).toBeDisabled();
    current = await get(flow.id);
    assert.equal(snapshotValue(current), "未审核的B");
    assert.equal(current.auditStatus, "init");
    if (required) {
      await assert.rejects(publish(current), error => error.status === 409);
      await expect(
        page.getByRole("button", { name: "发布", exact: true })
      ).toBeDisabled();
    }
    if (type === "control") {
      await owner(
        "workflow.updateSubflow",
        { id: created.id, definition: childDefinition("核对后的C", type) },
        true
      );
      let dropped = 0;
      const lose = async route => {
        dropped++;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("failed");
      };
      await page.route("**/api/trpc/workflow.update**", lose);
      await notice
        .getByRole("button", { name: "更新子流程快照并保存", exact: true })
        .click();
      await expect(notice.getByRole("alert")).toBeVisible();
      await expect(
        notice.getByRole("button", {
          name: "更新子流程快照并保存",
          exact: true,
        })
      ).toBeDisabled();
      assert.equal(dropped, 1);
      assert.equal(snapshotValue(await get(flow.id)), "核对后的C");
      await page.unroute("**/api/trpc/workflow.update**", lose);
      await notice
        .getByRole("button", { name: "核对保存结果并保留修改", exact: true })
        .click();
      const conflict = page.getByRole("dialog", {
        name: "流程已被更新，当前修改已保留",
        exact: true,
      });
      await expect(conflict).toBeVisible();
      const download = page.waitForEvent("download");
      await conflict
        .getByRole("button", { name: "导出我的修改", exact: true })
        .click();
      const local = path.join(directory, "subflow-retained-draft.json");
      await (await download).saveAs(local);
      assert.equal(
        JSON.parse(
          fs.readFileSync(local, "utf8")
        ).workflow.definition.nodes.find(item => item.id === "child").name,
        finalName
      );
      await conflict
        .getByRole("button", { name: "读取最新版本并替换画布", exact: true })
        .click();
      await expect(conflict).toHaveCount(0);
      await expect(notice.getByRole("alert")).toHaveCount(0);
      await expect(
        notice.getByRole("button", {
          name: "更新子流程快照并保存",
          exact: true,
        })
      ).toBeEnabled();
      report({
        stage: "subflow-save-recovery",
        inputChangedDuringSubmissionRetained: true,
        responseLostAfterCommit: true,
        noBlindRetry: true,
        localDraftExported: true,
        explicitReloadRecovered: true,
      });
    }
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
      await expect(notice).toBeVisible();
      await expect
        .poll(async () => {
          const header = await page
            .locator("[data-aiflow-designer] > [data-aiflow-context-header]")
            .boundingBox();
          const panel = await notice.boundingBox();
          return Boolean(
            header && panel && header.y + header.height <= panel.y + 1
          );
        })
        .toBe(true);
      if (width < 640)
        await expect
          .poll(() =>
            notice
              .locator(":scope > div > div")
              .first()
              .evaluate(element => {
                const region = element.closest("section");
                return (
                  element.getBoundingClientRect().width >=
                  region.getBoundingClientRect().width - 50
                );
              })
          )
          .toBe(true);
      if (width === 390)
        await page.screenshot({
          path: path.join(directory, "subflow-" + type + "-mobile.png"),
          animations: "disabled",
        });
    }
    current = await get(flow.id);
    await approve(current);
    await owner(
      "workflow.updateSubflow",
      { id: created.id, definition: childDefinition("审核后的D", type) },
      true
    );
    const gate = page.locator("[data-workflow-publication-gate]");
    if (await gate.isVisible())
      await gate
        .getByRole("button", { name: "重新读取权限与规则", exact: true })
        .click();
    const published = page.waitForResponse(
      r =>
        r.url().includes("workflow.publish") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "发布", exact: true }).click();
    assert.equal((await published).status(), 200);
    current = await get(flow.id);
    const value = type === "control" ? "核对后的C" : "未审核的B";
    assert.equal(snapshotValue(current), value);
    await runPublished(current, value);
    report({
      stage: "subflow-explicit-refresh",
      flowType: type,
      savedCurrentInput: true,
      reviewReset: true,
      editorPublishKeptReviewedSnapshot: true,
      actualRuntimeMatchedReview: true,
      mobileWidths: [320, 390],
    });
    if (type === "control" && required) {
      current = await owner(
        "workflow.unpublish",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(current.definitionVersion),
        },
        true
      );
      await remote({
        action: "prepare_legacy_subflow",
        fixture,
        workflowId: flow.id,
        childId: created.id,
      });
      current = await get(flow.id);
      assert.equal(childSnapshot(current), undefined);
      await approve(current);
      await assert.rejects(
        publish(current),
        error => error.status === 409 && /先保存草稿/.test(error.message)
      );
      assert.equal((await get(flow.id)).status, "draft");
      await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
      await page.reload();
      await expect(notice).toContainText("尚未保存快照");
      const migrated = page.waitForResponse(
        r =>
          r.url().includes("workflow.update") && r.request().method() === "POST"
      );
      await notice
        .getByRole("button", { name: "更新子流程快照并保存", exact: true })
        .click();
      assert.equal((await migrated).status(), 200);
      current = await get(flow.id);
      assert.equal(snapshotValue(current), "审核后的D");
      assert.equal(current.auditStatus, "init");
      await approve(current);
      await publish(current);
      await runPublished(await get(flow.id), "审核后的D");
      report({
        stage: "subflow-legacy-migration",
        omittedDefinitionPublishDenied: true,
        explicitSaveCapturedSnapshot: true,
        reviewedMigrationRanSuccessfully: true,
      });
    }
  }
  assert.deepEqual(errors, []);
  report({
    stage: "subflow-snapshot-complete",
    browserErrors: 0,
    globalSettingsUntouched: true,
  });
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
    await owner(
      "project.grantMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        role: "owner",
      },
      true
    );
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
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible();
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
    for (const id of children)
      try {
        const child = (await owner("workflow.subflows")).find(
          item => item.id === id
        );
        if (child) {
          assert(
            child.name.startsWith("快照一致性_") && child.name.endsWith(tag)
          );
          await owner("workflow.deleteSubflow", { id }, true);
        }
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
