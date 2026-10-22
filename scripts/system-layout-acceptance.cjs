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

const owner = session();
const baseline = process.env.FLOW_UI_LAYOUT_BASELINE === "1";
const visible = async locator => await expect(locator.first()).toBeVisible();
(async () => {
  let browser,
    page,
    failed = false,
    fingerprint;
  const metrics = [];
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await owner("auth.login", login, true);
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
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(login.username);
    await page.getByLabel("密码", { exact: true }).fill(login.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await visible(page.locator("[data-aiflow-business-center]"));
    async function measure(key, width = 1440) {
      await page.setViewportSize({ width, height: 1000 });
      if (!baseline)
        await expect
          .poll(() =>
            page.evaluate(() => ({
              width: innerWidth,
              pageTitle: getComputedStyle(document.documentElement)
                .getPropertyValue("--aiflow-type-page-title")
                .trim(),
              gutter: getComputedStyle(document.documentElement)
                .getPropertyValue("--aiflow-page-gutter")
                .trim(),
            }))
          )
          .toEqual({
            width,
            pageTitle: width < 768 ? "1.25rem" : "1.375rem",
            gutter: width < 768 ? "1rem" : "1.5rem",
          });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
          timeout: 6000,
        })
        .toBeLessThanOrEqual(width + 1);
      const result = await page.evaluate(() => {
        const shown = element => {
          const r = element.getBoundingClientRect();
          const s = getComputedStyle(element);
          return (
            r.width > 0 &&
            r.height > 0 &&
            s.visibility !== "hidden" &&
            element.getAttribute("aria-hidden") !== "true"
          );
        };
        const group = selector =>
          Array.from(document.querySelectorAll(selector))
            .filter(shown)
            .map(el => ({
              text: el.textContent?.trim().slice(0, 70),
              font: parseFloat(getComputedStyle(el).fontSize),
              line: parseFloat(getComputedStyle(el).lineHeight),
            }));
        const box = selector => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            left: r.left,
            right: r.right,
            width: r.width,
            paddingLeft: parseFloat(s.paddingLeft),
            paddingTop: parseFloat(s.paddingTop),
          };
        };
        return {
          width: innerWidth,
          document: document.documentElement.scrollWidth,
          body: parseFloat(getComputedStyle(document.body).fontSize),
          page: group("h1,[data-aiflow-page-title]"),
          bodyText: group(".aiflow-type-body"),
          meta: group(".aiflow-type-meta"),
          section: group(".aiflow-type-section-title"),
          controls: group(
            "input:not([type=checkbox]):not([type=radio]),select,[data-aiflow-primary-nav] button"
          ),
          dialog: group(
            "[data-slot=dialog-title],[data-slot=alert-dialog-title]"
          ),
          frame: box(".aiflow-page-frame"),
          content: box(".aiflow-page-content"),
          projectRail: box("[data-aiflow-project-workspace] > aside"),
          workbenchRail: box("[data-workbench-navigation]"),
          systemRail: box("[data-system-config-navigation]"),
        };
      });
      metrics.push({ key, ...result });
      fs.writeFileSync(
        path.join(directory, "layout-metrics.json"),
        JSON.stringify(metrics, null, 2),
        "utf8"
      );
      await page.screenshot({
        path: path.join(directory, key + "-" + width + ".png"),
        animations: "disabled",
      });
      if (!baseline) {
        assert.equal(result.body, 14, key + " body font");
        for (const item of result.bodyText)
          assert.equal(item.font, 14, key + " body " + item.text);
        for (const item of result.meta)
          assert.equal(item.font, 13, key + " metadata " + item.text);
        for (const item of result.section)
          assert.equal(item.font, 16, key + " section " + item.text);
        for (const item of result.controls)
          assert.equal(item.font, 14, key + " control " + item.text);
        for (const item of result.dialog)
          assert.equal(item.font, 18, key + " dialog title");
        for (const item of result.page)
          assert.equal(item.font, width < 768 ? 20 : 22, key + " page title");
        if (result.frame)
          assert.equal(
            result.frame.paddingLeft,
            width < 768 ? 16 : 24,
            key + " page gutter"
          );
        if (result.content)
          assert(result.content.width <= 1440.1, key + " content max");
      }
      report({
        stage: "system-layout",
        key,
        width,
        baseline,
        bodyFont: result.body,
        pageFont: result.page.map(x => x.font),
        bodyFonts: [...new Set(result.bodyText.map(x => x.font))],
        metaFonts: [...new Set(result.meta.map(x => x.font))],
        overflow: false,
      });
    }
    async function go(hash, selector) {
      await page.evaluate(value => {
        location.hash = value;
      }, hash);
      await visible(page.locator(selector));
    }
    // The reported business workflow is read-only: inspect its graph and actual rendering.
    const reportedId = process.env.FLOW_UI_REPORTED_WORKFLOW_ID;
    if (reportedId) {
      assert(/^[A-Za-z0-9_-]{8,128}$/.test(reportedId));
      const reported = await owner("workflow.get", { id: reportedId });
      const graph = {
        id: reported.id,
        flowType: reported.flowType,
        definitionVersion: reported.definitionVersion,
        nodes: reported.definition.nodes.map(node => ({
          id: node.id,
          type: node.type,
          name: node.name,
          position: node.position,
          configKeys: Object.keys(node.config ?? {}),
          defaultRoute: node.config?.defaultRoute,
          rules: (node.config?.routes ?? node.config?.lysz ?? []).map(rule => ({
            id: rule.id,
            handle: rule.handle,
            code: rule.code,
            label: rule.label,
            targetNodeId: rule.targetNodeId,
            routerTargetId: rule.routerTargetId,
          })),
          outcomes: node.config?.outcomes,
        })),
        edges: reported.definition.edges,
      };
      fs.writeFileSync(
        path.join(directory, "reported-flow-graph.json"),
        JSON.stringify(graph, null, 2),
        "utf8"
      );
      await go(
        "#/flows/workflow/" + reportedId + "/editor",
        "[data-workflow-editor]"
      );
      await page.screenshot({
        path: path.join(directory, "reported-flow.png"),
        animations: "disabled",
      });
      if (!baseline)
        await expect
          .poll(() => page.locator(".react-flow__edge").count())
          .toBe(graph.edges.length);
      const rendered = await page
        .locator(".react-flow__edge")
        .evaluateAll(edges =>
          edges.map(el => ({
            id: el.getAttribute("data-id"),
            path: el
              .querySelector("path.react-flow__edge-path")
              ?.getAttribute("d"),
          }))
        );
      fs.writeFileSync(
        path.join(directory, "reported-flow-rendered-edges.json"),
        JSON.stringify(rendered, null, 2),
        "utf8"
      );
      assert.equal(
        JSON.stringify(
          (await owner("workflow.get", { id: reportedId })).definition
        ),
        JSON.stringify(reported.definition),
        "Reported workflow must remain unchanged"
      );
      if (!baseline)
        assert(
          rendered.every(edge => Boolean(edge.path)),
          "Every persisted edge needs a rendered path"
        );
      report({
        stage: "reported-flow-read-only",
        nodes: graph.nodes.length,
        storedEdges: graph.edges.length,
        renderedEdges: rendered.length,
        directory,
      });
    }
    await go("#/flows", "[data-aiflow-business-center]");
    await measure("business");
    await go("#/system", "[data-aiflow-system-config]");
    await visible(page.getByLabel("平台名称", { exact: true }));
    await measure("system");
    for (const [name, key] of [
      ["审批配置", "approval"],
      ["工作域配置", "domain"],
      ["组织与权限", "access"],
      ["运行诊断", "runtime"],
    ]) {
      await page
        .locator("[data-system-config-tabs]")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("#system-config-active-tab")).toContainText(
        name
      );
      await measure("system-" + key);
    }
    await page
      .locator("[data-system-config-tabs]")
      .getByRole("button", { name: "通用设置", exact: true })
      .click();
    if (!baseline) {
      await page
        .getByRole("button", { name: "收起配置导航", exact: true })
        .click();
      await expect
        .poll(() =>
          page
            .locator("[data-system-config-navigation]")
            .evaluate(el => el.getBoundingClientRect().width)
        )
        .toBe(56);
      await page
        .getByRole("button", { name: "展开配置导航", exact: true })
        .click();
    }
    await go("#/system/identity", "[data-iam-account-create-menu]");
    await page
      .getByRole("textbox", { name: "搜索用户", exact: true })
      .fill(tag);
    await expect(
      page.getByText(login.username, { exact: true }).first()
    ).toBeVisible({ timeout: 20000 });
    await measure("identity");
    for (const [name, key] of [
      ["角色与权限", "roles"],
      ["授权审计", "audit"],
    ]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(
        page.getByRole("tab", { name, exact: true })
      ).toHaveAttribute("aria-selected", "true");
      if (key === "roles") {
        await page
          .getByRole("textbox", { name: "搜索角色", exact: true })
          .fill("workflow_creator");
        await expect(
          page.getByText("workflow_creator", { exact: true }).first()
        ).toBeVisible({ timeout: 20000 });
      } else {
        await page
          .getByRole("textbox", { name: "搜索授权审计", exact: true })
          .fill(tag);
        const auditRow = page
          .locator("[data-iam-audit-row]")
          .filter({ hasText: login.username })
          .first();
        await expect(auditRow).toBeVisible({ timeout: 20000 });
        if (!baseline) {
          const centers = await auditRow
            .locator(":scope > div:first-child > *")
            .evaluateAll(items =>
              items.map(item => {
                const bounds = item.getBoundingClientRect();
                return bounds.top + bounds.height / 2;
              })
            );
          assert.equal(
            centers.length,
            6,
            "Audit row must display all six columns"
          );
          assert(
            Math.max(...centers) - Math.min(...centers) <= 1,
            "Desktop audit cells must align on one row"
          );
        }
      }
      await measure("identity-" + key);
    }
    await page.getByRole("tab", { name: "用户账号", exact: true }).click();
    await page.locator("[data-iam-account-create-menu]").click();
    await page
      .getByRole("menuitem", { name: "新增单个账号", exact: true })
      .click();
    await visible(page.getByRole("dialog"));
    await measure("account-dialog");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await go("#/system/organization", "[data-aiflow-organization-page]");
    await measure("organization");
    await go("#/runs/workbench", "[data-workbench-layout]");
    await measure("workbench");
    await go("#/warehouse", "[data-aiflow-warehouse]");
    await measure("warehouse");
    await go(
      "#/flows/project/" + fixture.projectId,
      "[data-aiflow-project-workspace]"
    );
    await measure("project");
    if (!baseline) {
      await page
        .getByRole("button", { name: "收起项目工作区导航", exact: true })
        .click();
      await expect
        .poll(() =>
          page
            .locator("[data-aiflow-project-workspace] > aside")
            .evaluate(el => el.getBoundingClientRect().width)
        )
        .toBe(56);
      await page
        .getByRole("button", { name: "展开项目工作区导航", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "权限配置中心", exact: false })
      .first()
      .click();
    await visible(page.locator("[data-project-authorizations]"));
    await measure("project-authorization");
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await visible(page.locator("[data-resource-category-desktop]"));
    await measure("resources");
    for (const flow of fixture.workflows) {
      await go(
        "#/flows/workflow/" + flow.id + "/editor",
        "[data-workflow-editor]"
      );
      await measure("editor-" + flow.flowType);
    }
    // Four representative layouts exercise wrapping and large-screen proportions.
    for (const width of [320, 390, 1024, 1920]) {
      await go("#/flows", "[data-aiflow-business-center]");
      await measure("business", width);
      await go("#/system", "[data-aiflow-system-config]");
      await measure("system", width);
      await go("#/system/organization", "[data-aiflow-organization-page]");
      await measure("organization", width);
      await go(
        "#/flows/workflow/" + fixture.workflows[0].id + "/editor",
        "[data-workflow-editor]"
      );
      await measure("editor-state", width);
    }
    if (!baseline) {
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
      await measure("editor-dark", 1440);
      await page.getByRole("button", { name: "切换主题", exact: true }).click();
    }
    assert.deepEqual(errors, []);
    report({
      stage: "system-layout-complete",
      baseline,
      pages: metrics.length,
      browserErrors: 0,
      directory,
    });
  } catch (error) {
    failed = true;
    console.error(
      String(error.stack ?? error).replaceAll(login.password, "[credential]")
    );
    if (page)
      await page
        .screenshot({
          path: path.join(directory, "failure.png"),
          animations: "disabled",
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (fixture) {
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
      try {
        report({ output: await remote({ action: "cleanup", fixture, login }) });
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
    }
    process.exitCode = failed ? 1 : 0;
  }
})();
