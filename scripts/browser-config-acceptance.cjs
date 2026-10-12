const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  chromium,
} = require("../01-test/014-自动化脚本/e2e/node_modules/@playwright/test");
const root = path.resolve(__dirname, "..");
const base = "http://124.223.198.84:1180/";
const verifyUpdated = process.env.FLOW_UI_EXPECT_UPDATED === "1";
const verifySources = process.env.FLOW_UI_PERMISSION_SOURCES === "1";
const verifyStatus = process.env.FLOW_UI_ACCOUNT_STATUS === "1";
const verifyProjectPaging = process.env.FLOW_UI_PROJECT_PAGING === "1";
const verifyProjectLifecycle = process.env.FLOW_UI_PROJECT_LIFECYCLE === "1";
const tag = "uiconfig_" + randomBytes(6).toString("hex");
const login = {
  username: tag + "_admin",
  password: "Test9_" + randomBytes(24).toString("base64url"),
};
const memberLogin = {
  username: tag + "_disabled",
  password: "Test9_" + randomBytes(24).toString("base64url"),
};
const directory = path.join(root, ".cache", tag);
fs.mkdirSync(directory, { recursive: true });
let fixture;
const helper = fs.readFileSync(
  path.join(__dirname, "browser-config-fixtures.mjs"),
  "utf8"
);

