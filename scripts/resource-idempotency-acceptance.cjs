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
const ledgerVerification = `
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
const {fixture, resources} = browserFixtureIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
const pool = mysql.createPool(process.env.DATABASE_URL);
try {
  const [project] = await pool.query('SELECT ownerUserId FROM flow_project WHERE id=?', [fixture.projectId]);
  assert.equal(Number(project[0]?.ownerUserId), fixture.userId);
  for (const item of resources) {
    assert([fixture.userId,fixture.disabledUserId].includes(item.actor));
    assert(fixture.projects.some(p => p.id===item.projectId));
    const [receipts] = await pool.query('SELECT id,requestKeyHash,payloadHash FROM resource_creation_request WHERE resourceId=? AND actorUserId=? AND projectId=? AND resourceKind=?', [item.id,item.actor,item.projectId,item.kind]);
    assert.equal(receipts.length,1);
    assert(/^[a-f0-9]{64}$/.test(receipts[0].requestKeyHash));
    assert(/^[a-f0-9]{64}$/.test(receipts[0].payloadHash));
    const [audits] = await pool.query("SELECT COUNT(*) AS n FROM authorization_audit_log WHERE resourceId=? AND actorUserId=? AND JSON_UNQUOTE(JSON_EXTRACT(detailsJson,'$.creationRequestId'))=?", [item.id,item.actor,receipts[0].id]);
    assert.equal(Number(audits[0].n),1);
  }
  console.log(JSON.stringify({stage:'resource-receipts-audit',verified:resources.length,oneReceiptAndAuditPerResource:true}));
} finally { await pool.end(); }
`;

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
      "const browserFixtureIntent = " +
        JSON.stringify(intent) +
        ";\n" +
        (intent.action === "verify_receipts" ? ledgerVerification : helper)
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

