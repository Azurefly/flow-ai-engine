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

const has = (access, permission) =>
  Array.isArray(access.permissions)
    ? access.permissions.includes(permission)
    : Boolean(access.permissions?.has?.(permission));
async function grant(role = "designer") {
  await owner(
    "project.grantMember",
    { projectId: fixture.projectId, userId: fixture.disabledUserId, role },
    true
  );
}
async function revoke() {
  const members = await owner("project.members", {
    projectId: fixture.projectId,
  });
  for (const item of members.filter(
    item => Number(item.userId) === fixture.disabledUserId && !item.revokedAt
  )) {
    assert.notEqual(Number(item.userId), fixture.userId);
    await owner(
      "project.revokeMember",
      {
        projectId: fixture.projectId,
        userId: fixture.disabledUserId,
        assignmentId: item.id,
      },
      true
    );
  }
}
async function refresh(page, success = true) {
  const response = page.waitForResponse(
    row =>
      row.url().includes("workflow.access") && row.request().method() === "GET"
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
  const actual = await response;
  assert([200, 207, 503].includes(actual.status()));
  const names = decodeURIComponent(
    new URL(actual.url()).pathname.split("/api/trpc/")[1]
  ).split(",");
  const payload = await actual.json();
  const entry = Array.isArray(payload)
    ? payload[names.indexOf("workflow.access")]
    : payload;
  assert(
    success ? entry?.result : entry?.error,
    "Check the access result independently of other batched reads"
  );
}

const sqlHelper = fs.readFileSync(
  path.join(__dirname, "workflow-lifecycle-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const workflowWriteIntent=" +
    JSON.stringify({ action, fixture, ...extra }) +
    ";\n" +
    sqlHelper;
  const encoded = Buffer.from(code).toString("base64");
  const command =
    "sudo -n docker exec -i flow-ai-engine-app-1 node --input-type=module -e \"await import('data:text/javascript;base64," +
    encoded +
    "').catch(error=>{console.error(error.code+': '+error.message);process.exitCode=1})\"";
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
      command,
    ],
    { windowsHide: true }
  );
  let stdout = "",
    stderr = "",
    readyResolve,
    readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});
  const done = new Promise((resolve, reject) => {
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        try {
          const value = JSON.parse(line);
          if (value.barrierReady) readyResolve(value);
        } catch {}
      }
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", error => {
      readyReject(error);
      reject(error);
    });
    child.on("close", status => {
      if (status !== 0) {
        const error = new Error(
          "Fixture SQL " + action + " failed: " + stderr.slice(-1500)
        );
        readyReject(error);
        reject(error);
      } else {
        const result = JSON.parse(stdout.trim().split("\n").at(-1));
        readyResolve(result);
        resolve(result);
      }
    });
  });
  done.catch(() => {});
  if (!["hold_project","hold_actor"].includes(action)) child.stdin.end();
  return {
    ready,
    done,
    release: async () => {
      if (!child.stdin.destroyed) child.stdin.end("release\n");
      return done;
    },
  };
}
function rootFixtureStatement(statement) {
  assert(/^(CREATE|DROP) TRIGGER flow_life_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("flow_life_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes("NEW.actorUserId IN") &&
        statement.includes(String(fixture.userId)) &&
        statement.includes(String(fixture.disabledUserId)) &&
        statement.includes("isolated_workflow_lifecycle_audit_rejected")
    );
  return new Promise((resolve, reject) => {
    // The existing container supplies its own admin credential; never read or print it.
    const command = `sudo -n docker exec -i flow-ai-engine-mysql-1 sh -c 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --skip-column-names "$MYSQL_DATABASE"'`;
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
        command,
      ],
      { windowsHide: true }
    );
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", code =>
      code === 0
        ? resolve()
        : reject(new Error("Scoped fixture trigger failed: " + stderr))
    );
    child.stdin.end("DELIMITER $$\n" + statement + "$$\nDELIMITER ;\n");
  });
}
const sql = async (action, extra) => {
  const result = await sqlProcess(action, extra).done;
  if (!result.statement) return result;
  await rootFixtureStatement(result.statement);
  const state = await sqlProcess("audit_state").done;
  assert.equal(state.present, action === "fail_audit");
  return action === "fail_audit"
    ? { fixtureAuditFailureEnabled: true }
    : { fixtureAuditFailureRemoved: true };
};
const snapshot = flow => sql("snapshot", { workflowId: flow.id });
const remember = () => fs.writeFileSync(path.join(directory,"fixture.json"),JSON.stringify(fixture),"utf8");
const baseline = process.env.FLOW_UI_LIFECYCLE_BASELINE === "1";
async function auditCases() {
  const flow = fixture.workflows.find(row => row.flowType === "control");
  await owner("workflow.update", {id:flow.id,name:flow.name,definition:(await owner("workflow.get",{id:flow.id})).definition,expectedDefinitionVersion:(await snapshot(flow)).definitionVersion},true);
  let before=await snapshot(flow);
  await sql("fail_audit");
  try {
    await assert.rejects(owner("workflow.delete",{id:flow.id},true));
    const after=await snapshot(flow);
    if(baseline) assert(after.archivedAt && !before.archivedAt); else assert.deepEqual(after,before);
    report({archiveAuditAtomic:!baseline,oldArchiveSurvivedError:baseline});
  } finally {await sql("restore_audit");}
  if((await snapshot(flow)).archivedAt) await owner("workflow.restore",{id:flow.id},true);
  before=await snapshot(flow);
  await sql("fail_audit");
  try {
    await assert.rejects(owner("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:1,expectedDefinitionVersion:before.definitionVersion},true));
    const after=await snapshot(flow);
    if(baseline) assert(after.definitionVersion>before.definitionVersion); else assert.deepEqual(after,before);
    report({rollbackAuditAtomic:!baseline,oldRollbackSurvivedError:baseline});
  } finally {await sql("restore_audit");}
  const allBefore=(await sql("own_flows")).flows;
  await sql("fail_audit");
  try {
    await assert.rejects(owner("project.createWorkflow",{projectId:fixture.projectId,processCode:"LIFE_"+tag.slice(9),name:"导入审计隔离_"+tag,flowType:"control",definition:(await owner("workflow.get",{id:flow.id})).definition},true));
    const after=(await sql("own_flows")).flows;
    if(baseline) assert.equal(after.length,allBefore.length+1); else assert.deepEqual(after,allBefore);
    report({importAuditAtomic:!baseline,oldIncompleteImportSurvivedError:baseline});
  } finally {await sql("restore_audit");}
}
async function atomicCreationCases() {
  const source=fixture.workflows.find(row=>row.flowType==="control");
  const sourceValue=await owner("workflow.get",{id:source.id});
  for(const kind of ["duplicate","globalCreate"]) {
    const before=(await sql("own_flows")).flows;
    await sql("fail_audit");
    try {
      await assert.rejects(kind==="duplicate"
        ? owner("workflow.duplicate",{id:source.id,name:"复制故障_"+tag,expectedDefinitionVersion:sourceValue.definitionVersion},true)
        : owner("workflow.create",{name:"创建故障_"+tag},true));
      assert.deepEqual((await sql("own_flows")).flows,before);
    } finally {await sql("restore_audit");}
  }
  const imported=await owner("project.createWorkflow",{projectId:fixture.projectId,processCode:"OK_"+tag.slice(9),name:"完整导入_"+tag,flowType:"control",definition:sourceValue.definition},true);
  fixture.workflows.push({id:imported.id,name:imported.name,flowType:"imported"});remember();
  const actual=await owner("workflow.get",{id:imported.id});
  assert.equal(imported.definitionVersion,1);assert.equal(actual.definitionVersion,1);
  assert.deepEqual(imported.definition,actual.definition);
  assert.deepEqual(actual.definition.nodes.map(row=>row.id),sourceValue.definition.nodes.map(row=>row.id));
  const versions=await owner("workflow.versions",{workflowId:imported.id});assert.equal(versions.length,1);
  await owner("workflow.delete",{id:source.id,expectedDefinitionVersion:sourceValue.definitionVersion},true);
  const archived=await snapshot(source);await sql("fail_audit");
  try {await assert.rejects(owner("workflow.restore",{id:source.id,expectedDefinitionVersion:archived.definitionVersion},true));assert.deepEqual(await snapshot(source),archived);}
  finally {await sql("restore_audit");}
  await owner("workflow.restore",{id:source.id},true);
  report({creationAndDuplicateAuditAtomic:true,importedDefinitionReturned:true,singleInitialSnapshot:true,restoreAuditAtomic:true});
}
async function prepareActor() {
  await owner("iam.updateUserStatus",{userId:fixture.disabledUserId,status:"active"},true);
  await grant("designer");
  for(const flow of fixture.workflows.filter(row=>["state","control","data"].includes(row.flowType))) {
    const assignments=await owner("workflow.customRoleAssignments",{workflowId:flow.id,page:0,query:fixture.workflowRoleCode});
    if(!assignments.items.some(row=>Number(row.userId)===fixture.disabledUserId && row.roleCode===fixture.workflowRoleCode && !row.revokedAt))
      await owner("workflow.assignCustomRole",{workflowId:flow.id,userId:fixture.disabledUserId,roleCode:fixture.workflowRoleCode,expectedConfigToken:await roleSnapshotToken()},true);
  }
  const details=await owner("iam.userAuthorizationDetails",{userId:fixture.disabledUserId});
  if(!details.directRoles.some(row=>row.roleCode===fixture.systemRoleCode))
    await owner("iam.assignSystemRole",{userId:fixture.disabledUserId,roleCode:fixture.systemRoleCode},true);
  await viewer("auth.login",memberLogin,true);
}
const resultOf=promise=>promise.then(data=>({ok:true,data}),error=>({ok:false,status:error.status,message:error.message}));
async function raceCases() {
  fixture.workflowRoleCode="custom_"+tag;
  fixture.systemRoleCode="custom_life_system_"+tag.slice(9);remember();
  await owner("iam.createCustomRole",{code:fixture.workflowRoleCode,name:"流程权限验收_"+tag,scope:"workflow",permissions:["workflow:view","workflow:edit","workflow:publish","workflow:members:manage"]},true);
  await owner("iam.createCustomRole",{code:fixture.systemRoleCode,name:"生命周期创建角色_"+tag,scope:"system",permissions:["workflow:create"]},true);
  const flow=fixture.workflows.find(row=>row.flowType==="control");
  for(const mode of ["permission","session","disable"]) for(const operation of ["archive","restore","rollback","projectCreate","duplicate","globalCreate"]) {
    let value=await owner("workflow.get",{id:flow.id});
    if(value.archivedAt) await owner("workflow.restore",{id:flow.id},true);
    await prepareActor();
    if(operation==="restore") await owner("workflow.delete",{id:flow.id},true);
    value=await owner("workflow.get",{id:flow.id});
    const before=await snapshot(flow),beforeFlows=(await sql("own_flows")).flows;
    const barrier=sqlProcess("hold_actor",{identityChange:mode});await barrier.ready;
    let pending;
    try {
      const common={id:flow.id,expectedDefinitionVersion:value.definitionVersion};
      pending=resultOf(operation==="archive"?viewer("workflow.delete",common,true)
        :operation==="restore"?viewer("workflow.restore",common,true)
        :operation==="rollback"?viewer("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:1,expectedDefinitionVersion:value.definitionVersion,restoreAsDraft:true},true)
        :operation==="projectCreate"?viewer("project.createWorkflow",{projectId:fixture.projectId,processCode:"RACE_"+operation.toUpperCase()+"_"+mode.toUpperCase(),name:"竞态创建_"+tag,flowType:"state"},true)
        :operation==="duplicate"?viewer("workflow.duplicate",{...common,name:"竞态副本_"+tag},true)
        :viewer("workflow.create",{name:"竞态全局创建_"+tag},true));
      await poll("lifecycle write waiting on own actor",()=>sql("waiter_actor"),result=>result.waiting,12000);
    } finally {await barrier.release();}
    const result=await pending;
    assert.equal(result.ok,false,operation+" "+mode+" unexpectedly committed");assert.equal(result.status,403,JSON.stringify(result));
    assert.deepEqual(await snapshot(flow),before);assert.deepEqual((await sql("own_flows")).flows,beforeFlows);
    report({race:operation,mode,denied:403,unchanged:true});
  }
  await prepareActor();
  const value=await owner("workflow.get",{id:flow.id});
  if(value.archivedAt) await owner("workflow.restore",{id:flow.id},true);
}
async function conflictCases() {
  const flow=fixture.workflows.find(row=>row.flowType==="control");
  let current=await owner("workflow.get",{id:flow.id});
  const old=current.definitionVersion;
  const changed=structuredClone(current.definition);changed.nodes[0].name+="_新版本";
  await owner("workflow.update",{id:flow.id,definition:changed,expectedDefinitionVersion:old},true);
  const before=await snapshot(flow);
  for(const operation of ["archive","duplicate","rollback"]) {
    await assert.rejects(operation==="archive"?owner("workflow.delete",{id:flow.id,expectedDefinitionVersion:old},true)
      :operation==="duplicate"?owner("workflow.duplicate",{id:flow.id,name:"过期副本_"+tag,expectedDefinitionVersion:old},true)
      :owner("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:1,expectedDefinitionVersion:old,restoreAsDraft:true},true),error=>error.status===409);
    assert.deepEqual(await snapshot(flow),before);
  }
  report({staleArchiveDuplicateRollbackDenied:true});
}

async function publicationCases() {
  const flow=fixture.workflows.find(row=>row.flowType==="control");
  await grant("owner");
  let value=await owner("workflow.get",{id:flow.id});
  await viewer("project.auditWorkflow",{projectId:fixture.projectId,workflowId:flow.id,auditStatus:"approved",expectedDefinitionVersion:value.definitionVersion,expectedAuditStatus:value.auditStatus},true);
  value=await owner("workflow.publish",{id:flow.id,expectedDefinitionVersion:value.definitionVersion},true);
  fixture.lifecyclePublishedVersion=value.definitionVersion;remember();
  await revoke();
  await grant("viewer");
  let role=await owner("iam.customRoleConfiguration",{code:fixture.workflowRoleCode});
  await owner("iam.updateCustomRole",{code:fixture.workflowRoleCode,permissions:["workflow:view","workflow:edit","workflow:members:manage"],expectedConfigToken:role.configToken},true);
  let before=await snapshot(flow);
  await assert.rejects(viewer("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:1,expectedDefinitionVersion:value.definitionVersion,restoreAsDraft:true},true),error=>error.status===403);
  assert.deepEqual(await snapshot(flow),before);
  role=await owner("iam.customRoleConfiguration",{code:fixture.workflowRoleCode});
  await owner("iam.updateCustomRole",{code:fixture.workflowRoleCode,permissions:["workflow:view","workflow:edit","workflow:publish","workflow:members:manage"],expectedConfigToken:role.configToken},true);
  value=await viewer("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:value.definitionVersion,expectedDefinitionVersion:value.definitionVersion,restoreAsDraft:true},true);
  assert.equal(value.status,"draft");assert.equal(value.publishedExecutionPlanHash,null);
  const changed=structuredClone(value.definition);changed.nodes[0].name+="_需要重新审核";
  value=await owner("workflow.update",{id:flow.id,definition:changed,expectedDefinitionVersion:value.definitionVersion},true);
  assert.equal(value.auditStatus,"init");
  const settings=await owner("config.settings",null);
  before=await snapshot(flow);
  if(settings.approval.requireProjectApproval) {
    await assert.rejects(viewer("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:fixture.lifecyclePublishedVersion,expectedDefinitionVersion:value.definitionVersion,restoreAsDraft:false},true),error=>error.status===409);
    assert.deepEqual(await snapshot(flow),before);
  }
  report({editCannotUnpublishViaRollback:true,publishedSnapshotCanBecomeDraft:true,changedDraftRequiresReview:true,currentApprovalRuleEnforced:Boolean(settings.approval.requireProjectApproval)});
}
async function parallelCases() {
  const flow=fixture.workflows.find(row=>row.flowType==="control");
  const before=await snapshot(flow);
  const results=await Promise.all([1,2].map(()=>resultOf(owner("workflow.rollbackVersion",{workflowId:flow.id,targetVersion:1,expectedDefinitionVersion:before.definitionVersion,restoreAsDraft:true},true))));
  assert.equal(results.filter(row=>row.ok).length,1);assert.equal(results.find(row=>!row.ok).status,409);
  const after=await snapshot(flow);assert.equal(after.definitionVersion,before.definitionVersion+1);assert.equal(after.versions,before.versions+1);assert.equal(after.audits,before.audits+1);
  const inputs={projectId:fixture.projectId,processCode:"PAR_"+tag.slice(9),name:"并发导入_"+tag,flowType:"state"};
  const creations=await Promise.all([1,2].map(()=>resultOf(owner("project.createWorkflow",inputs,true))));
  assert.equal(creations.filter(row=>row.ok).length,1);assert.equal(creations.find(row=>!row.ok).status,409);
  report({parallelRollbackSingleSnapshot:true,parallelProcessCodeSingleCreation:true});
}
async function browserCases() {
  const flow=fixture.workflows.find(row=>row.flowType==="control");
  const browser=await chromium.launch({headless:true,executablePath:executable()});
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:"block",reducedMotion:"reduce"});
  await context.route("**/*",route=>route.request().url().startsWith(base)?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  try {
    await page.goto(base+"#/flows",{waitUntil:"domcontentloaded"});
    await page.getByLabel("用户名",{exact:true}).fill(memberLogin.username);await page.getByLabel("密码",{exact:true}).fill(memberLogin.password);
    await page.getByRole("button",{name:"登录流程引擎",exact:true}).click();await expect(page.locator("[data-aiflow-business-center]")).toBeVisible({timeout:20000});
    await page.goto(base+"#/flows/workflow/"+flow.id+"/detail");await page.getByRole("tab",{name:"版本历史",exact:true}).click();
    const card=page.locator('section[aria-label="版本快照列表"] article').filter({has:page.getByText("v"+fixture.lifecyclePublishedVersion,{exact:true})}).filter({visible:true});
    const opener=card.getByRole("button",{name:"恢复此版本",exact:true});
    const form=()=>page.getByRole("dialog",{name:"恢复流程版本",exact:true});
    await opener.click();await expect(form()).toBeVisible();
    for(const width of [320,390,1024,1920]) {
      await page.setViewportSize({width,height:844});
      const submit=form().getByRole("button",{name:"恢复为草稿",exact:true});await expect(submit).toBeInViewport();
      assert(await submit.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    await page.setViewportSize({width:1440,height:1000});
    const choice=form().getByRole("checkbox");await expect(choice).not.toBeChecked();await choice.check();await expect(form().getByRole("button",{name:"恢复并发布",exact:true})).toBeVisible();await choice.uncheck();
    await sql("fail_audit");
    try {await form().getByRole("button",{name:"恢复为草稿",exact:true}).click();await expect(form().getByRole("alert").first()).toContainText("暂时无法确认流程操作结果");await expect(choice).not.toBeChecked();}
    finally {await sql("restore_audit");}
    let release,heldResolve,writes=0;const gate=new Promise(resolve=>release=resolve),held=new Promise(resolve=>heldResolve=resolve);
    const pattern="**/api/trpc/**";
    const handler=async route=>{
      if(route.request().method()==="POST" && route.request().url().includes("workflow.rollbackVersion")) {
        writes++;const response=await route.fetch();assert.equal(response.status(),200);heldResolve();await gate;await route.fulfill({response});
      } else await route.continue();
    };
    await page.route(pattern,handler);
    try {
      await form().getByRole("button",{name:"恢复为草稿",exact:true}).click();await held;
      await expect(choice).toBeDisabled();await expect(form().getByRole("button",{name:"取消",exact:true})).toBeDisabled();await page.keyboard.press("Escape");await expect(form()).toBeVisible();
      release();await expect(form()).toBeHidden();assert.equal(writes,1);
    } finally {release();await page.unroute(pattern,handler);}
    await expect(opener).toBeEnabled();await opener.click();
    let value=await owner("workflow.get",{id:flow.id});const changed=structuredClone(value.definition);changed.nodes[0].name+="_外部修改";
    await owner("workflow.update",{id:flow.id,definition:changed,expectedDefinitionVersion:value.definitionVersion},true);
    const before=await snapshot(flow);
    await form().getByRole("button",{name:"恢复为草稿",exact:true}).click();await expect(form().getByRole("alert").first()).toContainText("流程版本已变化");assert.deepEqual(await snapshot(flow),before);
    await form().getByRole("button",{name:"关闭并读取最新版本",exact:true}).click();await expect(form()).toBeHidden();await expect(opener).toBeEnabled();
    assert.deepEqual(errors,[]);
    report({versionRestoreUI:true,defaultDraft:true,publishExplicit:true,auditFailureKeptDialog:true,pendingLocked:true,oneWrite:true,staleVersionKeptDialog:true,explicitReload:true,viewports:[320,390,1024,1920],browserErrors:0});
  } catch(error){await page.screenshot({path:path.join(directory,"lifecycle-failure.png")}).catch(()=>{});throw error;}
  finally {await browser.close();}
}

(async()=>{
  let fingerprint,environment,failed=false;
  try {
    await remote({action:"setup",tag,login,disabledPassword:memberLogin.password});
    fingerprint=(await remote({action:"settings_fingerprint"})).trim();
    environment=await sql("environment");
    await owner("auth.login",login,true);
    await auditCases();
    if(!baseline) {await atomicCreationCases();await raceCases();await conflictCases();await publicationCases();await parallelCases();await browserCases();}
    report({lifecycle:true,baseline,passed:true,tag});
  } catch(error){failed=true;console.error(error.stack??error.message);}
  finally {
    if(fixture) {
      try {
        await sql("restore_audit");
        for(const flow of (await sql("own_flows")).flows) {
          if(Number(flow.ownerUserId)===fixture.disabledUserId) {if(!flow.archivedAt) await owner("workflow.delete",{id:flow.id},true);continue;}
          assert.equal(Number(flow.ownerUserId),fixture.userId);
          if(!fixture.workflows.some(row=>row.id===flow.id)) fixture.workflows.push(flow);
        }
        remember();
        // Authorization writes intentionally reject archived flows. Restore only
        // this fixture's archived flows before the shared role cleanup archives them again.
        if(fixture.workflowRoleCode) for(const flow of fixture.workflows) {
          const value=await owner("workflow.get",{id:flow.id});
          assert.equal(Number(value.ownerUserId),fixture.userId);assert.equal(value.name,flow.name);assert(value.name.endsWith(tag));
          if(value.archivedAt) await owner("workflow.restore",{id:flow.id},true);
        }
        if(fixture.systemRoleCode) {
          const details=await owner("iam.userAuthorizationDetails",{userId:fixture.disabledUserId});
          for(const assignment of details.directRoles.filter(row=>row.roleCode===fixture.systemRoleCode)) await owner("iam.revokeRoleAssignment",{assignmentId:assignment.assignmentId},true);
          const role=await owner("iam.customRoleConfiguration",{code:fixture.systemRoleCode});
          await owner("iam.deleteCustomRole",{code:fixture.systemRoleCode,expectedConfigToken:role.configToken},true);
        }
        if(environment) assert.deepEqual(await sql("environment"),environment);
        if(fingerprint) assert.equal((await remote({action:"settings_fingerprint"})).trim(),fingerprint);
        report({output:(await remote({action:"cleanup",fixture,login})).trim()});
      } catch(error){failed=true;console.error("Cleanup failed: "+error.stack);}
    }
    process.exitCode=failed?1:0;
  }
})();

// Fixture setup confirms the role immediately before a sequential grant; UI conflict tests submit captured tokens.
async function roleSnapshotToken() {
  return (await owner("iam.customRoleConfiguration", { code: fixture.workflowRoleCode })).configToken;
}