function remoteOnce(intent) {
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
          const value = JSON.parse(line);
          if (value.fixture) {
            fixture = value.fixture;
            fs.writeFileSync(
              path.join(directory, "fixture.json"),
              JSON.stringify(fixture),
              "utf8"
            );
          }
        } catch {
          /* The last output line may still be incomplete. */
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

async function remote(intent) {
  try {
    return await remoteOnce(intent);
  } catch (error) {
    // A banner timeout happens before authentication: no remote command started.
    if (
      intent.action !== "cleanup" ||
      !error.message.includes("Connection timed out during banner exchange")
    )
      throw error;
    await new Promise(resolve => setTimeout(resolve, 2000));
    return remoteOnce(intent);
  }
}

function executable() {
  if (process.env.FLOW_UI_BROWSER_EXECUTABLE)
    return process.env.FLOW_UI_BROWSER_EXECUTABLE;
  const browsers = path.join(process.env.LOCALAPPDATA, "ms-playwright");
  const installed = fs
    .readdirSync(browsers)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  const candidate = installed
    .map(name => path.join(browsers, name, "chrome-win64", "chrome.exe"))
    .find(file => fs.existsSync(file));
  assert(
    candidate,
    "No installed Chromium found; set FLOW_UI_BROWSER_EXECUTABLE"
  );
  return candidate;
}

(async () => {
  let browser;
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
      pagination: verifyProjectPaging,
    });
    assert.equal(fixture.workflows.length, 3);
    if (verifyProjectPaging)
      console.log((await remote({ action: "verify_pagination", fixture, login, memberLogin })).trim());
    if (verifyProjectLifecycle)
      console.log((await remote({ action: "verify_lifecycle", fixture, login, memberLogin })).trim());
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
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page
      .getByText("正在读取当前账号可见的业务项目…", { exact: true })
      .waitFor({ state: "hidden" });
    await page.locator("[data-aiflow-business-center]").waitFor();
    await page.screenshot({
      path: path.join(directory, "home.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        stage: "home",
        text: (await page.locator("body").innerText()).slice(0, 2400),
        directory,
      })
    );
    if (verifyProjectPaging) {
      const center = page.locator("[data-aiflow-business-center]");
      await center.getByLabel("搜索业务名称、代号或工作域").fill(fixture.tag);
      await center.getByRole("button", { name: "查询", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("[data-aiflow-business-center] table tbody")?.children.length === 10 && document.querySelector("[data-aiflow-business-center]")?.textContent.includes("共 13 个业务项目"));
      assert((await center.innerText()).includes("共 13 个业务项目"));
      await center.getByRole("button", { name: "下一页", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("[data-aiflow-business-center] table tbody")?.children.length === 3);
      assert((await center.innerText()).includes("2 / 2"));
      await center.getByLabel("每页显示数量").selectOption("25");
      await page.waitForFunction(() => document.querySelector("[data-aiflow-business-center] table tbody")?.children.length === 13);
      const importInput = page.locator('input[type="file"][accept=".csv,text/csv"]');
      await importInput.setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from("业务代号,业务名称\n1INVALID,无效代号\n", "utf8") });
      await page.getByText("业务代号须以字母开头，且仅包含字母、数字、下划线或连字符，长度为 2–64 个字符。", { exact: true }).waitFor();
      await importInput.setInputFiles({ name: "duplicate.csv", mimeType: "text/csv", buffer: Buffer.from(`业务代号,业务名称\n${fixture.projects[0].code},重复导入\n`, "utf8") });
      await page.getByText("业务代号已存在：" + fixture.projects[0].code + "。请先修正 CSV 再导入。", { exact: true }).waitFor();
      const importedProject = { code: fixture.tag.toUpperCase() + "_CSV", name: "CSV导入_" + fixture.tag };
      fixture.pendingProjects = [importedProject];
      fs.writeFileSync(path.join(directory, "fixture.json"), JSON.stringify(fixture), "utf8");
      await importInput.setInputFiles({ name: "valid.csv", mimeType: "text/csv", buffer: Buffer.from(`业务代号,业务名称,工作域代号\n${importedProject.code},${importedProject.name},${fixture.csvDomainCode}\n`, "utf8") });
      await page.getByText("已导入 1 个业务项目。", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector("[data-aiflow-business-center] table tbody")?.children.length === 14);
      await center.getByLabel("搜索业务名称、代号或工作域").fill(fixture.tag + "%_");
      await center.getByRole("button", { name: "查询", exact: true }).click();
      await center.getByText("没有符合条件的业务项目。请调整筛选条件，或重置筛选。", { exact: true }).first().waitFor();
      await page.goto(`${base}#/flows/project/${fixture.projectId}`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-aiflow-business-selector]").waitFor();
      await page.getByRole("button", { name: "切换当前受权业务", exact: true }).click();
      await page.getByLabel("搜索有权限的业务项目").fill(fixture.projects[11].code);
      await page.getByRole("option").filter({ hasText: fixture.projects[11].code }).click();
      await page.waitForFunction(code => document.querySelector("[data-aiflow-business-selector]")?.textContent.includes(code), fixture.projects[11].code);
      await page.screenshot({ path: path.join(directory, "project-pagination.png"), fullPage: true });
      await page.goto(`${base}#/warehouse`, { waitUntil: "domcontentloaded" });
      await page.getByRole("combobox", { name: /切换流程仓库项目/ }).click();
      await page.getByLabel("搜索仓库项目").fill(fixture.projects[0].code);
      await page.getByRole("option", { name: `${fixture.projects[0].code} · ${fixture.projects[0].name}`, exact: true }).click();
      await page.getByRole("combobox", { name: `切换流程仓库项目，当前：${fixture.projects[0].code} · ${fixture.projects[0].name}`, exact: true }).waitFor();
      await page.screenshot({ path: path.join(directory, "warehouse-project-search.png"), fullPage: true });
      assert.equal(requests.some(url => /(?:\/|,)project\.list(?:\?|,|$)/.test(url)), false, "浏览器仍在读取全量项目列表");
      console.log(JSON.stringify({ stage: "project-pagination-browser", defaultPage: 10, secondPage: 3, pageSizeChanged: true, literalSearch: true, csvInvalidCodeFeedback: true, csvDuplicateBlocked: true, csvCreated: true, csvDomainTested: Boolean(fixture.csvDomainCode), directRoute: true, remoteSelector: true, warehouseSearch: true, fullProjectListRequests: 0 }));
    }
    if (verifyProjectLifecycle) {
      const center = page.locator("[data-aiflow-business-center]");
      await center.getByLabel("搜索业务名称、代号或工作域").fill(fixture.tag);
      await center.getByRole("button", { name: "查询", exact: true }).click();
      await center.getByRole("button", { name: `更多业务操作：界面隔离验收_${fixture.tag}`, exact: true }).click();
      await page.getByRole("button", { name: `归档业务：界面隔离验收_${fixture.tag}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "确认归档业务", exact: true }).waitFor();
      const before = requests.filter(url => url.includes("project.changeStatus")).length;
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(requests.filter(url => url.includes("project.changeStatus")).length, before);
      const action = page.getByRole("button", { name: `归档业务：界面隔离验收_${fixture.tag}`, exact: true });
      if (!(await action.isVisible())) await center.getByRole("button", { name: `更多业务操作：界面隔离验收_${fixture.tag}`, exact: true }).click();
      await action.click();
      await page.getByRole("dialog").getByRole("button", { name: "确认归档业务", exact: true }).click();
      await page.getByText("业务及在用流程已归档，历史数据已保留。", { exact: true }).waitFor();
      await center.getByRole("button", { name: "已归档", exact: true }).click();
      await center.getByRole("button", { name: "查看归档", exact: true }).click();
      await page.getByRole("dialog").getByRole("heading", { name: "已归档流程", exact: true }).waitFor();
      assert.equal(await page.getByRole("dialog").getByRole("link", { name: "查看历史", exact: true }).count(), 3);
      await page.screenshot({ path: path.join(directory, "project-archive-history.png"), fullPage: true });
      await page.getByRole("dialog").getByRole("button", { name: "恢复业务", exact: true }).click();
      await page.getByText("业务已恢复，请按需恢复流程并重新发布。", { exact: true }).waitFor();
      await center.getByRole("button", { name: "在用业务", exact: true }).click();
      await remote({ action: "restore_owned_workflows", fixture });
      console.log(JSON.stringify({ stage: "project-lifecycle-browser", cancelNoMutation: true, explicitArchive: true, archiveScope: true, historyReadable: true, explicitRestore: true }));
    }
    for (const workflow of fixture.workflows) {
      await page.goto(`${base}#/flows/workflow/${workflow.id}/editor`, {
        waitUntil: "domcontentloaded",
      });
      await page.locator("[data-workflow-editor]").waitFor();
      await page.screenshot({
        path: path.join(directory, `${workflow.flowType}-canvas.png`),
        fullPage: true,
      });
      const nodeId = workflow.flowType === "data" ? "source" : "review";
      await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
      await page.locator("[data-workflow-inspector]").waitFor();
      const inspector = page.locator("[data-workflow-inspector]");
      const tablist = inspector.getByRole("tablist");
      if (verifyUpdated) {
        assert.equal(
          await inspector
            .getByRole("button", { name: "预览候选人", exact: true })
            .count(),
          0
        );
        const active = tablist.getByRole("tab", { selected: true });
        assert.equal(await active.getAttribute("tabindex"), "0");
        await active.focus();
        await page.keyboard.press("End");
        assert.equal(
          await tablist.getByRole("tab", { selected: true }).innerText(),
          workflow.flowType === "data" ? "节点配置" : "高级配置"
        );
        await page.keyboard.press("Home");
        if (workflow.flowType !== "data") {
          await page.keyboard.press("ArrowRight");
          assert.equal(
            await tablist.getByRole("tab", { selected: true }).innerText(),
            "处理人"
          );
          await page.keyboard.press("ArrowLeft");
        }
        assert.equal(
          await inspector.getByRole("tabpanel").getAttribute("aria-labelledby"),
          await tablist.getByRole("tab", { selected: true }).getAttribute("id")
        );
      }
      await page
        .getByText("操作节点处理人方式无效。", { exact: true })
        .waitFor({ state: "hidden" });
      await page.screenshot({
        path: path.join(directory, `${workflow.flowType}-inspector.png`),
        fullPage: true,
      });
      console.log(
        JSON.stringify({
          stage: "inspector",
          flowType: workflow.flowType,
          text: (
            await page.locator("[data-workflow-inspector]").innerText()
          ).slice(0, 5000),
        })
      );
      if (workflow.flowType !== "data") {
        await page.getByRole("tab", { name: "处理人", exact: true }).click();
        await page
          .getByText(new RegExp("已停用处理人_" + tag))
          .first()
          .waitFor();
        await page
          .getByRole("button", { name: "预览候选人", exact: true })
          .click();
        await page
          .getByText(new RegExp("界面隔离验收_" + tag + "（"))
          .first()
          .waitFor();
        if (verifyUpdated) {
          assert(
            (await inspector.innerText()).includes("已使用兜底：流程所有者")
          );
          assert(!(await inspector.innerText()).includes("已使用兜底：owner"));
          await inspector
            .locator("[data-workflow-inspector-content]")
            .evaluate(element => {
              element.scrollTop = element.scrollHeight;
            });
          const tabs = await tablist.boundingBox(),
            viewport = await inspector
              .locator("[data-workflow-inspector-content]")
              .boundingBox();
          assert(
            tabs.y >= viewport.y - 1 &&
              tabs.y + tabs.height <= viewport.y + viewport.height
          );
        }
        await page.screenshot({
          path: path.join(directory, `${workflow.flowType}-participants.png`),
          fullPage: true,
        });
        console.log(
          JSON.stringify({
            stage: "participants",
            flowType: workflow.flowType,
            text: (
              await page.locator("[data-workflow-inspector]").innerText()
            ).slice(0, 5000),
          })
        );
        await page
          .getByRole("tab", { name: "表单与时限", exact: true })
          .click();
        if (verifyUpdated)
          assert.equal(
            await inspector
              .getByRole("button", { name: "预览候选人", exact: true })
              .count(),
            0
          );
        await page.screenshot({
          path: path.join(directory, `${workflow.flowType}-form.png`),
          fullPage: true,
        });
        await page
          .getByRole("tab", { name: "结果与分支", exact: true })
          .click();
        if (verifyUpdated)
          assert((await inspector.innerText()).includes("拒绝即取消实例"));
      }
    }
    await page.goto(`${base}#/system/identity`, { waitUntil: "domcontentloaded" });
    await page
      .getByPlaceholder("搜索名称、账号或邮箱", { exact: true })
      .fill(login.username);
    await page
      .getByRole("button")
      .filter({ hasText: login.username })
      .first()
      .click();
    await page
      .getByText(/^直接角色/)
      .first()
      .waitFor();
    if (verifySources) {
      await page
        .getByText("管理员账号自带全部全局权限，撤销角色不会移除这些权限。", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.getByText("账号内置：管理员", { exact: true }).count(),
        7
      );
    }
    await page.screenshot({
      path: path.join(directory, "identity.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        stage: "identity",
        text: (await page.locator("body").innerText()).slice(0, 3500),
        errors,
      })
    );
    await page.getByRole("button", { name: "新增账号", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "新增单个账号", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({
      path: path.join(directory, "create-account.png"),
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        stage: "create-account",
        text: await page.getByRole("dialog").innerText(),
      })
    );
    if (verifyUpdated) {
      const dialog = page.getByRole("dialog"),
        username = dialog.getByLabel("用户名（3–64 位）", { exact: true });
      const displayName = dialog.getByLabel("显示名称", { exact: true }),
        password = dialog.getByLabel("初始密码（至少 12 位）", { exact: true });
      const email = dialog.getByLabel("邮箱（可选）", { exact: true });
      let submissions = 0;
      page.on("request", request => {
        if (
          request.method() === "POST" &&
          request.url().includes("iam.createUser")
        )
          submissions++;
      });
      await username.fill("12invalid");
      await displayName.fill("保留填写_" + tag);
      const newPassword = "Test9_" + randomBytes(24).toString("base64url");
      await password.fill(newPassword);
      await email.fill("fixture@example.com");
      await dialog
        .getByRole("button", { name: "创建账号", exact: true })
        .click();
      assert.equal(
        await username.evaluate(element => element.validity.patternMismatch),
        true
      );
      assert.equal(submissions, 0);
      await username.fill(login.username);
      await dialog
        .getByRole("button", { name: "创建账号", exact: true })
        .click();
      await dialog
        .getByRole("alert")
        .filter({ hasText: "用户名已存在，请更换用户名。" })
        .waitFor();
      assert.equal(await username.inputValue(), login.username);
      assert.equal(await displayName.inputValue(), "保留填写_" + tag);
      assert.equal(await password.inputValue(), newPassword);
      assert.equal(await email.inputValue(), "fixture@example.com");
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await dialog.boundingBox();
      assert(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= 390 &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 844
      );
      await page.screenshot({
        path: path.join(directory, "create-account-mobile-error.png"),
        fullPage: true,
      });
      console.log(
        JSON.stringify({
          stage: "create-account-validation",
          nativeValidation: true,
          chineseConflict: true,
          fieldsPreserved: true,
          mobileWithinViewport: true,
        })
      );
      const createdUsername = tag + "_created";
      fixture.pendingPeople = [
        { username: createdUsername, name: "保留填写_" + tag },
      ];
      fs.writeFileSync(
        path.join(directory, "fixture.json"),
        JSON.stringify(fixture),
        "utf8"
      );
      await username.fill(createdUsername);
      const createdResponse = page.waitForResponse(
        response =>
          response.request().method() === "POST" &&
          response.url().includes("iam.createUser") &&
          response.ok()
      );
      await dialog
        .getByRole("button", { name: "创建账号", exact: true })
        .click();
      const body = await (await createdResponse).json();
      const created = (Array.isArray(body) ? body[0] : body).result.data.json;
      assert(Number.isInteger(created.userId));
      fixture.people.push({ id: created.userId, username: createdUsername });
      fs.writeFileSync(
        path.join(directory, "fixture.json"),
        JSON.stringify(fixture),
        "utf8"
      );
      await dialog.waitFor({ state: "hidden" });
      console.log(
        JSON.stringify({
          stage: "create-account-retry",
          created: true,
          dialogClosed: true,
        })
      );
    }
    if (verifyStatus) {
      assert(
        verifyUpdated,
        "Status verification requires account creation verification"
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      const search = page.getByPlaceholder("搜索名称、账号或邮箱", {
        exact: true,
      });
      await search.fill(login.username);
      await page
        .getByRole("button", {
          name: "更多账号操作：界面隔离验收_" + tag,
          exact: true,
        })
        .click();
      assert.equal(
        await page
          .getByRole("menuitem", { name: "当前登录账号", exact: true })
          .isDisabled(),
        true
      );
      await page.keyboard.press("Escape");
      await search.fill(tag + "_created");
      const more = page.getByRole("button", {
        name: "更多账号操作：保留填写_" + tag,
        exact: true,
      });
      const open = async action => {
        await more.click();
        await page
          .getByRole("menuitem", { name: action + "账号", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "确认" + action + "账号", exact: true })
          .waitFor();
        assert(
          (await page.getByRole("dialog").innerText()).includes(
            tag + "_created"
          )
        );
      };
      await open("停用");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await open("停用");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认停用", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByLabel("账号状态", { exact: true })
        .selectOption("disabled");
      await open("启用");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认启用", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByLabel("账号状态", { exact: true }).selectOption("all");
      await open("停用");
      await remote({ action: "cycle_status", fixture });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认停用", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("alert")
        .filter({ hasText: "账号状态已变化" })
        .waitFor();
      await page.screenshot({
        path: path.join(directory, "status-conflict.png"),
        fullPage: true,
      });
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "刷新并重新确认", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认停用", exact: true })
        .waitFor();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认停用", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      console.log(
        JSON.stringify({
          stage: "account-status-confirmation",
          selfActionDisabled: true,
          cancelPreserved: true,
          disableEnable: true,
          staleRevisionDenied: true,
          refreshAndReconfirm: true,
        })
      );
    }
    assert.deepEqual(errors, []);
    if (verifySources) {
      await remote({ action: "grant_identity", fixture });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "退出", exact: true }).click();
      await page
        .getByLabel("用户名", { exact: true })
        .fill(memberLogin.username);
      await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
      await page
        .getByRole("button", { name: "登录流程引擎", exact: true })
        .click();
      await page.goto(`${base}#/system/config`, { waitUntil: "domcontentloaded" });
      await page
        .getByRole("button", { name: "新增账号", exact: true })
        .waitFor();
      assert(page.url().endsWith("#/system/identity"));
      await page
        .getByPlaceholder("搜索名称、账号或邮箱", { exact: true })
        .fill(memberLogin.username);
      await page
        .getByRole("button")
        .filter({ hasText: memberLogin.username })
        .first()
        .click();
      await page
        .getByText("直接授权：临时身份管理员_" + tag, { exact: true })
        .waitFor();
      await page.screenshot({
        path: path.join(directory, "delegated-identity-manager.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "组织架构", exact: true }).click();
      await page
        .getByRole("heading", { name: "组织架构管理", exact: true })
        .waitFor();
      console.log(
        JSON.stringify({
          stage: "delegated-identity-manager",
          identityPage: true,
          generalSettingsRedirected: true,
          organizationEntry: true,
        })
      );
      await remote({ action: "revoke_identity", fixture });
      await page.goto(`${base}#/system/identity`, { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("[data-aiflow-business-center]").waitFor();
      assert.equal(
        await page.getByRole("tab", { name: "系统配置", exact: true }).count(),
        0
      );
      assert.equal(
        await page
          .getByRole("button", { name: "新增账号", exact: true })
          .count(),
        0
      );
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          stage: "delegated-identity-revoked",
          managementEntryRemoved: true,
        })
      );
    }
    if (verifyProjectPaging)
      assert.equal(requests.some(url => /(?:\/|,)project\.list(?:\?|,|$)/.test(url)), false, "浏览器仍在读取全量项目列表");
    assert.deepEqual(errors, []);
  } catch (error) {
    const page = browser?.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
      const diagnostic = await page.evaluate(() => ({ url: location.href,
        controls: [...document.querySelectorAll("input,button,[role='combobox']")].map(element => ({ tag: element.tagName, role: element.getAttribute("role"), label: element.getAttribute("aria-label"), labelledBy: element.getAttribute("aria-labelledby"), placeholder: element.getAttribute("placeholder"), visible: Boolean(element.getClientRects().length) })),
      })).catch(() => null);
      fs.writeFileSync(path.join(directory, "failure-controls.json"), JSON.stringify(diagnostic), "utf8");
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    if (fixture)
      console.log((await remote({ action: "cleanup", fixture })).trim());
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
