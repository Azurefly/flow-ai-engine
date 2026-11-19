const assert = require("node:assert/strict");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const {
  chromium,
  expect,
} = require("../01-test/014-自动化脚本/e2e/node_modules/@playwright/test");
const { base, username, password } =
  require("./acceptance-target.cjs").acceptanceLogin(process.env);

async function verify() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });
  page.setDefaultTimeout(30_000);
  let errors = 0,
    project,
    workflowCount = 0,
    archived = false;
  const code = "G01_EDGE_" + randomBytes(6).toString("hex").toUpperCase();
  page.on("pageerror", () => {
    errors++;
  });
  async function rpc(name, input, write = false) {
    const data = { json: input ?? null },
      url = base + "/api/trpc/" + name;
    const response = write
      ? await page.request.post(url, { data, maxRedirects: 0 })
      : await page.request.get(
          url + "?input=" + encodeURIComponent(JSON.stringify(data)),
          { maxRedirects: 0 }
        );
    const payload = await response.json();
    if (!response.ok() || payload.error)
      throw Error(name + " HTTP " + response.status());
    return payload.result.data.json;
  }
  try {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "登录流程引擎" }).click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible({ timeout: 30_000 });
    project = await rpc(
      "project.create",
      { code, name: "G01 浏览器测试 " + code },
      true
    );
    console.log(JSON.stringify({ projectId: project.id, code }));
    const source = await rpc(
      "data.createSource",
      {
        projectId: project.id,
        name: "CSV",
        sourceType: "file",
        connection: {},
      },
      true
    );
    const asset = await rpc(
      "data.createAsset",
      {
        projectId: project.id,
        sourceId: source.id,
        name: "每日对象",
        assetType: "file",
        schema: [{ name: "id", type: "string" }],
      },
      true
    );
    await page.goto(base + "/#/flows/project/" + project.id);
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    await page.getByRole("button", { name: /资源探查/ }).click();
    const panel = page.getByRole("region", { name: "数据连接器版本" });
    await panel.getByRole("button", { name: "登记资源版本" }).click();
    await panel
      .getByLabel("版本操作", { exact: true })
      .selectOption("file_read");
    await panel
      .getByLabel("版本所属资源", { exact: true })
      .selectOption(asset.id);
    await panel.getByLabel("版本名称").fill("同名对象第一版");
    const bytes = Buffer.from('\ufeffid,name\r\n1,"新加坡,\r\n第二行"\r\n');
    await panel
      .getByLabel("UTF-8 CSV 文件")
      .setInputFiles({
        name: "daily.csv",
        mimeType: "text/csv",
        buffer: bytes,
      });
    await panel.getByRole("button", { name: "保存版本" }).click();
    await expect(panel.getByRole("status")).toContainText("已保存版本");
    const versions = await rpc("connector.versions", { projectId: project.id });
    assert.equal(versions.items.length, 1);
    const version = versions.items[0];
    assert.equal(
      version.contentHash,
      createHash("sha256").update(bytes).digest("hex")
    );
    const specs = [
      ["start", "start", {}],
      [
        "read",
        "source",
        { assetId: asset.id, connectorVersionId: version.id, limit: 10 },
      ],
      ["end", "end", {}],
    ];
    const flow = await rpc(
      "project.createWorkflow",
      {
        projectId: project.id,
        name: "固定文件",
        flowType: "data",
        definition: {
          schemaVersion: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          nodes: specs.map(([id, type, config], i) => ({
            id,
            type,
            name: id,
            config,
            position: { x: 200 * i, y: 0 },
          })),
          edges: specs
            .slice(1)
            .map(([id], i) => ({
              id: "e" + i,
              sourceNodeId: specs[i][0],
              targetNodeId: id,
            })),
        },
      },
      true
    );
    workflowCount++;
    const run = await rpc(
      "data.run",
      {
        projectId: project.id,
        workflowId: flow.id,
        mode: "test",
        idempotencyKey: randomUUID(),
      },
      true
    );
    let detail;
    const deadline = Date.now() + 90_000;
    do {
      detail = await rpc("data.runDetail", {
        projectId: project.id,
        runId: run.runId,
      });
      if (["success", "failed", "cancelled"].includes(detail.status)) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    } while (Date.now() < deadline);
    assert.equal(detail.status, "success");
    assert.deepEqual(
      detail.nodeRuns.find(n => n.nodeId === "read").output.rows,
      [{ id: "1", name: "新加坡,\r\n第二行" }]
    );
    await page.goto(base + "/#/runs/monitor/" + flow.id + "/" + run.runId);
    await page.getByRole("tab", { name: "最终结果" }).click();
    await expect(
      page.getByRole("tabpanel", { name: "最终结果" }).getByRole("button", { name: /新加坡,.*第二行/ }).first()
    ).toBeVisible({timeout: 15000});
    assert.equal(errors, 0);
    console.log(
      JSON.stringify({
        runId: run.runId,
        versionId: version.id,
        sha256: version.contentHash,
        visibleOutput: true,
        pageErrors: errors,
      })
    );
  } finally {
    try {
      if (project) {
        const state = await rpc("project.lifecyclePreview", {
          projectId: project.id,
        });
        if (state.code !== code || state.workflowCount !== workflowCount)
          throw Error("测试业务归属或流程数量已变化，保留现场。");
        await rpc(
          "project.changeStatus",
          {
            projectId: project.id,
            status: "archived",
            expectedWorkflowCount: workflowCount,
            expectedVersion: state.lifecycleVersion,
          },
          true
        );
        archived = true;
      }
    } finally {
      await rpc("auth.logout", null, true).catch(() => {});
      await browser.close();
      console.log(JSON.stringify({ code, archived }));
    }
  }
}
verify().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
