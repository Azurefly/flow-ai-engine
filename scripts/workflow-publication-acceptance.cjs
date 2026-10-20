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

async function verifyPublication(page) {
  const settings = await owner("config.settings");
  const required = Boolean(settings.approval.requireProjectApproval);
  const projectId = fixture.projectId,
    ids = new Set(fixture.workflows.map(flow => flow.id));
  const writes = [],
    errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let lost = false,
    failRead = false,
    failPolicy = false,
    optionalPolicy = false;
  let heldId = "",
    holdSeen,
    holdRelease,
    holdPromise;
  const get = id => owner("workflow.get", { id });
  const approve = async flow =>
    viewer(
      "project.auditWorkflow",
      {
        projectId,
        workflowId: flow.id,
        auditStatus: "approved",
        expectedDefinitionVersion: Number(flow.definitionVersion),
        expectedAuditStatus: flow.auditStatus,
      },
      true
    );
  const patchEntry = (payload, names, name, change) => {
    const entry = Array.isArray(payload)
      ? payload[names.indexOf(name)]
      : payload;
    if (entry?.result?.data) change(entry.result.data.json);
  };
  await page.route("**/api/trpc/**", async route => {
    const request = route.request(),
      names = decodeURIComponent(
        new URL(request.url()).pathname.split("/api/trpc/")[1]
      ).split(",");
    const method = names.find(name =>
      ["workflow.unpublish", "workflow.update", "workflow.publish"].includes(
        name
      )
    );
    if (request.method() === "POST" && method) {
      const raw = request.postDataJSON(),
        input = raw.json ?? raw["0"]?.json;
      assert(ids.has(input.id));
      writes.push({ method, input });
      const spec = fixture.workflows.find(flow => flow.id === input.id);
      if (
        method === "workflow.unpublish" &&
        spec.flowType === "control" &&
        !lost
      ) {
        lost = true;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort("failed");
        return;
      }
      if (method === "workflow.unpublish" && heldId === input.id) {
        heldId = "";
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        holdSeen();
        await holdPromise;
        await route.fulfill({ response });
        return;
      }
      if (method === "workflow.publish" && optionalPolicy) {
        const response = await route.fetch();
        optionalPolicy = false;
        assert.equal(response.status(), required ? 409 : 200);
        await route.fulfill({ response });
        return;
      }
    }
    if (
      request.method() === "GET" &&
      ((failRead && names.includes("workflow.get")) ||
        (names.includes("workflow.access") && (failPolicy || optionalPolicy)) ||
        (optionalPolicy && names.includes("project.workflows")))
    ) {
      const response = await route.fetch(),
        payload = await response.json();
      if (failRead && names.includes("workflow.get")) {
        const error = {
          error: {
            json: {
              message: "核对读取测试失败",
              code: -32603,
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 503,
                path: "workflow.get",
              },
            },
          },
        };
        if (Array.isArray(payload))
          payload[names.indexOf("workflow.get")] = error;
        else {
          await route.fulfill({ response, json: error });
          return;
        }
      }
      if (names.includes("workflow.access"))
        patchEntry(payload, names, "workflow.access", data => {
          if (data?.publication && ids.has(data.publication.workflowId)) {
            if (failPolicy) data.publication = null;
            else if (optionalPolicy)
              data.publication.requireProjectApproval = false;
          }
        });
      if (optionalPolicy && names.includes("project.workflows"))
        patchEntry(payload, names, "project.workflows", rows => {
          for (const row of rows ?? [])
            if (ids.has(row.id) && row.status === "draft" && row.actions) {
              row.actions.canPublish = true;
              row.actions.publicationRule = { requireProjectApproval: false };
              row.actions.publishBlockedReason = null;
            }
        });
      await route.fulfill({ response, json: payload });
      return;
    }
    await route.fallback();
  });
  const responseFor = method =>
    page.waitForResponse(
      response =>
        response.url().includes(method) &&
        response.request().method() === "POST"
    );
  const open = async flow => {
    await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
    await page.locator("[data-workflow-editor]").waitFor();
    const row = await get(flow.id),
      middle = row.definition.nodes[1];
    await page
      .getByRole("combobox", { name: "定位并配置节点", exact: true })
      .selectOption(middle.id);
    return {
      row,
      middle,
      field: page
        .locator("[data-workflow-inspector]")
        .getByRole("textbox", { name: "节点名称", exact: true }),
    };
  };
  const gate = () => page.locator("[data-workflow-publication-gate]");
  const cancelDialog = flow =>
    page.getByRole("dialog", {
      name: "取消发布“" + flow.name + "”",
      exact: true,
    });
  const saveButton = () => page.getByRole("button", { name: /^保存画布/ });
  try {
    for (const flow of fixture.workflows) {
      await page.emulateMedia({
        reducedMotion: flow.flowType === "control" ? "reduce" : "no-preference",
      });
      const { row, middle, field } = await open(flow);
      const original = await field.inputValue(),
        draft = original + "_可继续保存_" + tag;
      await field.fill(draft);
      if (required) {
        await expect(gate()).toContainText("先取消发布");
        await expect(
          page.getByRole("button", { name: "发布新版本", exact: true })
        ).toBeDisabled();
      }
      await page
        .getByRole("button", { name: "取消发布后编辑草稿", exact: true })
        .click();
      const dialog = cancelDialog(flow);
      await expect(dialog).toContainText("基于 v" + row.definitionVersion);
      const cancel =
        flow.flowType === "control" ? null : responseFor("workflow.unpublish");
      await dialog
        .getByRole("button", { name: "确认取消发布", exact: true })
        .click();
      if (flow.flowType === "control") {
        await expect(dialog.getByRole("alert")).toBeVisible();
        const hiddenSave = page.getByRole("button", {
          name: /^保存画布/,
          includeHidden: true,
        });
        await expect(hiddenSave).toBeEnabled();
        const before = writes.filter(
          w => w.method === "workflow.update"
        ).length;
        await page.keyboard.press("Control+s");
        assert.equal(
          writes.filter(w => w.method === "workflow.update").length,
          before
        );
        failRead = true;
        await dialog
          .getByRole("button", { name: "核对取消发布结果", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toContainText(
          "核对读取测试失败",
          { timeout: 25000 }
        );
        failRead = false;
        await dialog
          .getByRole("button", { name: "核对取消发布结果", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        assert.equal(
          writes.filter(
            w => w.method === "workflow.unpublish" && w.input.id === flow.id
          ).length,
          1
        );
      } else {
        assert.equal((await cancel).status(), 200);
        await expect(dialog).toHaveCount(0);
      }
      await expect(field).toHaveValue(draft);
      await expect(
        page.getByRole("dialog", {
          name: "流程已被更新，当前修改已保留",
          exact: true,
        })
      ).toHaveCount(0);
      await expect(saveButton()).toBeEnabled();
      await expect(saveButton()).toBeFocused();
      const saved = responseFor("workflow.update");
      await saveButton().click();
      const savedResponse = await saved;
      assert.equal(savedResponse.status(), 200);
      const raw = savedResponse.request().postDataJSON(),
        input = raw.json ?? raw["0"]?.json;
      assert.equal(
        Number(input.expectedDefinitionVersion),
        Number(row.definitionVersion) + 1
      );
      await expect(saveButton()).toBeDisabled();
      await expect(field).toHaveValue(draft);
      let latest = await get(flow.id);
      assert.equal(
        latest.definition.nodes.find(node => node.id === middle.id).name,
        draft
      );
      assert.equal(
        Number(latest.definitionVersion),
        Number(row.definitionVersion) + 2
      );
      assert.equal(latest.auditStatus, "init");
      if (required) {
        await expect(gate()).toContainText("业务管理员复核");
        await expect(
          page.getByRole("button", { name: "发布", exact: true })
        ).toBeDisabled();
      }
      if (required && flow.flowType === "data") {
        for (const width of [320, 390, 1440]) {
          await page.setViewportSize({
            width,
            height: width === 1440 ? 1000 : 844,
          });
          await expect
            .poll(
              () =>
                page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
              { timeout: 5000 }
            )
            .toBe(true);
          await expect(gate()).toBeVisible();
          if (width === 390)
            await page.screenshot({
              path: path.join(directory, "publication-mobile.png"),
              animations: "disabled",
            });
        }
      }
      await approve(latest);
      if (await gate().isVisible())
        await gate()
          .getByRole("button", { name: "重新读取权限与规则", exact: true })
          .click();
      await expect(
        page.getByRole("button", { name: "发布", exact: true })
      ).toBeEnabled();
      const published = responseFor("workflow.publish");
      await page.getByRole("button", { name: "发布", exact: true }).click();
      assert.equal((await published).status(), 200);
      await expect(
        page.getByRole("button", { name: "发布新版本", exact: true })
      ).toBeDisabled();
      latest = await get(flow.id);
      assert.equal(latest.status, "published");
      assert.equal(
        latest.definition.nodes.find(node => node.id === middle.id).name,
        draft
      );
      report({
        stage: "publication-draft-continued",
        flowType: flow.flowType,
        ownUnpublishAdvancedBaseline: true,
        draftRetained: true,
        saveSucceeded: true,
        reviewAndPublishCompleted: true,
        responseLossReconciled: flow.flowType === "control",
      });
    }
    const state = fixture.workflows.find(flow => flow.flowType === "state");
    const { row, middle, field } = await open(state),
      original = await field.inputValue(),
      local = original + "_本地未保存";
    await field.fill(local);
    heldId = state.id;
    holdPromise = new Promise(resolve => {
      holdRelease = resolve;
    });
    const seen = new Promise(resolve => {
      holdSeen = resolve;
    });
    await page
      .getByRole("button", { name: "取消发布后编辑草稿", exact: true })
      .click();
    const dialog = cancelDialog(state);
    await dialog
      .getByRole("button", { name: "确认取消发布", exact: true })
      .click();
    await seen;
    await expect(
      dialog.getByRole("button", { name: "保持发布", exact: true })
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    const cancelled = await get(state.id),
      external = structuredClone(cancelled.definition),
      externalName = "其他人已保存_" + tag;
    external.nodes.find(node => node.id === middle.id).name = externalName;
    await owner(
      "workflow.update",
      {
        id: state.id,
        expectedDefinitionVersion: Number(cancelled.definitionVersion),
        definition: external,
      },
      true
    );
    const accessRead = page.waitForResponse(
      r => r.url().includes("workflow.access") && r.request().method() === "GET"
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
    await accessRead;
    holdRelease();
    await expect(dialog).toHaveCount(0);
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const conflict = page.getByRole("dialog", {
      name: "流程已被更新，当前修改已保留",
      exact: true,
    });
    if (!(await conflict.isVisible()))
      await gate()
        .getByRole("button", { name: "处理版本变化", exact: true })
        .click();
    await expect(conflict).toBeVisible();
    const downloading = page.waitForEvent("download");
    await conflict
      .getByRole("button", { name: "导出我的修改", exact: true })
      .click();
    const downloaded = await downloading,
      file = path.join(directory, "retained-publication-draft.json");
    await downloaded.saveAs(file);
    assert.equal(
      JSON.parse(fs.readFileSync(file, "utf8")).workflow.definition.nodes.find(
        node => node.id === middle.id
      ).name,
      local
    );
    await conflict
      .getByRole("button", { name: "读取最新版本并替换画布", exact: true })
      .click();
    await expect(conflict).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "定位并配置节点", exact: true })
      .selectOption(middle.id);
    await expect(field).toHaveValue(externalName);
    assert.equal(
      (await get(state.id)).definition.nodes.find(node => node.id === middle.id)
        .name,
      externalName
    );
    report({
      stage: "publication-external-change",
      pendingCloseLocked: true,
      laterDefinitionNotOverwritten: true,
      localDraftExported: true,
      explicitReloadOnly: true,
    });
    await expect(gate()).toBeVisible();
    failPolicy = true;
    await gate()
      .getByRole("button", { name: "重新读取权限与规则", exact: true })
      .click();
    await expect(gate()).toContainText("暂不可用");
    await expect(field).toBeEnabled();
    await field.fill(externalName + "_规则读取失败仍可编辑");
    await expect(saveButton()).toBeEnabled();
    await field.fill(externalName);
    await expect(saveButton()).toBeDisabled();
    failPolicy = false;
    await gate()
      .getByRole("button", { name: "重新读取权限与规则", exact: true })
      .click();
    if (required) await expect(gate()).toContainText("业务管理员复核");
    else
      await expect(
        page.getByRole("button", { name: "发布", exact: true })
      ).toBeEnabled();
    optionalPolicy = true;
    await page.goto(base + "#/flows/project/" + projectId);
    await page
      .getByRole("button", {
        name: "更多信息与操作：" + state.name,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("当前规则无需审核，可直接发布此草稿。", { exact: true })
    ).toBeVisible();
    const optional = responseFor("workflow.publish");
    await page.getByRole("button", { name: "发布流程", exact: true }).click();
    assert.equal((await optional).status(), required ? 409 : 200);
    const final = await get(state.id);
    assert.equal(final.status, required ? "draft" : "published");
    assert.equal(
      final.definition.nodes.find(node => node.id === middle.id).name,
      externalName
    );
    assert.deepEqual(errors, []);
    report({
      stage: "publication-policy",
      actualRequiresApproval: required,
      ruleReadFailureKeptDraft: true,
      optionalRuleUiCovered: true,
      staleDeclarationDidNotBypassServer: required,
      browserErrors: errors.length,
    });
  } finally {
    holdRelease?.();
    await page.unroute("**/api/trpc/**");
  }
}

(async () => {
  let browser,
    page,
    failed = false,
    configBefore;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    configBefore = (await remote({ action: "settings_fingerprint" })).trim();
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
    for (const flow of fixture.workflows) {
      const item = await owner("workflow.get", { id: flow.id });
      await viewer(
        "project.auditWorkflow",
        {
          projectId: fixture.projectId,
          workflowId: flow.id,
          auditStatus: "approved",
          expectedDefinitionVersion: Number(item.definitionVersion),
          expectedAuditStatus: item.auditStatus,
        },
        true
      );
      await owner(
        "workflow.publish",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(item.definitionVersion),
        },
        true
      );
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
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible();
    if (process.env.FLOW_UI_PUBLICATION_REPRO !== "1") {
      await verifyPublication(page);
      return;
    }
    for (const flow of fixture.workflows) {
      const before = await owner("workflow.get", { id: flow.id });
      await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
      await page.locator("[data-workflow-editor]").waitFor();
      const middle = before.definition.nodes[1];
      await page
        .getByRole("combobox", { name: "定位并配置节点", exact: true })
        .selectOption(middle.id);
      const field = page
        .locator("[data-workflow-inspector]")
        .getByRole("textbox", { name: "节点名称", exact: true });
      const original = await field.inputValue(),
        draft = original + "_待保存_" + tag;
      await field.fill(draft);
      await page
        .getByRole("button", { name: "取消发布后编辑草稿", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "取消发布“" + flow.name + "”",
        exact: true,
      });
      const unpublish = page.waitForResponse(
        r =>
          r.url().includes("workflow.unpublish") &&
          r.request().method() === "POST"
      );
      await dialog
        .getByRole("button", { name: "确认取消发布", exact: true })
        .click();
      assert.equal((await unpublish).status(), 200);
      await expect(dialog).toHaveCount(0);
      await expect(field).toHaveValue(draft);
      const save = page.getByRole("button", { name: /^保存画布/ });
      await expect(save).toBeEnabled();
      const submitted = page.waitForResponse(
        r =>
          r.url().includes("workflow.update") && r.request().method() === "POST"
      );
      await save.click();
      const response = await submitted;
      assert.equal(response.status(), 409);
      const raw = response.request().postDataJSON(),
        input = raw.json ?? raw["0"]?.json;
      const actual = await owner("workflow.get", { id: flow.id });
      assert.equal(
        Number(input.expectedDefinitionVersion),
        Number(before.definitionVersion)
      );
      assert.equal(
        Number(actual.definitionVersion),
        Number(before.definitionVersion) + 1
      );
      const conflict = page.getByRole("dialog", {
        name: "流程已被更新，当前修改已保留",
        exact: true,
      });
      await expect(conflict).toBeVisible();
      await conflict
        .getByRole("button", { name: "保留并继续编辑", exact: true })
        .click();
      await expect(field).toHaveValue(draft);
      assert.deepEqual(actual.definition, before.definition);
      report({
        stage: "publication-draft-reproduction",
        flowType: flow.flowType,
        ownUnpublishLeftOldBaseline: true,
        saveRejected409: true,
        localDraftRetained: true,
      });
      await field.fill(original);
      await expect(save).toBeDisabled();
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
    if (configBefore)
      try {
        assert.equal(
          (await remote({ action: "settings_fingerprint" })).trim(),
          configBefore
        );
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
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