async function verifyIdempotency(page) {
  const evidence = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const projectId = fixture.projectId;
  const specs = [
    {
      key: "sources",
      kind: "source",
      category: "数据源",
      title: "添加数据源",
      label: "数据源名称",
      method: "data.createSource",
    },
    {
      key: "assets",
      kind: "asset",
      category: "资源探查",
      title: "资源探查结果",
      label: "资源名称",
      method: "data.createAsset",
    },
    {
      key: "udfs",
      kind: "udf",
      category: "函数",
      title: "注册函数",
      label: "函数名称",
      method: "data.createUdf",
    },
    {
      key: "tags",
      kind: "tag",
      category: "标签",
      title: "新建标签",
      label: "标签名称",
      method: "data.createTag",
    },
    {
      key: "plugins",
      kind: "plugin",
      category: "项目插件",
      title: "登记项目插件",
      label: "插件名称",
      method: "data.createPlugin",
    },
  ];
  const inputs = new Map(),
    posts = new Map();
  let loseMethod = "",
    failReads = false;
  await page.route("**/api/trpc/**", async route => {
    const request = route.request();
    const names = decodeURIComponent(
      new URL(request.url()).pathname.split("/api/trpc/")[1]
    ).split(",");
    const method = specs.find(s => names.includes(s.method))?.method;
    if (request.method() === "POST" && method) {
      assert.equal(names.length, 1);
      const raw = request.postDataJSON(),
        input = raw.json ?? raw["0"]?.json;
      assert.equal(input.projectId, projectId);
      assert(/^[a-f0-9]{48}$/.test(input.requestKey));
      if (inputs.has(method)) assert.deepEqual(input, inputs.get(method));
      else inputs.set(method, input);
      posts.set(method, (posts.get(method) ?? 0) + 1);
      if (loseMethod === method) {
        loseMethod = "";
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        const data = await response.json();
        const result = (Array.isArray(data) ? data[0] : data).result.data.json;
        evidence.push({
          id: result.id,
          kind: specs.find(s => s.method === method).kind,
          actor: fixture.disabledUserId,
          projectId,
        });
        await route.abort("failed");
        return;
      }
    }
    if (
      failReads &&
      request.method() === "GET" &&
      names.includes("project.get")
    ) {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  const focusRefresh = () =>
    page.evaluate(() => {
      for (const value of ["hidden", "visible"]) {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value,
        });
        window.dispatchEvent(new Event("visibilitychange"));
      }
    });
  const setRole = async role => {
    await owner(
      "project.grantMember",
      { projectId, userId: fixture.disabledUserId, role },
      true
    );
    const members = await owner("project.members", { projectId });
    for (const item of members.filter(
      m => Number(m.userId) === fixture.disabledUserId && m.role !== role
    ))
      await owner(
        "project.revokeMember",
        { projectId, userId: fixture.disabledUserId, assignmentId: item.id },
        true
      );
  };
  for (const spec of specs) {
    let deniedReplay = false;
    await page
      .locator("[data-resource-category-desktop]")
      .getByRole("button", { name: new RegExp("^" + spec.category) })
      .click();
    await page.getByRole("button", { name: spec.title, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: spec.title, exact: true });
    const name = "响应核对_" + spec.key + "_" + tag;
    const field = dialog.getByLabel(spec.label, { exact: true });
    await field.fill(name);
    if (spec.key === "sources")
      await dialog
        .getByLabel("连接说明", { exact: true })
        .fill("响应核对隔离验收");
    if (spec.key === "assets")
      await dialog
        .getByLabel("字段结构第 1 行字段名", { exact: true })
        .fill("order_id");
    loseMethod = spec.method;
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "上次保存结果尚未确认"
    );
    await expect(field).toBeDisabled();
    await expect(field).toHaveValue(name);
    const rows = () => owner("data.resources", { projectId });
    assert.equal(
      (await rows())[spec.key].filter(r => r.name === name).length,
      1
    );
    const retry = dialog.getByRole("button", {
      name: "核对保存结果",
      exact: true,
    });
    if (spec.key === "plugins") {
      // Lose the entire business query batch, forcing a component remount.
      failReads = true;
      await focusRefresh();
      const recover = page.getByRole("button", {
        name: "重试读取业务",
        exact: true,
      });
      await expect(recover).toBeVisible();
      await expect(
        page.locator("[data-resource-draft-recovery]")
      ).toContainText("1 类资源");
      failReads = false;
      await recover.click();
      await expect(dialog).toBeVisible();
      await expect(field).toBeDisabled();
      await expect(field).toHaveValue(name);
      // A changed permission must not expose the original result or forget its key.
      await setRole("viewer");
      await assert.rejects(
        viewer(spec.method, inputs.get(spec.method), true),
        e => e.status === 403
      );
      if (await retry.isEnabled()) {
        const response = page.waitForResponse(
          response =>
            response.url().includes(spec.method) &&
            response.request().method() === "POST"
        );
        await retry.click();
        assert.equal((await response).status(), 403);
        deniedReplay = true;
      }
      await expect(retry).toBeDisabled();
      await expect(field).toHaveValue(name);
      await setRole("designer");
      await dialog
        .getByRole("button", { name: "刷新业务权限", exact: true })
        .click();
    }
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(dialog).toHaveCount(0);
    const created = (await rows())[spec.key].filter(r => r.name === name);
    assert.equal(created.length, 1);
    assert.equal(created[0].id, evidence.find(r => r.kind === spec.kind).id);
    assert.equal(posts.get(spec.method), deniedReplay ? 3 : 2);
    report({
      stage: "resource-response-loss",
      kind: spec.kind,
      oneResource: true,
      sameRequestReplayed: true,
      permissionAndRemount: spec.key === "plugins",
    });
  }
  await page.unroute("**/api/trpc/**");
  const key = randomBytes(24).toString("hex");
  const source = {
    projectId,
    requestKey: key,
    name: "并发登记_" + tag,
    sourceType: "inline",
    connection: { description: "owned fixture", endpoint: "" },
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, () => owner("data.createSource", source, true))
  );
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  const sourceId = results[0].id;
  evidence.push({
    id: sourceId,
    kind: "source",
    actor: fixture.userId,
    projectId,
  });
  assert.equal(
    (
      await owner(
        "data.createSource",
        {
          ...source,
          connection: { endpoint: "", description: "owned fixture" },
        },
        true
      )
    ).id,
    sourceId
  );
  await assert.rejects(
    owner("data.createSource", { ...source, name: source.name + "修改" }, true),
    e => e.status === 409
  );
  const memberSource = await viewer(
    "data.createSource",
    { ...source, name: "账号隔离_" + tag },
    true
  );
  assert.notEqual(memberSource.id, sourceId);
  evidence.push({
    id: memberSource.id,
    kind: "source",
    actor: fixture.disabledUserId,
    projectId,
  });
  const tagInput = { projectId, requestKey: key, name: "类型隔离_" + tag };
  const createdTag = await owner("data.createTag", tagInput, true);
  evidence.push({
    id: createdTag.id,
    kind: "tag",
    actor: fixture.userId,
    projectId,
  });
  const spec = {
    code: tag.toUpperCase() + "_IDEM",
    name: "请求隔离验收_" + tag,
  };
  const otherProject = await owner("project.create", spec, true);
  fixture.projects.push({ id: otherProject.id, ...spec });
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
  const otherTag = await owner(
    "data.createTag",
    { ...tagInput, projectId: otherProject.id },
    true
  );
  assert.notEqual(otherTag.id, createdTag.id);
  evidence.push({
    id: otherTag.id,
    kind: "tag",
    actor: fixture.userId,
    projectId: otherProject.id,
  });
  const asset = {
    projectId,
    requestKey: randomBytes(24).toString("hex"),
    name: "删除后核对_" + tag,
    assetType: "dataset",
    schema: [],
    sample: [],
  };
  const removed = await owner("data.createAsset", asset, true);
  evidence.push({
    id: removed.id,
    kind: "asset",
    actor: fixture.userId,
    projectId,
  });
  await owner("data.deleteAsset", { projectId, assetId: removed.id }, true);
  await assert.rejects(
    owner("data.createAsset", asset, true),
    e => e.status === 409
  );
  assert.equal(
    (await owner("data.resources", { projectId })).assets.filter(
      r => r.name === asset.name
    ).length,
    0
  );
  report({
    stage: "resource-concurrent-replay",
    concurrentRequests: 20,
    oneResource: true,
    payloadConflict: true,
    actorKindProjectIsolated: true,
    deletedNotRecreated: true,
  });
  report({
    output: (
      await remote({ action: "verify_receipts", fixture, resources: evidence })
    ).trim(),
  });
  assert.deepEqual(errors, []);
  report({
    stage: "resource-idempotency-complete",
    browserErrors: errors.length,
  });
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
    await owner("auth.login", login, true);
    if (process.env.FLOW_UI_RESOURCE_IDEMPOTENCY_REPRO !== "1") {
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
          role: "designer",
        },
        true
      );
      await viewer("auth.login", memberLogin, true);
    }
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
    const browserLogin =
      process.env.FLOW_UI_RESOURCE_IDEMPOTENCY_REPRO === "1"
        ? login
        : memberLogin;
    await page
      .getByLabel("用户名", { exact: true })
      .fill(browserLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(browserLogin.password);
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
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    if (process.env.FLOW_UI_RESOURCE_IDEMPOTENCY_REPRO !== "1") {
      await verifyIdempotency(page);
      return;
    }
    await page
      .locator("[data-resource-category-desktop]")
      .getByRole("button", { name: /^资源探查/ })
      .click();
    await page
      .getByRole("button", { name: "资源探查结果", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "资源探查结果",
      exact: true,
    });
    const name = "响应丢失_" + tag;
    await dialog.getByLabel("资源名称", { exact: true }).fill(name);
    await dialog
      .getByLabel("字段结构第 1 行字段名", { exact: true })
      .fill("order_id");
    let lost = false,
      actualPosts = 0;
    await page.route("**/api/trpc/**", async route => {
      const request = route.request();
      if (
        request.method() === "POST" &&
        request.url().includes("data.createAsset")
      ) {
        const raw = request.postDataJSON(),
          input = raw.json ?? raw["0"]?.json;
        assert.equal(input.projectId, fixture.projectId);
        actualPosts++;
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
          return;
        }
      }
      await route.fallback();
    });
    const save = dialog.getByRole("button", { name: "保存", exact: true });
    await save.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    const rows = async () =>
      (
        await owner("data.resources", { projectId: fixture.projectId })
      ).assets.filter(row => row.name === name);
    assert.equal((await rows()).length, 1);
    if (process.env.FLOW_UI_RESOURCE_IDEMPOTENCY_REPRO === "1") {
      const response = page.waitForResponse(
        response =>
          response.url().includes("data.createAsset") &&
          response.request().method() === "POST"
      );
      await save.click();
      assert.equal((await response).status(), 200);
      await expect(dialog).toHaveCount(0);
      assert.equal((await rows()).length, 2);
      report({
        stage: "resource-response-loss-reproduction",
        committedBeforeResponseLoss: true,
        duplicateCreatedOnRetry: true,
        actualPosts,
      });
    } else {
      await expect(
        dialog.getByRole("button", { name: "核对保存结果", exact: true })
      ).toBeEnabled();
      await dialog
        .getByRole("button", { name: "核对保存结果", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      assert.equal((await rows()).length, 1);
      report({
        stage: "resource-response-loss",
        retryDidNotDuplicate: true,
        actualPosts,
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
          animations: "disabled",
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
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
