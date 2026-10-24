const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const sj = require("superjson");
const {
  chromium,
  expect,
} = require("../01-test/014-自动化脚本/e2e/node_modules/@playwright/test");
// Explicit finite expansion for three organization levels; this is not a general XML importer.
// Input documents and generated evidence stay local; only the generic runner is versioned.
const base = "http://124.223.198.84:1180/";
const files = process.argv.slice(2);
assert.equal(files.length, 2, "Provide the main and police XML file paths");
const parsed = spawnSync(
  "python",
  [path.join(__dirname, "read-legacy-flow-xml.py"), ...files],
  { encoding: "utf8", windowsHide: true, timeout: 10000 }
);
assert.equal(parsed.status, 0, "Legacy flow parse failed: " + parsed.stderr);
const sources = JSON.parse(parsed.stdout).sources;
assert.deepEqual(sources.map(x => x.id).sort(), ["666", "667"]);
assert(sources.every(x => /^[a-f0-9]{64}$/.test(x.sourceSha256)));
const tag = "hier3_" + randomBytes(6).toString("hex"),
  out = path.join(__dirname, "..", ".cache", tag);
fs.mkdirSync(out, { recursive: true });
const fixture = {
  tag,
  owner: null,
  project: null,
  units: [],
  staff: [],
  roles: [],
  flows: [],
  runs: [],
};
const results = [];
let browser, page, root, own, beforeInfo;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parse = x => (typeof x === "string" ? JSON.parse(x) : x);
const report = x => console.log(JSON.stringify(x));
const remember = () =>
  fs.writeFileSync(
    path.join(out, "fixture.json"),
    JSON.stringify(fixture, null, 2),
    "utf8"
  );
function serverInfo(login = false) {
  const code = `import {createRequire} from 'node:module';import{createHash}from'node:crypto';const mysql=createRequire('/app/package.json')('mysql2/promise');const c=await mysql.createConnection(process.env.DATABASE_URL);const [rows]=await c.query("SELECT s.key,s.valueJson,s.updatedByUserId,s.updatedAt FROM system_setting AS s WHERE s.key IN ('general','approval') ORDER BY s.key");await c.end();const o={settingsFingerprint:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),buildId:process.env.BUILD_ID};${login ? `const r=await fetch('${base}api/trpc/auth.login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({json:{username:process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,password:process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD}})});if(!r.ok)throw new Error('Test authentication unavailable');o.cookie=r.headers.getSetCookie()[0].split(';',1)[0];` : ""}console.log(JSON.stringify(o));`;
  const r = spawnSync(
    "ssh",
    [
      "-i",
      "C:\\Users\\pan\\.ssh\\215.pem",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "ubuntu@124.223.198.84",
      "sudo -n docker exec -i flow-ai-engine-app-1 node --input-type=module -",
    ],
    { input: code, encoding: "utf8", windowsHide: true, timeout: 45000 }
  );
  assert.equal(
    r.status,
    0,
    "Scoped test bootstrap unavailable: " + r.stderr.slice(-600)
  );
  return JSON.parse(r.stdout.trim());
}
class Session {
  constructor(cookie = "") {
    this.cookie = cookie;
  }
  async api(method, input = null, mutation = false) {
    const body = JSON.stringify(sj.serialize(input));
    const r = await fetch(
      base +
        "api/trpc/" +
        method +
        (mutation ? "" : "?input=" + encodeURIComponent(body)),
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body } : {}),
        signal: AbortSignal.timeout(30000),
      }
    );
    const cookie = r.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    const data = await r.json();
    if (!r.ok || data.error)
      throw Object.assign(
        new Error(method + ": " + (data.error?.json?.message || r.status)),
        { status: r.status }
      );
    return sj.deserialize(data.result.data);
  }
}
async function poll(label, read, accept) {
  const deadline = Date.now() + 45000;
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const v = await read();
    if (accept(v)) return v;
    await sleep(200);
  }
  throw new Error("Timeout: " + label);
}
const levels = ["省厅", "市局", "分局"],
  groups = ["command", "police"];
const groupName = { command: "指挥", police: "警种" };
const credentials = suffix => ({
  username: tag + "_" + suffix,
  password: "Test9_" + randomBytes(24).toString("base64url"),
});
const people = [],
  roles = new Map();
