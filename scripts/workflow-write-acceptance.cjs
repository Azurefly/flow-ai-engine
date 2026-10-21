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
  path.join(__dirname, "workflow-write-fixtures.mjs"),
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
  if (action !== "hold_project") child.stdin.end();
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
  assert(/^(CREATE|DROP) TRIGGER flow_write_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("flow_write_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      fixture.workflows.every(flow => statement.includes(flow.id)) &&
        statement.includes("isolated_workflow_audit_rejected")
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
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
async function bind(flow) {
  await owner(
    "workflow.assignCustomRole",
    {
      workflowId: flow.id,
      userId: fixture.disabledUserId,
      roleCode: fixture.workflowRoleCode,
    },
    true
  );
}
async function unbind(flow) {
  const grants = await owner("workflow.customRoleAssignments", {
    workflowId: flow.id,
    page: 0,
    query: fixture.workflowRoleCode,
  });
  const matching = grants.items.filter(
    item =>
      Number(item.userId) === fixture.disabledUserId &&
      item.roleCode === fixture.workflowRoleCode &&
      !item.revokedAt
  );
  assert.equal(matching.length, 1);
  await owner(
    "workflow.revokeCustomRole",
    { workflowId: flow.id, assignmentId: matching[0].id },
    true
  );
}
async function review(flow) {
  await grant("owner");
  try {
    const current = await owner("workflow.get", { id: flow.id });
    assert.equal(current.status, "draft");
    await viewer(
      "project.auditWorkflow",
      {
        projectId: fixture.projectId,
        workflowId: flow.id,
        auditStatus: "approved",
        expectedDefinitionVersion: Number(current.definitionVersion),
        expectedAuditStatus: current.auditStatus,
      },
      true
    );
  } finally {
    await revoke();
    await grant("viewer");
  }
}
const resultOf = promise =>
  promise.then(
    data => ({ ok: true, data }),
    error => ({ ok: false, status: error.status, message: error.message })
  );

async function verify(page, reproduction) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const flow of fixture.workflows) {
    await bind(flow);
    await page.goto(base + "#/flows/workflow/" + flow.id + "/editor");
    await page.locator("[data-workflow-editor]").waitFor();
    const current = await owner("workflow.get", { id: flow.id });
    const middle = current.definition.nodes.find(
      item => item.type === (flow.flowType === "data" ? "filter" : "operate")
    );
    assert(middle);
    await page
      .getByRole("combobox", { name: "定位并配置节点", exact: true })
      .selectOption(middle.id);
    const field = page
      .locator("[data-workflow-inspector]")
      .getByRole("textbox", { name: "节点名称", exact: true });
    const draft = (await field.inputValue()) + "_事务撤权_" + tag;
    await field.fill(draft);
    const before = await snapshot(flow),
      barrier = sqlProcess("hold_project");
    await barrier.ready;
    let response, revocation;
    try {
      response = page.waitForResponse(
        row =>
          row.request().method() === "POST" &&
          row.url().includes("workflow.update"),
        { timeout: 30000 }
      );
      response.catch(() => {});
      await page.getByRole("button", { name: /^保存画布/ }).click();
      await poll(
        "save blocked on the isolated project row",
        () => sql("waiter"),
        value => value.waiting,
        12000
      );
      revocation = resultOf(unbind(flow));
      // Revocation commits before its audit response; that audit's user foreign
      // key can wait for the writer's account lock. Observe the committed access
      // result before releasing the barrier, then await both HTTP responses.
      await poll(
        "committed edit revocation",
        () => viewer("workflow.access", { id: flow.id }),
        access => !has(access, "workflow:edit"),
        12000
      );
    } finally {
      await barrier.release();
    }
    assert.equal((await revocation).ok, true);
    assert.equal((await response).status(), reproduction ? 200 : 403);
    if (!reproduction) {
      assert.deepEqual(await snapshot(flow), before);
      await expect(field).toHaveValue(draft);
      await expect(field).toBeDisabled();
    }
    await bind(flow);
    await refresh(page);
    await expect(field).toHaveValue(draft);
    await expect(field).toBeEnabled();
    if (!reproduction) {
      const saved = page.waitForResponse(
        row =>
          row.request().method() === "POST" &&
          row.url().includes("workflow.update")
      );
      await page.getByRole("button", { name: /^保存画布/ }).click();
      assert.equal((await saved).status(), 200);
    }
    await expect(
      page.getByRole("button", { name: /^保存画布/ })
    ).toBeDisabled();
    assert.equal(
      (await owner("workflow.get", { id: flow.id })).definition.nodes.find(
        item => item.id === middle.id
      ).name,
      draft
    );
    await unbind(flow);
    report({
      stage: "write-save-race",
      flowType: flow.flowType,
      blockedRequestObserved: true,
      staleAuthorizationWriteAccepted: reproduction,
      draftRetained: true,
      restoredSaveSucceeded: !reproduction,
    });

    await review(flow);
    for (const operation of ["publish", "unpublish"]) {
      let actual = await owner("workflow.get", { id: flow.id });
      if (operation === "unpublish" && actual.status === "draft") {
        await owner(
          "workflow.publish",
          {
            id: flow.id,
            expectedDefinitionVersion: Number(actual.definitionVersion),
          },
          true
        );
        actual = await owner("workflow.get", { id: flow.id });
      }
      await bind(flow);
      const original = await snapshot(flow),
        lock = sqlProcess("hold_project");
      await lock.ready;
      let submitted, revocation;
      try {
        submitted = resultOf(
          viewer(
            "workflow." + operation,
            {
              id: flow.id,
              expectedDefinitionVersion: Number(actual.definitionVersion),
            },
            true
          )
        );
        await poll(
          operation + " blocked on isolated project",
          () => sql("waiter"),
          value => value.waiting,
          12000
        );
        revocation = resultOf(unbind(flow));
        await poll(
          "committed publication revocation",
          () => viewer("workflow.access", { id: flow.id }),
          access => !has(access, "workflow:publish"),
          12000
        );
      } finally {
        await lock.release();
      }
      assert.equal((await revocation).ok, true);
      const result = await submitted;
      assert.equal(result.ok, reproduction);
      if (!reproduction) {
        assert.equal(result.status, 403);
        assert.deepEqual(await snapshot(flow), original);
      }
      report({
        stage: "write-lifecycle-race",
        flowType: flow.flowType,
        operation,
        blockedRequestObserved: true,
        staleAuthorizationWriteAccepted: result.ok,
        unchangedOnDenial: !reproduction,
      });
    }
    let actual = await owner("workflow.get", { id: flow.id });
    if (actual.status === "published")
      await owner(
        "workflow.unpublish",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(actual.definitionVersion),
        },
        true
      );
    for (const operation of ["publish", "unpublish"]) {
      actual = await owner("workflow.get", { id: flow.id });
      if (operation === "publish") await review(flow);
      if (operation === "unpublish" && actual.status === "draft")
        await owner(
          "workflow.publish",
          {
            id: flow.id,
            expectedDefinitionVersion: Number(actual.definitionVersion),
          },
          true
        );
      actual = await owner("workflow.get", { id: flow.id });
      const original = await snapshot(flow);
      await sql("fail_audit");
      let result;
      try {
        result = await resultOf(
          owner(
            "workflow." + operation,
            {
              id: flow.id,
              expectedDefinitionVersion: Number(actual.definitionVersion),
            },
            true
          )
        );
        assert.equal(result.ok, false);
        assert.equal(result.status, 500);
        const after = await snapshot(flow);
        if (!reproduction) assert.deepEqual(after, original);
        else {
          assert.equal(
            Number(after.definitionVersion),
            Number(original.definitionVersion) + 1
          );
          assert.equal(
            Number(after.publicationAudits),
            Number(original.publicationAudits)
          );
          assert.notEqual(after.status, original.status);
        }
      } finally {
        await sql("restore_audit");
      }
      report({
        stage: "write-audit-atomicity",
        flowType: flow.flowType,
        operation,
        apiReportedFailure: true,
        businessAndVersionsRolledBack: !reproduction,
        auditFailureLeftCommittedChange: reproduction,
      });
    }
    actual = await owner("workflow.get", { id: flow.id });
    if (actual.status === "published")
      await owner(
        "workflow.unpublish",
        {
          id: flow.id,
          expectedDefinitionVersion: Number(actual.definitionVersion),
        },
        true
      );
  }
  assert.deepEqual(errors, []);
  report({ stage: "workflow-write-complete", reproduction, browserErrors: 0 });
}

