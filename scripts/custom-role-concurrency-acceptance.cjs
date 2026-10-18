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

const code = "custom_edit_" + tag.slice(9);
const getRole = async () =>
  (await owner("iam.roles", {})).find(role => role.code === code);
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
      accountOnly: true,
    });
    report({ stage: "role-configuration-fixture", tag });
    await owner("auth.login", login, true);
    fixture.managedRoles = [{ code }];
    fs.writeFileSync(
      path.join(directory, "fixture.json"),
      JSON.stringify(fixture),
      "utf8"
    );
    await owner(
      "iam.createCustomRole",
      {
        code,
        name: "角色配置验收_初始_" + tag,
        scope: "workflow",
        permissions: ["workflow:view"],
      },
      true
    );
    const original = await getRole();
    assert(original);
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
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await page.locator('input[type="password"]').waitFor({ state: "hidden" });
    await page.goto(base + "#/system/identity");
    await page.getByRole("tab", { name: "角色与权限", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索角色", exact: true })
      .fill(code);
    const row = page.locator("[data-iam-role-row]").filter({ hasText: code });
    await row.locator("button[aria-pressed]").click();
    await page.getByRole("button", { name: "编辑角色", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "编辑自定义角色",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    const localName = "角色配置验收_我的草稿_" + tag;
    const externalName = "角色配置验收_其他管理员_" + tag;
    await dialog.getByLabel("角色名称", { exact: true }).fill(localName);
    await dialog.getByRole("checkbox", { name: /编辑流程/ }).check();
    await owner(
      "iam.updateCustomRole",
      {
        code,
        name: externalName,
        permissions: ["workflow:view", "workflow:run"],
        expectedConfigToken: original.configToken,
      },
      true
    );
    await dialog.getByRole("button", { name: "保存角色", exact: true }).click();
    const reproduce = process.env.FLOW_UI_ROLE_REPRO === "1";
    if (reproduce) {
      await expect(dialog).toBeHidden();
      const saved = await getRole();
      assert.equal(saved.name, localName);
      const permissions =
        typeof saved.permissions === "string"
          ? JSON.parse(saved.permissions)
          : saved.permissions;
      assert(
        permissions.includes("workflow:edit") &&
          !permissions.includes("workflow:run")
      );
      report({
        stage: "role-overwrite-reproduction",
        staleDraftOverwroteNewPermissions: true,
        bugConfirmed: true,
      });
    } else {
      await expect(dialog.getByRole("alert")).toContainText(/更新|变化/);
      await expect(dialog.getByLabel("角色名称", { exact: true })).toHaveValue(
        localName
      );
      const current = await getRole();
      assert.equal(current.name, externalName);
      report({
        stage: "role-stale-save",
        preservedCurrentConfiguration: true,
        retainedLocalDraft: true,
      });

      await page.keyboard.press("Escape");
      const closeWarning = page.getByRole("alertdialog", {
        name: "关闭前保留角色修改",
        exact: true,
      });
      await expect(closeWarning).toBeVisible();
      await closeWarning
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(dialog.getByLabel("角色名称", { exact: true })).toHaveValue(
        localName
      );
      const downloadEvent = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "导出当前填写", exact: true })
        .click();
      const download = await downloadEvent;
      const exported = path.join(directory, "role-draft.json");
      await download.saveAs(exported);
      const draft = JSON.parse(fs.readFileSync(exported, "utf8"));
      assert.equal(draft.name, localName);
      assert(
        draft.permissions.includes("workflow:edit") &&
          !draft.permissions.includes("workflow:run")
      );
      await dialog
        .getByRole("button", { name: "读取最新配置", exact: true })
        .click();
      const reloadWarning = page.getByRole("alertdialog", {
        name: "读取最新配置前保留修改",
        exact: true,
      });
      await reloadWarning
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(dialog.getByLabel("角色名称", { exact: true })).toHaveValue(
        localName
      );
      await dialog
        .getByRole("button", { name: "读取最新配置", exact: true })
        .click();
      await reloadWarning
        .getByRole("button", {
          name: "丢弃当前修改并读取最新角色",
          exact: true,
        })
        .click();
      await expect(dialog.getByLabel("角色名称", { exact: true })).toHaveValue(
        externalName
      );
      await expect(
        dialog.getByRole("checkbox", { name: /运行流程/ })
      ).toBeChecked();
      await expect(
        dialog.getByRole("checkbox", { name: /编辑流程/ })
      ).not.toBeChecked();
      await dialog
        .getByRole("button", { name: "设计与发布", exact: true })
        .click();
      const mergedName = "角色配置验收_重新确认_" + tag;
      await dialog.getByLabel("角色名称", { exact: true }).fill(mergedName);
      await dialog.getByLabel("角色名称", { exact: true }).press("Enter");
      await expect(dialog).toBeHidden();
      const merged = await getRole();
      assert.equal(merged.name, mergedName);
      assert.deepEqual(
        [
          ...JSON.parse(
            JSON.stringify(
              typeof merged.permissions === "string"
                ? JSON.parse(merged.permissions)
                : merged.permissions
            )
          ),
        ].sort(),
        ["workflow:edit", "workflow:publish", "workflow:view"]
      );
      report({
        stage: "role-draft-recovery",
        closeAndReloadConfirmations: true,
        exportedDraft: true,
        presetAndEnterSave: true,
      });

      // A delegated IAM administrator opens a repeatable-read snapshot before
      // waiting for the same role, exercising permission-only concurrent edits.
      await remote({ action: "grant_identity", fixture });
      await viewer("auth.login", memberLogin, true);
      const read = () => owner("iam.customRoleConfiguration", { code });
      const denied = async (call, status) =>
        assert.rejects(call, error => error.status === status);
      for (let index = 0; index < 6; index++) {
        const before = await read();
        const choices = [
          ["workflow:view", "workflow:run"],
          ["workflow:view", "workflow:edit"],
        ];
        // The initial set differs from both candidates, so every winning write
        // changes its token even though the name remains identical.
        await owner(
          "iam.updateCustomRole",
          {
            code,
            permissions: ["workflow:view", "workflow:publish"],
            expectedConfigToken: before.configToken,
          },
          true
        );
        const snapshot = await read();
        const results = await Promise.allSettled(
          [owner, viewer].map((request, i) =>
            request(
              "iam.updateCustomRole",
              {
                code,
                permissions: choices[i],
                expectedConfigToken: snapshot.configToken,
              },
              true
            )
          )
        );
        assert.equal(
          results.filter(result => result.status === "fulfilled").length,
          1
        );
        const loser = results.find(result => result.status === "rejected");
        assert.equal(loser.reason.status, 409);
        const winner = results.findIndex(
          result => result.status === "fulfilled"
        );
        assert.deepEqual(
          (await read()).permissions.sort(),
          choices[winner].sort()
        );
      }
      const beforeMissing = await read();
      await denied(
        owner(
          "iam.updateCustomRole",
          { code, name: "角色配置验收_不应保存_" + tag },
          true
        ),
        409
      );
      await denied(owner("iam.deleteCustomRole", { code }, true), 409);
      await denied(
        owner(
          "iam.deleteCustomRole",
          { code, expectedConfigToken: original.configToken },
          true
        ),
        409
      );
      assert.deepEqual(await read(), beforeMissing);
      report({
        stage: "role-concurrency",
        permissionOnlyRaces: 6,
        oneWinnerEach: true,
        missingAndStaleTokensRejected: true,
      });

      // Fresh configuration is loaded for deletion; a later edit must invalidate it.
      await page.getByRole("button", { name: "删除角色", exact: true }).click();
      const deletion = page.getByRole("dialog", {
        name: "删除自定义角色",
        exact: true,
      });
      await deletion.getByLabel("输入角色编码确认", { exact: true }).fill(code);
      const beforeDelete = await read();
      await owner(
        "iam.updateCustomRole",
        {
          code,
          name: "角色配置验收_删除前变化_" + tag,
          expectedConfigToken: beforeDelete.configToken,
        },
        true
      );
      await deletion
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await expect(deletion.getByRole("alert")).toContainText(/更新|变化/);
      assert(await getRole());
      await deletion
        .getByRole("button", { name: "读取最新配置", exact: true })
        .click();
      await expect(
        deletion.getByLabel("输入角色编码确认", { exact: true })
      ).toHaveValue("");
      await deletion.getByLabel("输入角色编码确认", { exact: true }).fill(code);
      const removedSnapshot = await read();
      await deletion
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await expect(deletion).toBeHidden();
      assert.equal(await getRole(), undefined);

      await page.getByRole("button", { name: "新增角色", exact: true }).click();
      const creation = page.getByRole("dialog", {
        name: "新增自定义角色",
        exact: true,
      });
      await creation
        .getByLabel("角色名称", { exact: true })
        .fill(removedSnapshot.name);
      await creation.getByLabel("角色编码", { exact: true }).fill(code);
      assert.equal(
        await creation
          .getByLabel("角色编码", { exact: true })
          .getAttribute("maxlength"),
        "64"
      );
      await creation
        .getByRole("button", { name: "身份管理", exact: true })
        .click();
      await creation
        .getByLabel("适用范围", { exact: true })
        .selectOption("workflow");
      await expect(
        creation.getByRole("button", { name: "身份管理", exact: true })
      ).toHaveCount(0);
      await expect(
        creation.getByRole("button", { name: "保存角色", exact: true })
      ).toBeDisabled();
      await creation
        .getByRole("button", { name: "清空勾选", exact: true })
        .click();
      for (const permission of removedSnapshot.permissions) {
        const labels = {
          "workflow:view": /查看流程/,
          "workflow:edit": /编辑流程/,
          "workflow:run": /运行流程/,
        };
        await creation
          .getByRole("checkbox", { name: labels[permission] })
          .check();
      }
      await expect(creation.locator("code")).toHaveCount(0);
      await creation
        .getByRole("checkbox", { name: "显示权限标识", exact: true })
        .check();
      assert((await creation.locator("code").count()) > 0);
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      await page.keyboard.press("Escape");
      await closeWarning
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(
        creation.getByLabel("角色名称", { exact: true })
      ).toHaveValue(removedSnapshot.name);
      await page.setViewportSize({ width: 320, height: 740 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      let releaseCreate, signalCreate;
      const createHeld = new Promise(resolve => {
        releaseCreate = resolve;
      });
      const createSeen = new Promise(resolve => {
        signalCreate = resolve;
      });
      const holdCreate = async route => {
        signalCreate();
        await createHeld;
        await route.continue();
      };
      await page.route("**/api/trpc/iam.createCustomRole**", holdCreate);
      try {
        await creation
          .getByRole("button", { name: "保存角色", exact: true })
          .click();
        await Promise.race([
          createSeen,
          sleep(15000).then(() => {
            throw new Error("Create request was not observed");
          }),
        ]);
        await expect(
          creation.getByLabel("角色名称", { exact: true })
        ).toBeDisabled();
        await expect(
          creation.getByRole("button", { name: "关闭", exact: true })
        ).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(creation).toBeVisible();
        await expect(closeWarning).toHaveCount(0);
      } finally {
        releaseCreate();
      }
      await expect(creation).toBeHidden();
      await page.unroute("**/api/trpc/iam.createCustomRole**", holdCreate);
      const recreated = await read();
      assert.notEqual(recreated.id, removedSnapshot.id);
      assert.equal(recreated.name, removedSnapshot.name);
      assert.deepEqual(
        recreated.permissions.sort(),
        removedSnapshot.permissions.sort()
      );
      await denied(
        owner(
          "iam.updateCustomRole",
          {
            code,
            name: localName,
            expectedConfigToken: removedSnapshot.configToken,
          },
          true
        ),
        409
      );
      await denied(
        owner(
          "iam.deleteCustomRole",
          { code, expectedConfigToken: removedSnapshot.configToken },
          true
        ),
        409
      );
      report({
        stage: "role-delete-and-recreate",
        staleDeleteRejected: true,
        immutableIdentityProtected: true,
        mobileDraftPreserved: true,
        scopePresetsChecked: true,
        pendingControlsLocked: true,
        widths: [390, 320],
      });

      const longCode = code.padEnd(64, "x");
      fixture.managedRoles.push({ code: longCode });
      await owner(
        "iam.createCustomRole",
        {
          code: longCode,
          name: "角色配置验收_编码边界_" + tag,
          scope: "workflow",
          permissions: ["workflow:view"],
        },
        true
      );
      await denied(
        owner(
          "iam.createCustomRole",
          {
            code: longCode + "x",
            name: "角色配置验收_不应创建_" + tag,
            scope: "workflow",
            permissions: ["workflow:view"],
          },
          true
        ),
        400
      );
      report({
        stage: "role-code-boundary",
        accepted64: true,
        rejected65: true,
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
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (fixture?.tag) {
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