function source(id) {
  return sources.find(x => x.id === id);
}
function command(id, code) {
  const c = source(id).commands.find(x => x.code === code);
  assert(c, "Missing source command " + id + "/" + code);
  return c;
}
// Legacy command numbers are local to each source flow, not global decisions.
function decisionFor(flowId, commandCode) {
  return (flowId === "667" && commandCode === "05") ||
    (flowId === "666" && commandCode === "07")
    ? "rejected"
    : "approved";
}
function specs(template) {
  const S = (id, level, kind, flow, codes, status = "3") => ({
    id,
    level,
    kind,
    flow,
    codes,
    status,
  });
  if (template === "666")
    return [
      S("province_issue", 0, "command", "666", ["01"], "1"),
      S("city_receive", 1, "command", "666", ["02"], "2"),
      S("city_coordinate", 1, "command", "666", ["05"]),
      S("city_police_issue", 1, "police", "667", ["01"], "1"),
      S("city_police_receive", 1, "police", "667", ["02"], "2"),
      S("city_police_apply", 1, "police", "667", ["03"]),
      S("city_police_audit", 1, "command", "667", ["04", "05"], "4"),
      S("city_police_down", 1, "police", "667", ["06"], "5"),
      S("branch_issue", 2, "command", "666", ["01"], "1"),
      S("branch_receive", 2, "command", "666", ["02"], "2"),
      S("branch_feedback", 2, "command", "666", ["03"]),
      S("city_assess", 1, "command", "666", ["06", "07"], "4"),
      S("city_feedback", 1, "command", "666", ["03"], "5"),
      S("province_assess", 0, "command", "666", ["06", "07"], "4"),
    ];
  return [
    S("province_police_issue", 0, "police", "667", ["01"], "1"),
    S("city_police_receive", 1, "police", "667", ["02"], "2"),
    S("city_police_apply", 1, "police", "667", ["03"]),
    S("province_police_audit", 0, "command", "667", ["04", "05"], "4"),
    S("province_police_down", 0, "police", "667", ["06"], "5"),
    S("city_main_issue", 1, "command", "666", ["01"], "1"),
    S("city_main_down", 1, "command", "666", ["04"]),
    S("branch_issue", 2, "command", "666", ["01"], "1"),
    S("branch_receive", 2, "command", "666", ["02"], "2"),
    S("branch_feedback", 2, "command", "666", ["03"]),
    S("city_main_assess", 1, "command", "666", ["06", "07"], "4"),
    S("city_main_feedback", 1, "command", "666", ["03"], "5"),
    S("province_assess", 0, "command", "666", ["06", "07"], "4"),
  ];
}
function definition(template, mode) {
  const stages = specs(template);
  const nodes = [],
    edges = [];
  const node = (id, type, name, config = {}) => {
    const n = {
      id,
      type,
      name,
      config,
      position: {
        x: Math.floor(nodes.length / 5) * 340,
        y: (nodes.length % 5) * 150,
      },
    };
    nodes.push(n);
    return n;
  };
  const edge = (from, to, handle, loop) =>
    edges.push({
      id: "e" + edges.length,
      sourceNodeId: from,
      targetNodeId: to,
      ...(handle ? { sourceHandle: handle } : {}),
      ...(loop ? { loop: { maxIterations: 2 } } : {}),
    });
  node("start", "start", "三级流转开始");
  for (const [i, stage] of stages.entries()) {
    const sourceState = source(stage.flow).states.find(
      x => x.id === stage.status
    );
    assert(sourceState);
    node(
      stage.id + "_state",
      "state",
      levels[stage.level] + "·" + sourceState.name,
      {
        stateCode: "S" + template + i,
        displayName: levels[stage.level] + "·" + sourceState.name,
        stateType: "business",
        legacyFlowId: stage.flow,
        legacyStatusId: stage.status,
      }
    );
    const cs = stage.codes.map(code => command(stage.flow, code));
    node(stage.id, "operate", levels[stage.level] + "·" + cs[0].name, {
      nodeDh: "N" + template + i,
      czmc: levels[stage.level] + groupName[stage.kind] + "办理",
      instruction: "隔离三级验收；只处理当前层级和角色的任务。",
      assigneeMode: "role",
      assigneeRoleCode: roles.get(stage.level + ":" + stage.kind).code,
      bdcz: { hqhqsz: mode, hqtgbfb: 100 },
      outcomeMode: "explicit",
      outcomes: cs.map(c => ({
        code: decisionFor(stage.flow, c.code),
        label: c.name,
        sourceHandle: "cmd" + c.code,
        ...(decisionFor(stage.flow, c.code) === "rejected"
          ? { requireComment: true }
          : {}),
      })),
      formSchema: {
        fields: [
          {
            key: "reference",
            label: "验收业务编号",
            type: "text",
            readOnly: true,
            required: true,
            defaultValue: "{{input.caseId}}",
          },
          {
            key: "phase",
            label: "办理环节",
            type: "text",
            readOnly: true,
            defaultValue: stage.id,
          },
          {
            key: "level",
            label: "办理层级",
            type: "text",
            readOnly: true,
            defaultValue: levels[stage.level],
          },
          {
            key: "reportNote",
            label: "办理说明",
            type: "text",
            required: true,
            defaultValue: "",
          },
        ],
      },
      legacySource: {
        flowId: stage.flow,
        statusId: stage.status,
        commands: cs.map(c => ({
          code: c.code,
          name: c.name,
          targetStatus: c.targetStatus,
          bindCommands: c.bindCommands,
        })),
        adaptation: "finite_three_level",
      },
    });
    edge(stage.id + "_state", stage.id);
  }
  node("return53_branch", "state", "53·分局处置反馈完成", {
    stateCode: "RETURN53B",
    displayName: "分局反馈已回传市局",
    stateType: "business",
  });
  node("return88_city", "state", "88·同级警种协同完成", {
    stateCode: "RETURN88",
    displayName: "警种协同已完成，待汇总评估",
    stateType: "business",
  });
  node("return53_city", "state", "53·市局处置反馈完成", {
    stateCode: "RETURN53C",
    displayName: "市局反馈已回传省厅",
    stateType: "business",
  });
  node("completed_state", "state", "省厅确认三级处置闭环", {
    stateCode: "CASECOMPLETE",
    displayName: "省厅确认三级处置闭环",
    stateType: "terminal",
  });
  node("end", "end", "三级处置闭环完成", {
    resultTemplate: {
      caseId: "{{input.caseId}}",
      levels: "省厅-市局-分局",
      sourceTemplate: template,
      finalOutcome: "{{vars.province_assess.result.outcome}}",
    },
  });
  edge("completed_state", "end");
  edge("start", stages[0].id + "_state");
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i],
      next = stages[i + 1]?.id + "_state";
    for (const code of s.codes) {
      let target = next,
        loop = false;
      if (code === "05" && s.id.endsWith("_audit")) {
        target = "city_police_apply_state";
        loop = true;
      } else if (code === "07") {
        target =
          s.id === "province_assess"
            ? template === "666"
              ? "city_feedback_state"
              : "city_main_feedback_state"
            : "branch_feedback_state";
        loop = true;
      } else if (s.id === "branch_feedback") target = "return53_branch";
      else if (["city_feedback", "city_main_feedback"].includes(s.id))
        target = "return53_city";
      else if (i === stages.length - 1) target = "completed_state";
      edge(s.id, target, "cmd" + code, loop);
    }
  }
  edge(
    "return53_branch",
    template === "666" ? "return88_city" : "city_main_assess_state"
  );
  edge(
    "return88_city",
    template === "666" ? "city_assess_state" : "city_main_assess_state"
  );
  edge("return53_city", "province_assess_state");
  if (template !== "666") {
    const idx = nodes.findIndex(x => x.id === "return88_city");
    nodes.splice(idx, 1);
    const es = edges.findIndex(x => x.sourceNodeId === "return88_city");
    edges.splice(es, 1);
  }
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {
      sourceDocuments: sources.map(x => ({ id: x.id, sha256: x.sourceSha256 })),
      hierarchyLevels: levels,
      legacyAdaptation: "finite_three_level",
      signingOutcomeMapping:
        "667/05,666/07=rejected; all other commands=approved",
      legacyReturn53: "下级处置反馈完成",
      legacyReturn88: "同级警种协同完成",
    },
    nodes,
    edges,
  };
}
async function browserComplete(actor, task, stage, code, caseId) {
  if (!browser) {
    const runtime = path.join(process.env.LOCALAPPDATA, "ms-playwright");
    const exe = fs
      .readdirSync(runtime)
      .filter(x => /^chromium-\d+$/.test(x))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
      .map(x => path.join(runtime, x, "chrome-win64/chrome.exe"))
      .find(fs.existsSync);
    assert(exe);
    browser = await chromium.launch({ headless: true, executablePath: exe });
  }
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await ctx.route("**/*", route =>
    route.request().url().startsWith(base) ? route.continue() : route.abort()
  );
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(actor.login.username);
  await page.getByLabel("密码", { exact: true }).fill(actor.login.password);
  await page.getByRole("button", { name: "登录流程引擎", exact: true }).click();
  await page.locator('input[type="password"]').waitFor({ state: "hidden" });
  await page.goto(base + "#/runs/workbench");
  await page
    .locator("[data-workbench-view-navigation]")
    .getByRole("button", { name: "待办", exact: true })
    .click();
  await page.locator('[data-task-open-id="' + task.id + '"]:visible').click();
  const drawer = page.locator("[data-task-drawer]");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("验收业务编号", { exact: true })).toHaveValue(
    caseId
  );
  await drawer
    .getByLabel("办理说明", { exact: true })
    .fill("浏览器真实办理：" + levels[stage.level]);
  await page.screenshot({
    path: path.join(out, "browser-" + stage.level + ".png"),
  });
  const responsePromise = page
    .waitForResponse(
      response =>
        response.request().method() === "POST" &&
        /api\/trpc\/[^?]*task\.(execute|complete)/.test(response.url()),
      { timeout: 5000 }
    )
    .catch(() => null);
  await drawer
    .getByRole("button", {
      name: "提交" + command(stage.flow, code).name,
      exact: true,
    })
    .click();
  const submittedResponse = await responsePromise;
  const notices = await page.locator("[data-sonner-toast]").allTextContents();
  const reply = submittedResponse ? await submittedResponse.json() : null;
  const entries = Array.isArray(reply) ? reply : reply ? [reply] : [];
  const submittedError = entries.find(item => item.error)?.error;
  const evidence = {
    httpStatus: submittedResponse?.status(),
    error: submittedError?.json?.message || submittedError?.message,
    notices,
  };
  fs.writeFileSync(
    path.join(out, "browser-submit-" + stage.level + ".json"),
    JSON.stringify(evidence, null, 2),
    "utf8"
  );
  assert(
    submittedResponse,
    "No task submission request: " + notices.join("; ")
  );
  assert(
    submittedResponse.ok() && !submittedError,
    "Task submission failed: " + JSON.stringify(evidence)
  );
  await poll(
    "browser task complete",
    () => actor.session.api("task.get", { taskId: task.id }),
    x => x.status === "completed"
  );
  assert.deepEqual(errors, []);
  await ctx.close();
  report({
    stage: "hierarchy-browser",
    level: levels[stage.level],
    normalUser: true,
    taskId: task.id,
    pageErrors: 0,
  });
}
const taskGroupKey = task => task.approvalGroupId || task.id;
async function tasks(runId) {
  return (
    await own.api("task.list", {
      projectId: fixture.project.id,
      view: "initiated",
      limit: 200,
    })
  ).filter(x => x.runId === runId);
}
async function runScenario(flow, scenario, useBrowser = false) {
  const caseId = tag + "_" + flow.template + "_" + flow.mode + "_" + scenario;
  const started = await own.api(
    "workflow.run",
    {
      workflowId: flow.id,
      triggerType: "test",
      input: { caseId },
      idempotencyKey: caseId,
    },
    true
  );
  fixture.runs.push({ id: started.runId, workflowId: flow.id });
  remember();
  const stages = specs(flow.template),
    byId = new Map(stages.map(x => [x.id, x])),
    groupsSeen = new Set(),
    visits = new Map(),
    acted = new Map();
  const browserLevels = new Set(),
    actorsByLevel = new Map();
  let badAudit = false,
    badAssess = false,
    browserUsed = false,
    wrongRejected = 0;
  for (let iteration = 0; iteration < 60; iteration++) {
    const state = await poll(
      "next stage",
      async () => {
        const run = await own.api("workflow.runDetail", {
          runId: started.runId,
        });
        assert(
          !["failed", "cancelled", "terminated"].includes(run.status),
          JSON.stringify(run.errorJson)
        );
        const active = (await tasks(started.runId)).filter(x =>
          ["pending", "claimed"].includes(x.status)
        );
        return { run, active };
      },
      x =>
        x.run.status === "success" ||
        (x.active.length > 0 && !groupsSeen.has(x.active[0].approvalGroupId))
    );
    if (state.run.status === "success") break;
    const active = state.active,
      stage = byId.get(active[0].nodeId);
    assert(stage);
    assert(
      active.every(
        x =>
          x.nodeId === stage.id &&
          x.approvalGroupId === active[0].approvalGroupId
      )
    );
    const candidates = people.filter(
      x => x.level === stage.level && x.kind === stage.kind
    );
    assert.equal(candidates.length, 2);
    const pooled = flow.mode === "single";
    if (pooled) {
      assert.equal(active.length, 1);
      assert.equal(Number(active[0].assignedUserId), 0);
      assert.deepEqual(
        parse(active[0].candidateUserIdsJson)
          .map(Number)
          .sort((a, b) => a - b),
        candidates.map(x => x.id).sort((a, b) => a - b)
      );
      for (const candidate of candidates)
        assert.equal(
          (await candidate.session.api("task.get", { taskId: active[0].id }))
            .canAct,
          true
        );
    } else {
      assert.deepEqual(
        active.map(x => Number(x.assignedUserId)).sort((a, b) => a - b),
        candidates.map(x => x.id).sort((a, b) => a - b)
      );
      assert.equal(active.length, 2);
    }
    const group = taskGroupKey(active[0]);
    groupsSeen.add(group);
    visits.set(stage.id, (visits.get(stage.id) || 0) + 1);
    const wrong = people.find(
      x => x.level !== stage.level && x.kind !== stage.kind
    );
    await assert.rejects(
      wrong.session.api(
        "task.execute",
        {
          taskId: active[0].id,
          result: {
            decision: "approved",
            outcome: decisionFor(stage.flow, stage.codes[0]),
            reference: caseId,
            phase: stage.id,
            level: levels[stage.level],
            reportNote: "不能越权",
          },
        },
        true
      ),
      e => e.status === 403
    );
    wrongRejected++;
    if (iteration === 0) {
      await assert.rejects(
        wrong.session.api("task.claim", { taskId: active[0].id }, true),
        e => e.status === 403
      );
      await assert.rejects(
        wrong.session.api(
          "task.complete",
          {
            taskId: active[0].id,
            result: {
              decision: "approved",
              outcome: decisionFor(stage.flow, stage.codes[0]),
              reference: caseId,
              phase: stage.id,
              level: levels[stage.level],
              reportNote: "无权办理验证",
            },
          },
          true
        ),
        e => e.status === 403
      );
    }
    let code = stage.codes[0];
    if (scenario === "rework" && !badAudit && stage.id.endsWith("_audit")) {
      code = "05";
      badAudit = true;
    } else if (
      scenario === "rework" &&
      !badAssess &&
      stage.id.includes("assess") &&
      stage.level === 1
    ) {
      code = "07";
      badAssess = true;
    }
    const reject = decisionFor(stage.flow, code) === "rejected";
    const role = stage.level + ":" + stage.kind,
      index = acted.get(role) || 0;
    acted.set(role, index + 1);
    const selected =
      (flow.mode === "andSignFor" && !reject) ||
      (flow.mode === "orSignFor" && reject)
        ? candidates
        : [candidates[index % 2]];
    for (let a = 0; a < selected.length; a++) {
      const actor = selected[a],
        task = pooled
          ? active[0]
          : active.find(x => Number(x.assignedUserId) === actor.id);
      assert(task);
      if (useBrowser && !browserLevels.has(stage.level)) {
        await browserComplete(actor, task, stage, code, caseId);
        browserUsed = true;
        browserLevels.add(stage.level);
      } else {
        await actor.session.api("task.claim", { taskId: task.id }, true);
        if (pooled) {
          const peer = candidates.find(x => x.id !== actor.id);
          await assert.rejects(
            peer.session.api("task.claim", { taskId: task.id }, true),
            e => e.status === 403 || e.status === 409
          );
          assert.equal(
            (await peer.session.api("task.get", { taskId: task.id })).canAct,
            false
          );
        }
        await actor.session.api(
          "task.complete",
          {
            taskId: task.id,
            result: {
              decision: reject ? "rejected" : "approved",
              outcome: decisionFor(stage.flow, code),
              reference: caseId,
              phase: stage.id,
              level: levels[stage.level],
              reportNote: levels[stage.level] + "已核对",
              comment: reject ? "退回补正，重新核对" : "三级正常流转",
            },
          },
          true
        );
      }
      if (selected.length === 2 && a === 0) {
        const all = await tasks(started.runId);
        assert.equal(
          all.filter(x => taskGroupKey(x) === group && x.status === "completed")
            .length,
          1
        );
        assert.equal(
          all.filter(
            x =>
              taskGroupKey(x) === group &&
              ["pending", "claimed"].includes(x.status)
          ).length,
          1
        );
        assert(
          !all.some(
            x =>
              ["pending", "claimed"].includes(x.status) &&
              taskGroupKey(x) !== group
          )
        );
      }
    }
    report({
      stage: "hierarchy-stage",
      template: flow.template,
      mode: flow.mode,
      scenario,
      node: stage.id,
      level: levels[stage.level],
    });
    const finalGroup = await poll(
      "group decided",
      () => tasks(started.runId),
      x =>
        !x.some(
          t =>
            taskGroupKey(t) === group &&
            ["pending", "claimed"].includes(t.status)
        )
    );
    const decided = finalGroup.filter(x => taskGroupKey(x) === group);
    const actors = actorsByLevel.get(stage.level) || new Set();
    for (const row of decided.filter(x => x.status === "completed")) {
      assert(
        candidates.some(
          candidate => candidate.id === Number(row.completedByUserId)
        )
      );
      assert.equal(
        Number(row.completedByUserId),
        Number(pooled ? row.claimedByUserId : row.assignedUserId)
      );
      actors.add(Number(row.completedByUserId));
    }
    actorsByLevel.set(stage.level, actors);
    assert.equal(
      decided.filter(x => x.status === "completed").length,
      selected.length
    );
    assert.equal(
      decided.filter(x => x.status === "cancelled").length,
      (pooled ? 1 : 2) - selected.length
    );
    const actor = selected[0],
      task = pooled
        ? active[0]
        : active.find(x => Number(x.assignedUserId) === actor.id);
    await assert.rejects(
      actor.session.api(
        "task.complete",
        {
          taskId: task.id,
          result: {
            decision: "approved",
            outcome: decisionFor(stage.flow, code),
            reference: caseId,
            phase: stage.id,
            level: levels[stage.level],
            reportNote: "重复提交",
          },
        },
        true
      )
    );
    assert.equal(
      (await tasks(started.runId)).filter(
        x => taskGroupKey(x) === group && x.status === "completed"
      ).length,
      selected.length
    );
  }
  const run = await own.api("workflow.runDetail", { runId: started.runId });
  assert.equal(run.status, "success");
  assert.equal(
    run.nodeRuns.filter(x => x.nodeId === "end" && x.status === "success")
      .length,
    1
  );
  assert(stages.every(x => visits.has(x.id)));
  for (let level = 0; level < 3; level++)
    assert((actorsByLevel.get(level)?.size || 0) >= 2);
  if (useBrowser) assert.equal(browserLevels.size, 3);
  assert(
    run.nodeRuns.some(
      x => x.nodeId === "return53_branch" && x.status === "success"
    )
  );
  assert(
    run.nodeRuns.some(
      x => x.nodeId === "return53_city" && x.status === "success"
    )
  );
  if (flow.template === "666")
    assert(
      run.nodeRuns.some(
        x => x.nodeId === "return88_city" && x.status === "success"
      )
    );
  if (scenario === "rework") {
    assert(badAudit && badAssess);
    assert((visits.get("city_police_apply") || 0) >= 2);
    assert((visits.get("branch_feedback") || 0) >= 2);
    const returns = (await tasks(started.runId)).filter(
      x => x.nodeId === "branch_feedback"
    );
    assert(new Set(returns.map(x => x.executionKey)).size >= 2);
  }
  const snapshots = parse(run.definitionSnapshotJson),
    d = snapshots?.definition || snapshots;
  assert(
    d?.settings?.sourceDocuments?.every(x =>
      sources.some(s => s.sourceSha256 === x.sha256)
    )
  );
  const result = {
    template: flow.template,
    mode: flow.mode,
    scenario,
    workflowId: flow.id,
    runId: run.id,
    status: run.status,
    stagesVisited: visits.size,
    taskGroups: groupsSeen.size,
    levelCount: 3,
    usersPerRole: 2,
    wrongLevelRejected: wrongRejected,
    reworkVerified: scenario === "rework",
    endExecutions: 1,
    browserUsed,
    browserLevels: [...browserLevels].map(level => levels[level]),
    actorsByLevel: Object.fromEntries(
      [...actorsByLevel].map(([level, ids]) => [levels[level], [...ids]])
    ),
  };
  results.push(result);
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(results, null, 2),
    "utf8"
  );
  report({ stage: "hierarchy-run", ...result });
}
(async () => {
  let failed = false;
  const cleanupErrors = [];
  try {
    beforeInfo = serverInfo(true);
    root = new Session(beforeInfo.cookie);
    const ownerLogin = credentials("owner");
    const created = await root.api(
      "iam.createUser",
      { ...ownerLogin, name: "三级流程验收管理员_" + tag, role: "admin" },
      true
    );
    fixture.owner = { id: created.userId, username: ownerLogin.username };
    remember();
    own = new Session();
    await own.api("auth.login", ownerLogin, true);
    const project = await own.api(
      "project.create",
      { code: tag.toUpperCase(), name: "三级流转隔离验收_" + tag },
      true
    );
    fixture.project = { id: project.id, code: tag.toUpperCase() };
    remember();
    for (let level = 0; level < 3; level++) {
      const u = await own.api(
        "config.createOrganizationUnit",
        {
          code: tag.toUpperCase() + "_L" + level,
          name: levels[level] + "_隔离验收_" + tag,
          parentUnitId: fixture.units[level - 1]?.id || null,
          unitLevel: level + 1,
        },
        true
      );
      fixture.units.push({
        id: u.id,
        name: levels[level] + "_隔离验收_" + tag,
      });
      remember();
      for (const kind of groups) {
        const role = {
          code: "custom_" + tag + "_l" + level + "_" + kind,
          level,
          kind,
        };
        await own.api(
          "iam.createCustomRole",
          {
            code: role.code,
            name: levels[level] + groupName[kind] + "验收_" + tag,
            scope: "workflow",
            permissions: ["workflow:view"],
          },
          true
        );
        fixture.roles.push(role);
        roles.set(level + ":" + kind, role);
        remember();
        for (let i = 0; i < 2; i++) {
          const login = credentials("L" + level + "_" + kind + "_" + i),
            made = await own.api(
              "iam.createUser",
              {
                ...login,
                name:
                  levels[level] +
                  groupName[kind] +
                  "人员" +
                  (i + 1) +
                  "_" +
                  tag,
                role: "user",
              },
              true
            );
          const person = {
            id: made.userId,
            username: login.username,
            level,
            kind,
          };
          fixture.staff.push(person);
          remember();
          await own.api(
            "config.assignOrganizationMember",
            {
              unitId: u.id,
              userId: person.id,
              isPrimary: true,
              onlyIfAbsent: true,
            },
            true
          );
          const session = new Session();
          await session.api("auth.login", login, true);
          const account = await session.api("auth.me");
          assert.equal(account.role, "user");
          assert.equal(account.canManageIdentity, false);
          people.push({ ...person, login, session });
        }
      }
    }
    report({
      stage: "hierarchy-setup",
      tag,
      levels,
      ordinaryUsers: people.length,
      organizations: 3,
      roles: 6,
      sourceHashes: sources.map(x => ({ id: x.id, sha256: x.sourceSha256 })),
    });
    for (const template of ["666", "667"])
      for (const mode of ["single", "andSignFor", "orSignFor"]) {
        const def = definition(template, mode);
        const made = await own.api(
          "project.createWorkflow",
          {
            projectId: project.id,
            name: source(template).name + "_三级_" + mode + "_" + tag,
            flowType: "state",
            definition: def,
          },
          true
        );
        const flow = { id: made.id, template, mode };
        fixture.flows.push(flow);
        remember();
        const current = await own.api("workflow.get", { id: flow.id });
        await root.api(
          "project.auditWorkflow",
          {
            projectId: project.id,
            workflowId: flow.id,
            auditStatus: "approved",
            expectedDefinitionVersion: current.definitionVersion,
            expectedAuditStatus: current.auditStatus,
          },
          true
        );
        const approved = await own.api("workflow.get", { id: flow.id });
        await own.api(
          "workflow.publish",
          {
            id: flow.id,
            expectedDefinitionVersion: approved.definitionVersion,
          },
          true
        );
        for (const role of fixture.roles) {
          const config = await own.api("iam.customRoleConfiguration", {
            code: role.code,
          });
          for (const person of people.filter(
            x => x.level === role.level && x.kind === role.kind
          ))
            await own.api(
              "workflow.assignCustomRole",
              {
                workflowId: flow.id,
                userId: person.id,
                roleCode: role.code,
                expectedConfigToken: config.configToken,
              },
              true
            );
        }
        const outcomes = await Promise.allSettled([
          runScenario(flow, "normal", template === "666" && mode === "single"),
          runScenario(flow, "rework"),
        ]);
        const failures = outcomes.filter(x => x.status === "rejected");
        if (failures.length)
          throw new AggregateError(
            failures.map(x => x.reason),
            "Three-level scenario failed"
          );
      }
    assert.equal(results.length, 12);
    assert.equal(fixture.flows.length, 6);
  } catch (error) {
    failed = true;
    if (error instanceof AggregateError)
      for (const item of error.errors)
        console.error(item.stack || String(item));
    console.error(error.stack || String(error));
    if (page)
      await page
        .screenshot({ path: path.join(out, "failure.png") })
        .catch(() => {});
  } finally {
    if (own && fixture.project) {
      for (const run of fixture.runs) {
        try {
          const current = await own.api("workflow.runDetail", {
            runId: run.id,
          });
          assert.equal(current.workflowId, run.workflowId);
          if (
            ["queued", "running", "waiting", "blocked"].includes(current.status)
          )
            await own.api("workflow.cancelRun", { runId: run.id }, true);
        } catch (e) {
          cleanupErrors.push(e.message);
        }
      }
      for (const flow of fixture.flows) {
        try {
          const current = await own.api("workflow.get", { id: flow.id });
          assert.equal(Number(current.ownerUserId), fixture.owner.id);
          assert.equal(current.projectId, fixture.project.id);
          assert(current.name.endsWith(tag));
          for (const role of fixture.roles) {
            const rows = await own.api("workflow.customRoleAssignments", {
              workflowId: flow.id,
              page: 0,
              query: role.code,
            });
            for (const r of rows.items.filter(
              x => x.roleCode === role.code && !x.revokedAt
            )) {
              assert(fixture.staff.some(x => x.id === Number(r.userId)));
              await own.api(
                "workflow.revokeCustomRole",
                { workflowId: flow.id, assignmentId: r.id },
                true
              );
            }
          }
          if (!current.archivedAt)
            await own.api("workflow.delete", { id: flow.id }, true);
        } catch (e) {
          cleanupErrors.push(e.message);
        }
      }
      for (const role of fixture.roles) {
        try {
          assert(role.code.startsWith("custom_" + tag + "_"));
          const current = await own.api("iam.customRoleConfiguration", {
            code: role.code,
          });
          await own.api(
            "iam.deleteCustomRole",
            { code: role.code, expectedConfigToken: current.configToken },
            true
          );
        } catch (e) {
          cleanupErrors.push(e.message);
        }
      }
      for (const person of fixture.staff) {
        try {
          assert(person.username.startsWith(tag + "_"));
          const member = await own.api(
            "config.organizationMemberConfiguration",
            { userId: person.id }
          );
          for (const m of member.memberships) {
            assert(fixture.units.some(x => x.id === m.unitId));
            const current = await own.api(
              "config.organizationMemberConfiguration",
              { userId: person.id }
            );
            await own.api(
              "config.removeOrganizationMember",
              {
                unitId: m.unitId,
                userId: person.id,
                expectedMembershipToken: current.membershipToken,
              },
              true
            );
          }
          await root.api(
            "iam.updateUserStatus",
            { userId: person.id, status: "disabled" },
            true
          );
        } catch (e) {
          cleanupErrors.push(e.message);
        }
      }
      for (const unit of [...fixture.units].reverse()) {
        try {
          const directory = await own.api("config.organizationDirectory");
          const current = directory.units.find(x => x.id === unit.id);
          assert.equal(current.name, unit.name);
          await own.api(
            "config.deleteOrganizationUnit",
            { id: unit.id, expectedConfigToken: current.configToken },
            true
          );
        } catch (e) {
          cleanupErrors.push(e.message);
        }
      }
      try {
        const current = await own.api("project.get", {
          projectId: fixture.project.id,
        });
        assert.equal(Number(current.ownerUserId), fixture.owner.id);
        const list = await own.api("project.workflows", {
          projectId: fixture.project.id,
        });
        assert.equal(list.length, 0);
        await own.api(
          "project.changeStatus",
          {
            projectId: fixture.project.id,
            status: "archived",
            expectedVersion: current.lifecycleVersion,
            expectedWorkflowCount: 0,
          },
          true
        );
      } catch (e) {
        cleanupErrors.push(e.message);
      }
    }
    if (root && fixture.owner) {
      try {
        await root.api(
          "iam.updateUserStatus",
          { userId: fixture.owner.id, status: "disabled" },
          true
        );
      } catch (e) {
        cleanupErrors.push(e.message);
      }
    }
    if (beforeInfo) {
      try {
        const after = serverInfo(false);
        assert.equal(after.settingsFingerprint, beforeInfo.settingsFingerprint);
        assert.equal(after.buildId, beforeInfo.buildId);
      } catch (e) {
        cleanupErrors.push(e.message);
      }
    }
    if (browser) await browser.close();
    report({
      stage: "hierarchy-cleanup",
      tag,
      flowsArchived: fixture.flows.length,
      runs: fixture.runs.length,
      accountsDisabled: fixture.staff.length + (fixture.owner ? 1 : 0),
      rolesRemoved: fixture.roles.length,
      organizationsRemoved: fixture.units.length,
      errors: cleanupErrors,
    });
    if (cleanupErrors.length) failed = true;
  }
  if (failed) process.exitCode = 1;
})();
