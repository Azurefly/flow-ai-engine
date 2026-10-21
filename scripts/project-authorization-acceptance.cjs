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
const recipientLogin = credentials("_recipient");
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
const recipient = session();
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
const sqlHelper = fs.readFileSync(
  path.join(__dirname, "project-authorization-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const projectAuthorizationIntent=" +
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
  if (action !== "hold_authorization") child.stdin.end();
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
  assert(/^(CREATE|DROP) TRIGGER project_auth_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("project_auth_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes(fixture.projectId) &&
        statement.includes("isolated_project_audit_rejected")
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

const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const resultOf = promise =>
  promise.then(
    data => ({ ok: true, data }),
    error => ({ ok: false, status: error.status, message: error.message })
  );
const snapshot = () => sql("snapshot");
function within(promise, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Timed out: " + description)),
        20000
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
async function ensureTarget(operation) {
  if (operation.endsWith("Member")) {
    await owner(
      "project.grantMember",
      {
        projectId: fixture.projectId,
        userId: fixture.recipientUserId,
        role: "viewer",
      },
      true
    );
    const rows = await owner("project.members", {
      projectId: fixture.projectId,
    });
    const row = rows.find(
      item =>
        Number(item.userId) === fixture.recipientUserId &&
        item.role === "viewer"
    );
    assert(row);
    return row.id;
  }
  await owner(
    "project.grantUnit",
    {
      projectId: fixture.projectId,
      unitId: fixture.targetUnitId,
      role: "viewer",
    },
    true
  );
}
function input(operation, assignmentId) {
  return {
    projectId: fixture.projectId,
    ...(operation.endsWith("Member")
      ? {
          userId: fixture.recipientUserId,
          ...(assignmentId ? { assignmentId } : {}),
          role: "viewer",
        }
      : { unitId: fixture.targetUnitId, role: "designer" }),
  };
}
const sourceStatus = status =>
  owner(
    "config.updateOrganizationUnit",
    { id: fixture.sourceUnitId, status },
    true
  );
async function verifyBackend(reproduction) {
  for (const operation of [
    "grantMember",
    "revokeMember",
    "grantUnit",
    "revokeUnit",
  ]) {
    const assignmentId = await ensureTarget(operation),
      before = await snapshot(),
      lock = sqlProcess("hold_authorization", { operation });
    await lock.ready;
    let submitted, disabled;
    try {
      submitted = resultOf(
        viewer("project." + operation, input(operation, assignmentId), true)
      );
      await poll(
        "isolated authorization write waiting",
        () => sql("waiter"),
        value => value.waiting,
        12000
      );
      disabled = resultOf(sourceStatus("disabled"));
      await poll(
        "committed loss of department management",
        () => viewer("project.access", { projectId: fixture.projectId }),
        access => !has(access, "project:manage"),
        12000
      );
    } finally {
      await lock.release();
    }
    assert.equal((await disabled).ok, true);
    const result = await submitted;
    assert.equal(result.ok, reproduction);
    if (!reproduction) {
      assert.equal(result.status, 403);
      assert.deepEqual(await snapshot(), before);
    }
    await sourceStatus("active");
    report({
      stage: "project-authorization-race",
      operation,
      blockedWriteObserved: true,
      committedManagementLossObserved: true,
      staleWriteAccepted: result.ok,
      unchangedOnDenial: !reproduction,
    });
    const id = await ensureTarget(operation),
      original = await snapshot();
    await sql("fail_audit");
    try {
      const failed = await resultOf(
        viewer("project." + operation, input(operation, id), true)
      );
      assert.equal(failed.ok, false);
      assert.equal(failed.status, 500);
      const after = await snapshot(),
        partial = reproduction && operation !== "revokeMember";
      if (partial) {
        assert.notDeepEqual(after, original);
        assert.equal(after.audits, original.audits);
      } else assert.deepEqual(after, original);
      report({
        stage: "project-authorization-atomicity",
        operation,
        businessChangedDespiteFailure: partial,
        completeRollback: !partial,
      });
    } finally {
      await sql("restore_audit");
    }
  }
}
async function signIn(page, credentials) {
  await page.goto(base);
  await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录流程引擎", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "业务中心", exact: true })
  ).toBeVisible({ timeout: 20000 });
}
async function refreshAccess(page) {
  const waiting = page.waitForResponse(
    row =>
      row.request().method() === "GET" && row.url().includes("project.access")
  );
  waiting.catch(() => {});
  await page.evaluate(() => {
    for (const value of ["hidden", "visible"]) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await waiting;
}
async function pick(page, label, query) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("combobox", { name: label + "搜索", exact: true })
    .fill(query);
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(1);
  await options.click();
  await page.keyboard.press("Escape");
  assert(
    await page.getByRole("combobox", { name: label, exact: true }).innerText()
  );
}
async function verifyUi(page, reproduction) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "#/flows/project/" + fixture.projectId);
  await page
    .getByRole("button", { name: "权限配置中心", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      name: reproduction ? "项目权限配置与可见性中心" : "业务成员与部门授权",
      exact: true,
    })
  ).toBeVisible();
  const member = page.locator('[data-project-permission-grant="member"]'),
    department = page.locator('[data-project-permission-grant="department"]');
  await member.locator("summary").click();
  await department.locator("summary").click();
  const memberRole = member.getByRole("combobox", {
      name: "用户权限角色",
      exact: true,
    }),
    hours = member.getByRole("spinbutton", {
      name: "有效期小时（可选）",
      exact: true,
    });
  const unitRole = department.getByRole("combobox", {
    name: "部门权限角色",
    exact: true,
  });
  const saveMember = member.locator('button[type="submit"]'),
    saveUnit = department.locator('button[type="submit"]');
  const targetUsername = tag + "_recipient",
    targetCode = fixture.authorizationUnits.find(
      unit => unit.id === fixture.targetUnitId
    ).code;
  await pick(page, "选择可见人账号", targetUsername);
  await memberRole.selectOption("designer");
  await hours.fill("8");
  await pick(page, "选择可见部门", targetCode);
  await unitRole.selectOption("designer");
  let overflowObserved = false;
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    if (reproduction) overflowObserved ||= dimensions.document > width + 1;
    else
      assert(
        dimensions.document <= width + 1,
        `Authorization layout overflows at ${width}: ${dimensions.document}`
      );
    if (!reproduction && [390, 1440].includes(width))
      await member.screenshot({
        path: path.join(directory, "authorization-member-" + width + ".png"),
        animations: "disabled",
      });
  }
  if (reproduction)
    assert(
      overflowObserved,
      "Old four-column form should reproduce nested-sidebar overflow"
    );
  report({
    stage: "project-authorization-layout",
    reproduction,
    widths: [320, 390, 1024, 1440],
    oldOverflowObserved: overflowObserved,
  });
  if (!reproduction) {
    await page
      .getByRole("button", { name: "资源配置中心", exact: true })
      .click();
    const leave = page.getByRole("alertdialog", {
      name: "离开前保留授权填写",
      exact: true,
    });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(hours).toHaveValue("8");
    await expect(unitRole).toHaveValue("designer");
    const failRead = name => async route => {
      const request = route.request(),
        url = new URL(request.url()),
        names = decodeURIComponent(url.pathname.split("/api/trpc/")[1]).split(
          ","
        );
      if (request.method() !== "GET" || !names.includes(name))
        return route.fallback();
      const inputs = JSON.parse(url.searchParams.get("input")),
        candidate = inputs.json ? inputs : inputs[names.indexOf(name)];
      if (candidate?.json?.projectId !== fixture.projectId)
        return route.fallback();
      const response = await route.fetch(),
        body = await response.json(),
        error = {
          error: {
            json: {
              message: "隔离授权读取测试中断",
              code: -32603,
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 503,
                path: name,
              },
            },
          },
        };
      if (Array.isArray(body)) body[names.indexOf(name)] = error;
      await route.fulfill({
        response,
        status: Array.isArray(body) ? 207 : 503,
        json: Array.isArray(body) ? body : error,
      });
    };
    const accessFailure = failRead("project.access");
    await page.route("**/api/trpc/**", accessFailure);
    await refreshAccess(page);
    await expect(
      page.getByRole("heading", { name: "暂时无法确认业务权限", exact: true })
    ).toBeVisible();
    await expect(page.locator("[data-project-authorizations]")).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出未保存填写", exact: true })
      .click();
    const file = path.join(directory, "authorization-retained-draft.json");
    await (await downloading).saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    assert(
      exported.drafts.some(
        item =>
          item.category === "project-authorization" &&
          item.value.userId === String(fixture.recipientUserId) &&
          item.value.hours === "8"
      )
    );
    await page.unroute("**/api/trpc/**", accessFailure);
    await page
      .getByRole("button", { name: "刷新业务权限", exact: true })
      .click();
    await expect(hours).toHaveValue("8");
    await expect(
      page.getByRole("combobox", { name: "选择可见人账号", exact: true })
    ).toContainText("授权接收人_" + tag);
    await expect(
      page.getByRole("combobox", { name: "选择可见部门", exact: true })
    ).toContainText("待授权部门_");
    await sourceStatus("disabled");
    await refreshAccess(page);
    await expect(hours).toBeDisabled();
    await expect(unitRole).toBeDisabled();
    await expect(saveMember).toBeDisabled();
    await expect(
      page.getByText("部门已停用，当前不继承此授权。", { exact: true })
    ).toBeVisible();
    await sourceStatus("active");
    await page
      .getByRole("button", { name: "重新读取业务授权", exact: true })
      .click();
    await expect(hours).toBeEnabled();
    await expect(hours).toHaveValue("8");
    await expect(unitRole).toHaveValue("designer");
    const memberFailure = failRead("project.members");
    await page.route("**/api/trpc/**", memberFailure);
    await page
      .getByRole("button", { name: "重新读取业务授权", exact: true })
      .click();
    await expect(saveMember).toBeDisabled();
    await expect(saveUnit).toBeEnabled();
    assert(
      !(
        await page
          .locator('[data-project-permission-list="member"]')
          .innerText()
      ).includes(targetUsername)
    );
    await expect(hours).toHaveValue("8");
    await page.unroute("**/api/trpc/**", memberFailure);
    await page
      .getByRole("button", { name: "重新读取业务授权", exact: true })
      .click();
    await expect(saveMember).toBeEnabled();
    report({
      stage: "project-authorization-recovery",
      navigationKeptDraft: true,
      accessReadFailureExportedAndRestored: true,
      selectedNamesRetained: true,
      managementLossLockedForms: true,
      memberReadFailureHidCache: true,
    });
  }
  let release,
    seenResolve,
    releaseRead = () => {},
    slowRead,
    readSeen;
  const hold = new Promise(resolve => {
      release = resolve;
    }),
    seen = new Promise(resolve => {
      seenResolve = resolve;
    });
  let submissions = 0;
  const gate = async route => {
    if (
      route.request().method() !== "POST" ||
      !route.request().url().includes("project.grantMember")
    )
      return route.fallback();
    submissions++;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    seenResolve();
    await hold;
    await route.fulfill({ response });
  };
  await page.route("**/api/trpc/**", gate);
  try {
    await saveMember.click();
    await within(seen, "acknowledged authorization save");
    if (reproduction) {
      await expect(hours).toBeEnabled();
      await hours.fill("24");
      await memberRole.selectOption("operator");
    } else {
      await expect(hours).toBeDisabled();
      await expect(memberRole).toBeDisabled();
      await expect(
        page.getByRole("combobox", { name: "选择可见人账号", exact: true })
      ).toBeDisabled();
      await member.locator("form").evaluate(form => form.requestSubmit());
      await page
        .getByRole("button", { name: "资源配置中心", exact: true })
        .click();
      await expect(page.locator("[data-project-authorizations]")).toBeVisible();
      assert.equal(submissions, 1);
      let readSeenResolve;
      const readHold = new Promise(resolve => {
        releaseRead = resolve;
      });
      readSeen = new Promise(resolve => {
        readSeenResolve = resolve;
      });
      slowRead = async route => {
        if (
          route.request().method() !== "GET" ||
          !route.request().url().includes("project.members")
        )
          return route.fallback();
        const response = await route.fetch();
        readSeenResolve();
        await readHold;
        await route.fulfill({ response });
      };
      await page.route("**/api/trpc/**", slowRead);
    }
    release();
    await expect(hours).toHaveValue("");
    await expect(memberRole).toHaveValue("viewer");
    if (!reproduction) {
      await within(readSeen, "post-save authorization refresh");
      await expect(
        page.locator("[data-project-authorizations]")
      ).toHaveAttribute("aria-busy", "false");
      await expect(hours).toBeEnabled();
      await hours.fill("5");
      await page
        .getByRole("button", { name: "资源配置中心", exact: true })
        .click();
      const leave = page.getByRole("alertdialog", {
        name: "离开前保留授权填写",
        exact: true,
      });
      await expect(leave).toBeVisible();
      await leave
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "资源配置中心", exact: true })
      ).toBeFocused();
      const reread = page.waitForResponse(
        row =>
          row.request().method() === "GET" &&
          row.url().includes("project.members")
      );
      releaseRead();
      await reread;
      await expect(hours).toHaveValue("5");
      await hours.fill("");
      report({
        stage: "project-post-save-refresh",
        writeLockReleasedAfterAcknowledgement: true,
        lateReadKeptNextInput: true,
        navigationCancelRestoredFocus: true,
      });
    }
  } finally {
    release();
    releaseRead();
    if (slowRead) await page.unroute("**/api/trpc/**", slowRead);
    await page.unroute("**/api/trpc/**", gate);
  }
  assert.equal(submissions, 1);
  report({
    stage: "project-authorization-submit",
    reproduction,
    fieldsLocked: !reproduction,
    laterInputClearedOnOldUi: reproduction,
    duplicateWriteBlocked: !reproduction,
    leaveBlockedWhilePending: !reproduction,
    confirmedSaveClearedDraft: true,
  });
  if (!reproduction) {
    await expect(unitRole).toHaveValue("designer");
    await sql("fail_audit");
    try {
      const failed = page.waitForResponse(
        row =>
          row.request().method() === "POST" &&
          row.url().includes("project.grantUnit")
      );
      await saveUnit.click();
      assert.equal((await failed).status(), 500);
      await expect(unitRole).toHaveValue("designer");
      await expect(
        page.getByText(/暂时无法确认保存结果，填写已保留/)
      ).toBeVisible();
    } finally {
      await sql("restore_audit");
    }
    await page
      .getByRole("button", { name: "重新读取业务授权", exact: true })
      .click();
    const saved = page.waitForResponse(
      row =>
        row.request().method() === "POST" &&
        row.url().includes("project.grantUnit")
    );
    await saveUnit.click();
    assert.equal((await saved).status(), 200);
    await expect(unitRole).toHaveValue("viewer");
    await expect(page.locator("[data-project-authorizations]")).toHaveAttribute(
      "aria-busy",
      "false"
    );
    const target = (
      await owner("project.units", { projectId: fixture.projectId })
    ).find(unit => unit.unitId === fixture.targetUnitId);
    assert.equal(target.role, "designer");
    assert(
      has(
        await recipient("project.access", { projectId: fixture.projectId }),
        "project:workflow:edit"
      )
    );
    for (const kind of ["member", "unit"]) {
      if (kind === "unit")
        await owner(
          "config.assignOrganizationMember",
          {
            unitId: fixture.targetUnitId,
            userId: fixture.recipientUserId,
            isPrimary: false,
          },
          true
        );
      assert(
        has(
          await recipient("project.access", { projectId: fixture.projectId }),
          "project:workflow:edit"
        )
      );
      const targetUnit = fixture.authorizationUnits.find(
        unit => unit.id === fixture.targetUnitId
      );
      const remove =
        kind === "member"
          ? page.getByRole("button", { name: /移除成员授权：.* · 设计者$/ })
          : page.getByRole("button", {
              name: `移除部门授权：${targetUnit.name}（${targetUnit.code}）`,
              exact: true,
            });
      await remove.click();
      const dialog = page.getByRole("alertdialog", {
        name: "确认移除项目授权",
        exact: true,
      });
      await sql("fail_audit");
      try {
        const rejected = page.waitForResponse(
          row =>
            row.request().method() === "POST" &&
            row.url().includes("project.revoke")
        );
        await dialog
          .getByRole("button", { name: "确认移除", exact: true })
          .click();
        assert.equal((await rejected).status(), 500);
        await expect(dialog.getByRole("alert")).toBeVisible();
        assert(
          has(
            await recipient("project.access", { projectId: fixture.projectId }),
            "project:workflow:edit"
          )
        );
      } finally {
        await sql("restore_audit");
      }
      const removed = page.waitForResponse(
        row =>
          row.request().method() === "POST" &&
          row.url().includes("project.revoke")
      );
      await dialog
        .getByRole("button", { name: "确认移除", exact: true })
        .click();
      assert.equal((await removed).status(), 200);
      await expect(dialog).toHaveCount(0);
      const remaining = await recipient("project.access", {
        projectId: fixture.projectId,
      });
      assert(has(remaining, "project:view"));
      assert(!has(remaining, "project:workflow:edit"));
      report({
        stage: "project-effective-permission",
        kind,
        failedRevokeKeptEdit: true,
        successfulRevokeRemovedEdit: true,
        directViewerRetained: true,
      });
    }
    for (const flow of fixture.workflows) {
      const current = await viewer("workflow.get", { id: flow.id }),
        definition = structuredClone(current.definition);
      definition.nodes.find(
        node => node.type !== "start" && node.type !== "end"
      ).name += "_部门继承";
      await viewer(
        "workflow.update",
        {
          id: flow.id,
          definition,
          expectedDefinitionVersion: Number(current.definitionVersion),
        },
        true
      );
    }
    report({
      stage: "project-department-flow-access",
      flowTypes: ["state", "control", "data"],
      ordinaryDepartmentManagerCanSave: true,
    });
    // Rebuild a draft and verify logout cancellation and explicit discard/account isolation.
    await hours.fill("4");
    await page.getByRole("button", { name: "退出", exact: true }).click();
    let leave = page.getByRole("alertdialog", {
      name: "离开前保留授权填写",
      exact: true,
    });
    await expect(leave).toBeVisible();
    await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
    await expect(hours).toHaveValue("4");
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await page
      .getByRole("alertdialog", { name: "离开前保留授权填写", exact: true })
      .getByRole("button", { name: "放弃填写并离开", exact: true })
      .click();
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
    await signIn(page, login);
    await page.goto(base + "#/flows/project/" + fixture.projectId);
    await page
      .getByRole("button", { name: "权限配置中心", exact: false })
      .first()
      .click();
    await page
      .locator('[data-project-permission-grant="member"] summary')
      .click();
    await expect(
      page.getByRole("spinbutton", { name: "有效期小时（可选）", exact: true })
    ).toHaveValue("");
    report({
      stage: "project-authorization-account",
      logoutCancelledKeptDraft: true,
      explicitDiscardOnly: true,
      newAccountHasNoPreviousDraft: true,
    });
  }
  assert.deepEqual(errors, []);
  report({
    stage: "project-authorization-ui-complete",
    reproduction,
    browserErrors: 0,
  });
}
async function cleanupUnits() {
  if (!fixture.authorizationUnits?.length) return;
  if (fixture.sourceUnitId) await sourceStatus("active");
  const bindings = await owner("project.units", {
    projectId: fixture.projectId,
  });
  for (const unit of fixture.authorizationUnits)
    if (bindings.some(binding => binding.unitId === unit.id))
      await owner(
        "project.revokeUnit",
        { projectId: fixture.projectId, unitId: unit.id },
        true
      );
  if (fixture.sourceUnitId)
    for (const member of (await sql("membership")).members)
      await owner(
        "config.removeOrganizationMember",
        { unitId: member.unitId, userId: Number(member.userId) },
        true
      );
  for (const unit of [...fixture.authorizationUnits].reverse()) {
    assert(unit.name.endsWith(fixture.tag));
    await owner("config.deleteOrganizationUnit", { id: unit.id }, true);
  }
  report({
    stage: "project-authorization-unit-cleanup",
    deletedOwnUnits: fixture.authorizationUnits.length,
  });
}
(async () => {
  let browser,
    page,
    fingerprint,
    environment,
    failed = false;
  const reproduction = process.env.FLOW_UI_PROJECT_AUTHORIZATION_REPRO === "1";
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    await owner("auth.login", login, true);
    await owner(
      "iam.updateUserStatus",
      { userId: fixture.disabledUserId, status: "active" },
      true
    );
    await grant("viewer");
    await viewer("auth.login", memberLogin, true);
    const recipientName = "授权接收人_" + tag;
    fixture.pendingPeople.push({
      username: recipientLogin.username,
      name: recipientName,
      role: "user",
    });
    remember();
    const createdRecipient = await owner(
      "iam.createUser",
      { ...recipientLogin, name: recipientName, role: "user" },
      true
    );
    fixture.recipientUserId = createdRecipient.userId;
    fixture.people.push({
      id: createdRecipient.userId,
      username: recipientLogin.username,
    });
    remember();
    await recipient("auth.login", recipientLogin, true);
    fixture.authorizationUnits = [];
    remember();
    for (const kind of ["source", "target"]) {
      const code = (
          "PA_" +
          kind.toUpperCase() +
          "_" +
          tag.slice(9)
        ).toUpperCase(),
        name = (kind === "source" ? "管理来源部门_" : "待授权部门_") + tag;
      const created = await owner(
        "config.createOrganizationUnit",
        { code, name },
        true
      );
      fixture.authorizationUnits.push({ id: created.id, code, name });
      fixture[kind + "UnitId"] = created.id;
      remember();
    }
    await owner(
      "config.assignOrganizationMember",
      {
        unitId: fixture.sourceUnitId,
        userId: fixture.disabledUserId,
        isPrimary: false,
      },
      true
    );
    await owner(
      "project.grantUnit",
      {
        projectId: fixture.projectId,
        unitId: fixture.sourceUnitId,
        role: "owner",
      },
      true
    );
    environment = await sql("environment");
    assert(
      has(
        await viewer("project.access", { projectId: fixture.projectId }),
        "project:manage"
      )
    );
    if (process.env.FLOW_UI_PROJECT_AUTHORIZATION_UI_ONLY !== "1")
      await verifyBackend(reproduction);
    else
      report({
        stage: "project-authorization-focused-ui",
        backendScenariosSkipped: true,
      });
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
    await signIn(page, memberLogin);
    await verifyUi(page, reproduction);
  } catch (error) {
    failed = true;
    console.error(
      [login.password, memberLogin.password, recipientLogin.password].reduce(
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
      if (fixture.authorizationUnits?.length === 2)
        try {
          report(await sql("restore_audit"));
          if (environment)
            assert.deepEqual(await sql("environment"), environment);
        } catch (error) {
          failed = true;
          console.error(error.message);
        }
      try {
        await cleanupUnits();
      } catch (error) {
        failed = true;
        console.error("Unit cleanup: " + error.message);
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
