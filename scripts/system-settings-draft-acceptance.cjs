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

async function expectChecked(locator, checked) {
  if (checked) await expect(locator).toBeChecked();
  else await expect(locator).not.toBeChecked();
}
// Settings acceptance begins here. Every actual setting submission is a guarded no-op.
(async () => {
  let browser,
    page,
    failed = false,
    violation = "";
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
      accountOnly: true,
    });
    await owner("auth.login", login, true);
    const beforeFingerprint = JSON.parse(
      (await remote({ action: "settings_fingerprint" })).trim()
    ).settingsFingerprint;
    const baseline = await owner("config.settings", {});
    const reproduce = process.env.FLOW_UI_SETTINGS_REPRO === "1";
    const raw = baseline.general;
    const unchanged = {
      platformName: raw.platformName ?? "Flow AI Engine",
      watermarkEnabled: raw.watermarkEnabled ?? false,
      watermarkText: raw.watermarkText ?? "",
    };
    assert(
      typeof unchanged.platformName === "string" &&
        typeof unchanged.watermarkEnabled === "boolean" &&
        typeof unchanged.watermarkText === "string"
    );
    assert(
      unchanged.platformName.trim() === unchanged.platformName &&
        unchanged.platformName.length < 119 &&
        unchanged.watermarkText.trim() === unchanged.watermarkText
    );
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
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let posts = 0,
      staleNext = false,
      failRead = false,
      holdNext = false,
      heldSignal,
      releaseHeld,
      held;
    await page.route("**/api/trpc/**", async route => {
      const request = route.request(),
        url = new URL(request.url());
      const names = decodeURIComponent(
        url.pathname.slice(url.pathname.indexOf("/api/trpc/") + 10)
      ).split(",");
      if (
        request.method() === "GET" &&
        names.includes("config.settings") &&
        failRead
      ) {
        failRead = false;
        await route.abort("failed");
        return;
      }
      const index = names.indexOf("config.updateSetting");
      if (request.method() !== "POST" || index < 0) {
        await route.continue();
        return;
      }
      try {
        const packet = JSON.parse(request.postData() ?? "null");
        const input = (
          url.searchParams.get("batch") === "1" ? packet[String(index)] : packet
        ).json;
        if (
          names.length !== 1 ||
          input.key !== "general" ||
          input.expectedConfigToken !== baseline.configTokens.general ||
          Object.keys(input.value).sort().join(",") !==
            Object.keys(unchanged).sort().join(",") ||
          Object.entries(unchanged).some(
            ([key, value]) => input.value[key] !== value
          )
        )
          throw new Error(
            "Blocked setting submission: expected an unchanged value and its original snapshot"
          );
        posts++;
        if (staleNext) {
          staleNext = false;
          input.expectedConfigToken = "0".repeat(64);
        }
        if (holdNext) {
          holdNext = false;
          heldSignal();
          await held;
        }
        await route.continue({ postData: JSON.stringify(packet) });
      } catch (error) {
        violation = error.message;
        heldSignal?.();
        await route.abort("blockedbyclient");
      }
    });
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(base + "#/system");
    const field = page.getByRole("textbox", { name: "平台名称", exact: true });
    const category = async key => {
      if (page.viewportSize().width < 1024)
        await page
          .getByRole("combobox", { name: "系统配置分类", exact: true })
          .selectOption(key);
      else
        await page
          .getByRole("button", {
            name: {
              general: "通用设置",
              approval: "审批配置",
              domain: "工作域配置",
            }[key],
            exact: true,
          })
          .click();
    };
    await expect(field).toBeEnabled();
    const original = await field.inputValue(),
      draftName = "未保存设置_" + tag;
    await field.fill(draftName);
    await category("approval");
    if (reproduce) {
      await category("general");
      await expect(field).toHaveValue(original);
      assert.equal(posts, 0);
      report({
        stage: "settings-draft-reproduction",
        bugConfirmed: true,
        tabSwitchLostDraft: true,
        globalSettingsWrites: 0,
      });
      return;
    }
    assert(/^[a-f0-9]{64}$/.test(baseline.configTokens.general));
    const required = page.getByRole("checkbox", {
      name: "要求审核通过后发布",
      exact: true,
    });
    const originalRequired = await required.isChecked();
    await required.setChecked(!originalRequired);
    await category("general");
    await expect(field).toHaveValue(draftName);
    const bar = page.locator("[data-settings-change-bar]");
    await expect(bar).toContainText("2 项未保存修改");
    const outsideNavigation = async () => {
      const navBounds = await page
        .locator("[data-system-config-navigation]")
        .boundingBox();
      const barBounds = await bar.boundingBox();
      assert(barBounds.x >= navBounds.x + navBounds.width);
    };
    await outsideNavigation();
    await page
      .getByRole("button", { name: "收起配置导航", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "展开配置导航", exact: true })
    ).toBeVisible();
    await outsideNavigation();
    await page
      .getByRole("button", { name: "展开配置导航", exact: true })
      .click();
    await bar.getByRole("button", { name: "查看改动", exact: true }).click();
    const diff = page.getByRole("dialog", {
      name: "查看配置改动",
      exact: true,
    });
    await expect(diff).toContainText(draftName);
    await expect(diff).toContainText("发布前审核");
    await diff.getByRole("button", { name: "返回编辑", exact: true }).click();
    await expect(
      bar.getByRole("button", { name: "查看改动", exact: true })
    ).toBeFocused();
    const downloading = page.waitForEvent("download");
    await bar.getByRole("button", { name: "导出填写", exact: true }).click();
    const download = await downloading,
      exportPath = path.join(directory, "settings-drafts.json");
    await download.saveAs(exportPath);
    const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    assert.equal(exported.drafts.length, 2);
    assert.equal(
      exported.drafts.find(d => d.key === "general").values.platformName,
      draftName
    );
    assert(
      !(
        "platformName" in exported.drafts.find(d => d.key === "approval").values
      )
    );
    await category("domain");
    await expect(bar).toBeVisible();
    await bar.getByRole("button", { name: /通用设置 · 1/ }).click();
    await expect(field).toHaveValue(draftName);
    await page.getByRole("tab", { name: "流程仓库", exact: true }).click();
    const leave = page.getByRole("alertdialog", {
      name: "离开前保留配置修改",
      exact: true,
    });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(field).toHaveValue(draftName);
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "退出", exact: true })
    ).toBeFocused();
    const beforeUnload = page.waitForEvent("dialog");
    const cancelledReload = page.reload().catch(() => {});
    const native = await beforeUnload;
    assert.equal(native.type(), "beforeunload");
    await native.dismiss();
    await cancelledReload;
    await expect(field).toHaveValue(draftName);
    await bar
      .getByRole("button", { name: "放弃未保存修改", exact: true })
      .click();
    const discard = page.getByRole("alertdialog", {
      name: "放弃未保存的配置修改",
      exact: true,
    });
    await discard
      .getByRole("button", { name: "继续编辑", exact: true })
      .click();
    await expect(field).toHaveValue(draftName);
    await bar
      .getByRole("button", { name: "放弃未保存修改", exact: true })
      .click();
    await discard
      .getByRole("button", { name: "放弃全部未保存修改", exact: true })
      .click();
    await expect(bar).toHaveCount(0);
    await expect(field).toHaveValue(original);
    await category("approval");
    await expectChecked(required, originalRequired);
    await category("general");
    report({
      stage: "settings-drafts",
      twoCategoriesRetained: true,
      changeDiff: true,
      exported: true,
      domainSwitchRetained: true,
      navigationAndLogoutGuarded: true,
      nativeReloadGuarded: true,
      explicitDiscard: true,
    });

    await field.fill(original + " ");
    staleNext = true;
    await bar
      .getByRole("button", { name: "保存通用设置", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("其他管理员");
    await expect(field).toHaveValue(original + " ");
    await expect(
      bar.getByRole("button", { name: "保存通用设置", exact: true })
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "读取最新配置", exact: true })
      .click();
    const reload = page.getByRole("alertdialog", {
      name: "读取最新配置前保留修改",
      exact: true,
    });
    await reload.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(field).toHaveValue(original + " ");
    await page
      .getByRole("button", { name: "读取最新配置", exact: true })
      .click();
    await reload
      .getByRole("button", { name: "替换为最新配置", exact: true })
      .click();
    await expect(field).toHaveValue(original);
    await expect(bar).toHaveCount(0);
    report({
      stage: "settings-stale-save",
      realServerRejectedStaleToken: true,
      draftRetained: true,
      explicitReload: true,
    });

    await field.fill(original + " ");
    holdNext = true;
    held = new Promise(resolve => {
      releaseHeld = resolve;
    });
    const seen = new Promise(resolve => {
      heldSignal = resolve;
    });
    try {
      await bar
        .getByRole("button", { name: "保存通用设置", exact: true })
        .click();
      await Promise.race([
        seen,
        sleep(15000).then(() => {
          throw new Error("Setting request not observed");
        }),
      ]);
      assert.equal(violation, "");
      await expect(field).toBeDisabled();
      await expect(
        bar.getByRole("button", { name: "放弃未保存修改", exact: true })
      ).toBeDisabled();
      await page.getByRole("tab", { name: "流程仓库", exact: true }).click();
      await expect(leave).toHaveCount(0);
      assert(page.url().endsWith("#/system"));
      await page.getByRole("button", { name: "退出", exact: true }).click();
      await expect(leave).toHaveCount(0);
      await expect(field).toBeDisabled();
    } finally {
      releaseHeld();
    }
    await expect(bar).toHaveCount(0);
    await expect(field).toHaveValue(original);
    await expect(field).toBeEnabled();
    assert.deepEqual(await owner("config.settings", {}), baseline);
    report({
      stage: "settings-save",
      realUnchangedSubmission: true,
      fieldsAndExitLockedWhilePending: true,
      configurationUnchanged: true,
    });

    await category("approval");
    await required.setChecked(!originalRequired);
    await category("general");
    await field.fill(original + " ");
    failRead = true;
    await bar
      .getByRole("button", { name: "保存通用设置", exact: true })
      .click();
    await expect(bar).toContainText("不会重复提交配置");
    const committedPosts = posts;
    await category("approval");
    await expectChecked(required, !originalRequired);
    await expect(required).toBeDisabled();
    await bar.getByRole("button", { name: "重试刷新", exact: true }).click();
    await expect(required).toBeEnabled();
    await expectChecked(required, !originalRequired);
    assert.equal(posts, committedPosts);
    await bar
      .getByRole("button", { name: "放弃未保存修改", exact: true })
      .click();
    await discard
      .getByRole("button", { name: "放弃全部未保存修改", exact: true })
      .click();
    await expect(bar).toHaveCount(0);
    await category("general");
    await expect(field).toHaveValue(original);
    report({
      stage: "settings-refresh-recovery",
      acknowledgedSaveRetained: true,
      retryDidNotSubmitAgain: true,
      otherDraftSurvivedRefreshFailure: true,
    });

    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await field.fill(draftName);
      await category("approval");
      await required.setChecked(!originalRequired);
      await category("general");
      await expect(field).toHaveValue(draftName);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      const bounds = await bar.boundingBox();
      if (width >= 1024) await outsideNavigation();
      assert(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= width + 1 &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 845
      );
      await bar.getByRole("button", { name: "查看改动", exact: true }).click();
      await expect(diff).toBeVisible();
      await page.screenshot({
        path: path.join(directory, `settings-diff-${width}.png`),
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await expect(diff).toBeHidden();
      await expect(
        bar.getByRole("button", { name: "查看改动", exact: true })
      ).toBeFocused();
      await page.screenshot({
        path: path.join(directory, `settings-editor-${width}.png`),
        animations: "disabled",
      });
      await bar
        .getByRole("button", { name: "放弃未保存修改", exact: true })
        .click();
      await discard
        .getByRole("button", { name: "放弃全部未保存修改", exact: true })
        .click();
      await expect(bar).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await field.fill(draftName);
    await page.getByRole("tab", { name: "流程仓库", exact: true }).click();
    await leave
      .getByRole("button", { name: "放弃修改并离开", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/warehouse$/);
    await page.goto(base + "#/system");
    await expect(field).toHaveValue(original);
    await expect(bar).toHaveCount(0);
    const denied = async call =>
      assert.rejects(call, error => error.status === 409);
    await denied(
      owner("config.updateSetting", { key: "general", value: {} }, true)
    );
    await denied(
      owner(
        "config.updateSetting",
        { key: "general", value: {}, expectedConfigToken: "0".repeat(64) },
        true
      )
    );
    for (const key of ["general", "approval"]) {
      const result = await owner(
        "config.updateSetting",
        { key, value: {}, expectedConfigToken: baseline.configTokens[key] },
        true
      );
      assert.equal(result.configToken, baseline.configTokens[key]);
    }
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await viewer("auth.login", memberLogin, true);
    await assert.rejects(
      viewer("config.settings", {}),
      error => error.status === 403
    );
    await assert.rejects(
      viewer(
        "config.updateSetting",
        {
          key: "general",
          value: {},
          expectedConfigToken: baseline.configTokens.general,
        },
        true
      ),
      error => error.status === 403
    );
    assert.deepEqual(await owner("config.settings", {}), baseline);
    const audit = await owner("iam.authorizationAudit", { limit: 200 });
    assert.equal(
      audit.filter(
        row =>
          Number(row.actorUserId) === fixture.userId &&
          row.resourceType === "system_setting"
      ).length,
      0
    );
    const afterFingerprint = JSON.parse(
      (await remote({ action: "settings_fingerprint" })).trim()
    ).settingsFingerprint;
    assert.equal(afterFingerprint, beforeFingerprint);
    assert.equal(violation, "");
    assert.deepEqual(errors, []);
    report({
      stage: "settings-complete",
      viewportWidths: [320, 390, 1024, 1440],
      ordinaryAccountRejected: true,
      missingAndStaleTokensRejected: true,
      globalConfigurationUnchanged: true,
      storedSettingRowsAndMetadataUnchanged: true,
      settingWriteAuditCount: 0,
      browserErrors: 0,
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
