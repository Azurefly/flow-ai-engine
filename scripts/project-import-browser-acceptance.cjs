const assert = require("node:assert/strict");
const {
  chromium,
  expect,
} = require("../01-test/014-自动化脚本/e2e/node_modules/@playwright/test");
const {
  base: origin,
  username,
  password,
} = require("./acceptance-target.cjs").acceptanceLogin(process.env);
const tag = "QA" + Date.now().toString(36).toUpperCase();
const results = [],
  errors = [];
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    const btn = name => page.getByRole("button", { name, exact: true });
    async function query(name, input) {
      const r = await page.request.get(
        origin +
          "/api/trpc/" +
          name +
          "?input=" +
          encodeURIComponent(JSON.stringify({ json: input ?? null }))
      );
      const j = await r.json();
      if (j.error) throw Error(name + ": " + j.error.json.message);
      return j.result.data.json;
    }
    async function upload(csv) {
      await page
        .getByLabel("业务导入文件")
        .setInputFiles({
          name: "业务.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(csv, "utf8"),
        });
    }
    await page.goto(origin);
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator("input[type=password]").fill(password);
    await btn("登录流程引擎").click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible();
    for (const reducedMotion of ["reduce", "no-preference"]) {
      await page.emulateMedia({ reducedMotion });
      await btn("新增业务").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(btn("新增业务")).toBeFocused();
      results.push({ check: "dialog focus", reducedMotion });
    }
    const panel = page.getByRole("region", { name: "业务导入批次" });
    const header = "\uFEFF业务代号,业务名称,业务说明\r\n";
    const good = tag + ",多行业务" + tag + ',"甲, ""乙""\r\n第二行"';
    await upload(
      header + good + "\r\n" + tag + "B," + "中".repeat(161) + ",说明"
    );
    await expect(panel).toContainText("第 4 行");
    await expect(panel).toContainText("160");
    assert(!(await query("project.list")).some(x => x.code === tag));
    results.push({ check: "invalid batch", written: 0 });
    const choose = page.waitForEvent("filechooser");
    await btn("上传本批纠正版").click();
    await (
      await choose
    ).setFiles({
      name: "修订.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(header + good + "\r\n" + tag + "B,乙,说明", "utf8"),
    });
    await btn("确认导入").click();
    await expect(panel).toContainText("已创建 2");
    const batch = await query("project.importStatus", {});
    assert.equal(batch.rows.length, 2);
    assert(batch.rows.every(x => x.projectId));
    const project = await query("project.get", {
      projectId: batch.rows[0].projectId,
    });
    assert.equal(project.description, '甲, "乙"\r\n第二行');
    await page.reload();
    await expect(panel).toContainText("已创建 2");
    results.push({
      check: "corrected batch and reload",
      count: 2,
      batchId: batch.batchId,
    });
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const row = page
        .locator("table[data-business-projects] tbody tr")
        .filter({ hasText: tag })
        .first();
      const action = row.getByRole("button").first();
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      assert(
        box.x >= 0 && box.x + box.width <= width + 1,
        "hidden action at " + width + " " + JSON.stringify(box)
      );
      results.push({
        check: "business action",
        width,
        x: Math.round(box.x),
        right: Math.round(box.x + box.width),
      });
    }
    await upload(header + tag + 'Z,未闭合,"内容');
    await expect(panel).toContainText("缺少闭引号");
    await expect(panel).toContainText("第 2 行");
    assert(!(await query("project.list")).some(x => x.code === tag + "Z"));
    results.push({ check: "invalid quotes", written: 0 });
    assert.equal(errors.length, 0);
  } finally {
    await browser.close();
    console.log(JSON.stringify({ origin, results, errors }));
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