(async () => {
  let browser,
    page,
    fingerprint,
    environment,
    failed = false;
  const reproduction = process.env.FLOW_UI_WORKFLOW_WRITE_REPRO === "1";
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    environment = await sql("environment");
    await owner("auth.login", login, true);
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await grant("viewer");
    await viewer("auth.login", memberLogin, true);
    fixture.workflowRoleCode = "custom_" + tag;
    remember();
    await owner(
      "iam.createCustomRole",
      {
        code: fixture.workflowRoleCode,
        name: "流程权限验收_" + tag,
        scope: "workflow",
        permissions: ["workflow:view", "workflow:edit", "workflow:publish"],
      },
      true
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
    await page.goto(base);
    await page.getByLabel("用户名", { exact: true }).fill(memberLogin.username);
    await page.getByLabel("密码", { exact: true }).fill(memberLogin.password);
    await page
      .getByRole("button", { name: "登录流程引擎", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "业务中心", exact: true })
    ).toBeVisible({ timeout: 20000 });
    await verify(page, reproduction);
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
          animations: "disabled",
        })
        .catch(() => {});
  } finally {
    if (browser) await browser.close();
    if (fixture?.tag) {
      try {
        report(await sql("restore_audit"));
      } catch (error) {
        failed = true;
        console.error(error.message);
      }
      if (environment)
        try {
          assert.deepEqual(await sql("environment"), environment);
        } catch (error) {
          failed = true;
          console.error(error.message);
        }
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
