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

function remote(intent, attempt = 0) {
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
    child.on("close", code => {
      if (
        code === 255 &&
        attempt < 2 &&
        ["settings_fingerprint", "revoke_identity", "cleanup"].includes(
          intent.action
        )
      ) {
        setTimeout(
          () => remote(intent, attempt + 1).then(resolve, reject),
          500 * (attempt + 1)
        );
      } else if (code === 0) resolve(stdout);
      else reject(new Error(`Fixture operation failed (${code}): ${stderr}`));
    });
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
  manager = session(),
  viewer = session();
const recipientLogin = credentials("_recipient");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const remember = () =>
  fs.writeFileSync(
    path.join(directory, "fixture.json"),
    JSON.stringify(fixture),
    "utf8"
  );
const sqlHelper = fs.readFileSync(
  path.join(__dirname, "organization-write-fixtures.mjs"),
  "utf8"
);
function sqlProcess(action, extra = {}) {
  const code =
    "const organizationWriteIntent=" +
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
    release: async (signal = "release") => {
      if (!child.stdin.destroyed) child.stdin.end(signal + "\n");
      return done;
    },
  };
}
function rootFixtureStatement(statement) {
  assert(/^(CREATE|DROP) TRIGGER org_write_[a-f0-9]{12}\b/.test(statement));
  assert(statement.includes("org_write_" + fixture.tag.slice(9)));
  if (statement.startsWith("CREATE"))
    assert(
      statement.includes(String(fixture.userId)) &&
        statement.includes(String(fixture.disabledUserId)) &&
        statement.includes("isolated_organization_audit_rejected")
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

async function poll(read, accept, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const value = await read();
    if (accept(value)) return value;
    await sleep(300);
  } while (Date.now() < end);
  throw new Error("Fixture wait timed out");
}
const prefix = "ORG_" + tag.slice(9).toUpperCase() + "_";
const baseline = process.env.FLOW_UI_ORGANIZATION_FORM_BASELINE === "1";
let a, b, browser, page, fingerprint;
const api = (name, input) => owner("config." + name, input, true);
const unitName = suffix => "组织事务_" + tag + "_" + suffix;
const personLogin = credentials("_person");
let errors = [];
async function loginPage(credentials) {
  await page.goto(base + "#/flows", { waitUntil: "domcontentloaded" });
  await page.getByLabel("用户名", { exact: true }).fill(credentials.username);
  await page.getByLabel("密码", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "登录流程引擎", exact: true }).click();
  await expect(page.locator("[data-aiflow-business-center]")).toBeVisible({
    timeout: 20000,
  });
  await page.goto(base + "#/system/organization");
  await expect(page.locator("[data-aiflow-organization-page]")).toBeVisible();
}
const dialog = () =>
  page.getByRole("dialog", { name: "编辑部门", exact: true });
async function selectUnit(id = a) {
  await page
    .getByRole("textbox", { name: "搜索组织机构" })
    .fill(id === a ? prefix + "A" : prefix + "B");
  await page
    .getByRole("button", { name: unitName(id === a ? "A" : "B"), exact: true })
    .click();
}
async function edit(id = a) {
  await selectUnit(id);
  await page.getByRole("button", { name: "编辑部门", exact: true }).click();
  await expect(dialog()).toBeVisible();
}
async function closeDirty() {
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "放弃填写并关闭", exact: true })
    .click();
}
async function draftAndSlowRead() {
  await edit();
  await dialog()
    .getByLabel("部门说明")
    .fill("保留草稿_" + tag);
  await page.keyboard.press("Escape");
  if (baseline) {
    await expect(dialog()).toBeHidden();
    await edit();
    await expect(dialog().getByLabel("部门说明")).not.toHaveValue(
      "保留草稿_" + tag
    );
    report({ baseline: true, escapeLostDraft: true });
  } else {
    const confirm = page.getByRole("alertdialog", { name: "保留当前填写？" });
    await expect(confirm).toBeVisible();
    await confirm
      .getByRole("button", { name: "继续填写", exact: true })
      .click();
    await expect(dialog().getByLabel("部门说明")).toHaveValue(
      "保留草稿_" + tag
    );
    await expect(dialog().getByLabel("部门说明")).toBeFocused();
    const download = page.waitForEvent("download");
    await dialog()
      .getByRole("button", { name: "导出填写", exact: true })
      .click();
    await (await download).saveAs(path.join(directory, "unit-draft.json"));
  }
  await dialog()
    .getByLabel("部门说明")
    .fill("保存确认_" + tag);
  let release, heldResolve;
  const gate = new Promise(resolve => (release = resolve)),
    held = new Promise(resolve => (heldResolve = resolve));
  const route = "**/api/trpc/**";
  let hold = false;
  const handler = async request => {
    const req = request.request();
    if (
      hold &&
      req.method() === "GET" &&
      req.url().includes("config.organizationDirectory")
    ) {
      heldResolve();
      await gate;
    }
    await request.continue().catch(error => {
      if (
        !/already handled|Target.*closed|Invalid InterceptionId/i.test(
          error.message
        )
      )
        errors.push(error.message);
    });
  };
  await page.route(route, handler);
  try {
    hold = true;
    const saved = page.waitForResponse(
      response =>
        response.url().includes("config.updateOrganizationUnit") &&
        response.request().method() === "POST"
    );
    await dialog()
      .getByRole("button", { name: "保存部门", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await held;
    if (baseline) {
      await expect(dialog()).toBeVisible();
      await dialog()
        .getByLabel("部门说明")
        .fill("被旧刷新覆盖_" + tag);
      release();
      await expect(dialog()).toBeHidden();
      report({
        baseline: true,
        ackHeldWindow: true,
        lateRefreshClearedNewInput: true,
      });
    } else {
      await expect(dialog()).toBeHidden({ timeout: 2500 });
      await edit();
      await dialog()
        .getByLabel("部门说明")
        .fill("下一轮输入_" + tag);
      release();
      await expect(dialog().getByLabel("部门说明")).toHaveValue(
        "下一轮输入_" + tag
      );
      await dialog()
        .getByRole("button", { name: "重新读取组织与权限", exact: true })
        .click();
      await expect(
        dialog().getByText(
          "部门配置已变化，请核对后继续。本次填写不会被自动覆盖。"
        )
      ).toBeVisible();
      await dialog()
        .getByRole("button", {
          name: "合并最新配置并保留本次修改",
          exact: true,
        })
        .click();
      await expect(dialog().getByLabel("部门说明")).toHaveValue(
        "下一轮输入_" + tag
      );
      await closeDirty();
      report({
        draftClosePreserved: true,
        localExport: true,
        ackReleasedBeforeRead: true,
        lateReadKeptInput: true,
      });
    }
  } finally {
    release();
    await page.unroute(route, handler);
  }
}
async function configurationAndBusy() {
  await edit();
  await dialog()
    .getByLabel("部门名称", { exact: true })
    .fill(unitName("A") + "_本次修改");
  const latest = (await owner("config.organizationDirectory", {})).units.find(
    row => row.id === a
  );
  await api("updateOrganizationUnit", {
    id: a,
    description: "其他管理员说明_" + tag,
    expectedConfigToken: latest.configToken,
  });
  await dialog()
    .getByRole("button", { name: "重新读取组织与权限", exact: true })
    .click();
  await expect(
    dialog().getByText("部门配置已变化，请核对后继续。本次填写不会被自动覆盖。")
  ).toBeVisible();
  await dialog()
    .getByRole("button", { name: "合并最新配置并保留本次修改", exact: true })
    .click();
  await expect(dialog().getByLabel("部门名称", { exact: true })).toHaveValue(
    unitName("A") + "_本次修改"
  );
  await expect(dialog().getByLabel("部门说明")).toHaveValue(
    "其他管理员说明_" + tag
  );
  let release, seenResolve;
  const gate = new Promise(resolve => (release = resolve)),
    seen = new Promise(resolve => (seenResolve = resolve));
  let posts = 0;
  const route = "**/api/trpc/**";
  const handler = async request => {
    if (
      request.request().method() === "POST" &&
      request.request().url().includes("config.updateOrganizationUnit")
    ) {
      posts++;
      seenResolve();
      await gate;
    }
    await request.continue().catch(error => {
      if (
        !/already handled|Target.*closed|Invalid InterceptionId/i.test(
          error.message
        )
      )
        errors.push(error.message);
    });
  };
  await page.route(route, handler);
  try {
    await dialog()
      .getByRole("button", { name: "保存部门", exact: true })
      .click();
    await seen;
    await expect(
      dialog().getByLabel("部门名称", { exact: true })
    ).toBeDisabled();
    await expect(
      dialog().getByRole("button", { name: "取消", exact: true })
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog()).toBeVisible();
    assert.equal(posts, 1);
    release();
    await expect(dialog()).toBeHidden();
  } finally {
    release();
    await page.unroute(route, handler);
  }
  const own = (await owner("config.organizationDirectory", {})).units.find(
    row => row.id === a
  );
  assert.equal(own.name, unitName("A") + "_本次修改");
  assert.equal(own.description, "其他管理员说明_" + tag);
  // Restore its label before using the shared selector again.
  await api("updateOrganizationUnit", {
    id: a,
    name: unitName("A"),
    expectedConfigToken: own.configToken,
  });
  await page.reload();
  await expect(page.locator("[data-aiflow-organization-page]")).toBeVisible();
  report({
    unitConflictMergedWithoutLoss: true,
    postBusyLocked: true,
    onePost: true,
    fixedTarget: a,
  });
}
async function newUserRecovery() {
  await selectUnit();
  await page.getByRole("tab", { name: /^成员与岗位/ }).click();
  await page.getByRole("button", { name: "新建内部用户", exact: true }).click();
  const form = page.getByRole("dialog", {
    name: "新建内部用户并加入部门",
    exact: true,
  });
  await expect(form).toBeVisible();
  fixture.pendingPeople.push({
    username: personLogin.username,
    name: "组织新用户_" + tag,
    role: "user",
  });
  remember();
  await form.getByLabel("登录名", { exact: true }).fill(personLogin.username);
  await form.getByLabel("姓名", { exact: true }).fill("组织新用户_" + tag);
  await form.getByLabel("初始密码", { exact: true }).fill(personLogin.password);
  await form
    .getByLabel("岗位/职务（可选）", { exact: true })
    .fill("保留岗位_" + tag);
  try {
    await sql("fail_audit");
    await form
      .getByRole("button", { name: "创建并加入部门", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "暂时无法确认组织保存结果"
    );
  } finally {
    await sql("restore_audit");
  }
  await expect(
    form.getByText("账号已创建，账号信息不可修改；本次仅重试加入部门。")
  ).toBeVisible();
  await expect(form.getByLabel("登录名", { exact: true })).toBeDisabled();
  await expect(form.getByLabel("初始密码", { exact: true })).toHaveValue("");
  const person = (
    await owner("iam.userDirectory", {
      search: personLogin.username,
      offset: 0,
      limit: 10,
    })
  ).items.find(row => row.username === personLogin.username);
  assert(person);
  fixture.people.push({ id: person.id, username: personLogin.username });
  remember();
  await remote({ action: "revoke_identity", fixture });
  await form
    .getByRole("button", { name: "重新读取组织与权限", exact: true })
    .click();
  await expect(page.locator("[data-resource-draft-recovery]")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出未保存填写", exact: true })
    .click();
  const file = path.join(directory, "partial-user-draft.json");
  await (await download).saveAs(file);
  assert(!fs.readFileSync(file, "utf8").includes(personLogin.password));
  await owner(
    "iam.assignSystemRole",
    { userId: fixture.disabledUserId, roleCode: fixture.identityRoleCode },
    true
  );
  await page
    .getByRole("button", { name: "重新读取当前权限", exact: true })
    .click();
  await expect(form).toBeVisible();
  await expect(form.getByLabel("登录名", { exact: true })).toHaveValue(
    personLogin.username
  );
  await expect(form.getByLabel("登录名", { exact: true })).toBeDisabled();
  await expect(
    form.getByLabel("岗位/职务（可选）", { exact: true })
  ).toHaveValue("保留岗位_" + tag);
  await form.getByRole("button", { name: "重试加入部门", exact: true }).click();
  await expect(form).toBeHidden();
  const members = await owner("config.organizationMembersPage", {
    unitId: a,
    includeDescendants: false,
    search: personLogin.username,
    page: 1,
    pageSize: 10,
  });
  assert.equal(members.items.length, 1);
  assert.equal(members.items[0].userId, person.id);
  assert.equal(members.items[0].title, "保留岗位_" + tag);
  report({
    partialAccountKeptAcrossPermissionLoss: true,
    passwordNotExported: true,
    restoredJoinWithoutDuplicate: true,
  });
}
async function apiSnapshots() {
  const directory = await owner("config.organizationDirectory", {}),
    unit = directory.units.find(row => row.id === a);
  assert.match(unit.configToken, /^[a-f0-9]{64}$/);
  await api("updateOrganizationUnit", {
    id: a,
    description: "CAS_" + tag,
    expectedConfigToken: unit.configToken,
  });
  await assert.rejects(
    api("updateOrganizationUnit", {
      id: a,
      name: "不应覆盖_" + tag,
      expectedConfigToken: unit.configToken,
    }),
    error => error.status === 409
  );
  let current = (await owner("config.organizationDirectory", {})).units.find(
    row => row.id === a
  );
  assert.equal(current.name, unitName("A"));
  assert.equal(current.description, "CAS_" + tag);
  await api("updateOrganizationUnit", {
    id: a,
    description: null,
    expectedConfigToken: current.configToken,
  });
  let memberships = await owner("config.organizationMemberConfiguration", {
    userId: fixture.userId,
  });
  await api("assignOrganizationMember", {
    unitId: a,
    userId: fixture.userId,
    isPrimary: true,
    onlyIfAbsent: true,
    expectedMembershipToken: memberships.membershipToken,
  });
  const stale = await owner("config.organizationMemberConfiguration", {
    userId: fixture.userId,
  });
  await api("assignOrganizationMember", {
    unitId: b,
    userId: fixture.userId,
    isPrimary: false,
    onlyIfAbsent: true,
    expectedMembershipToken: stale.membershipToken,
  });
  memberships = await owner("config.organizationMemberConfiguration", {
    userId: fixture.userId,
  });
  await assert.rejects(
    api("removeOrganizationMember", {
      unitId: a,
      userId: fixture.userId,
      expectedMembershipToken: stale.membershipToken,
    }),
    error => error.status === 409
  );
  assert.equal(
    (
      await owner("config.organizationMemberConfiguration", {
        userId: fixture.userId,
      })
    ).membershipToken,
    memberships.membershipToken
  );
  const page = await owner("config.organizationMembersPage", {
    unitId: a,
    includeDescendants: false,
    search: login.username,
    page: 1,
    pageSize: 10,
  });
  assert.equal(page.items[0].membershipToken, memberships.membershipToken);
  for (const unitId of [a, b]) {
    const snapshot = await owner("config.organizationMemberConfiguration", {
      userId: fixture.userId,
    });
    await api("removeOrganizationMember", {
      unitId,
      userId: fixture.userId,
      expectedMembershipToken: snapshot.membershipToken,
    });
  }
  fixture.formRoleCode = "custom_org_form_" + tag.slice(9);
  remember();
  await owner(
    "iam.createCustomRole",
    {
      code: fixture.formRoleCode,
      name: "组织表单角色_" + tag,
      scope: "system",
      permissions: ["workflow:create"],
    },
    true
  );
  let role = await owner("iam.customRoleConfiguration", {
    code: fixture.formRoleCode,
  });
  fixture.formRoleId = Number(role.id);
  remember();
  await owner(
    "iam.updateCustomRole",
    {
      code: fixture.formRoleCode,
      description: "新角色配置_" + tag,
      expectedConfigToken: role.configToken,
    },
    true
  );
  await assert.rejects(
    api("bindOrganizationRole", {
      unitId: b,
      roleId: fixture.formRoleId,
      onlyIfAbsent: true,
      expectedRoleConfigToken: role.configToken,
    }),
    error => error.status === 409
  );
  role = await owner("iam.customRoleConfiguration", {
    code: fixture.formRoleCode,
  });
  await api("bindOrganizationRole", {
    unitId: b,
    roleId: fixture.formRoleId,
    onlyIfAbsent: true,
    expectedRoleConfigToken: role.configToken,
  });
  const binding = (
    await owner("config.organizationDirectory", {})
  ).roleBindings.find(
    row => row.unitId === b && Number(row.roleId) === fixture.formRoleId
  );
  assert.match(binding.configToken, /^[a-f0-9]{64}$/);
  await api("bindOrganizationRole", {
    unitId: b,
    roleId: fixture.formRoleId,
    includeDescendants: false,
  });
  await assert.rejects(
    api("unbindOrganizationRole", {
      unitId: b,
      roleId: fixture.formRoleId,
      expectedConfigToken: binding.configToken,
    }),
    error => error.status === 409
  );
  const latest = (
    await owner("config.organizationDirectory", {})
  ).roleBindings.find(
    row => row.unitId === b && Number(row.roleId) === fixture.formRoleId
  );
  await api("unbindOrganizationRole", {
    unitId: b,
    roleId: fixture.formRoleId,
    expectedConfigToken: latest.configToken,
  });
  report({
    actualConfigConflicts: true,
    wholeMembershipSnapshot: true,
    pageTokenMatchesWholeSet: true,
    roleDefinitionAndBindingConflicts: true,
  });
}
async function memberEditingAndMerge() {
  await selectUnit();
  await page.getByRole("tab", { name: /^成员与岗位/ }).click();
  const person = fixture.people.find(
    row => row.username === personLogin.username
  );
  const more = page.getByLabel(/^更多成员操作：/).filter({ visible: true });
  let item = page.getByRole("button", { name: /^编辑岗位：/ });
  if (!(await item.isVisible())) await more.click();
  await item.click();
  const form = page.getByRole("dialog", { name: "编辑成员岗位", exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel("岗位/职务", { exact: true }).fill("修改岗位_" + tag);
  await form.getByRole("button", { name: "保存成员", exact: true }).click();
  await expect(form).toBeHidden();
  let snapshot = await owner("config.organizationMemberConfiguration", {
    userId: person.id,
  });
  assert.equal(
    snapshot.memberships.find(row => row.unitId === a).title,
    "修改岗位_" + tag
  );
  await api("assignOrganizationMember", {
    unitId: b,
    userId: person.id,
    title: "已有岗位_" + tag,
    isPrimary: false,
    onlyIfAbsent: true,
    expectedMembershipToken: snapshot.membershipToken,
  });
  item = page.getByRole("button", { name: /^迁移成员：/ });
  if (!(await item.isVisible())) await more.click();
  await item.click();
  const moving = page.getByRole("dialog", { name: "迁移成员", exact: true });
  await expect(moving).toBeVisible();
  await moving.getByLabel("目标部门", { exact: true }).selectOption(b);
  await expect(moving.getByText(/该成员已在目标部门任职/)).toBeVisible();
  await expect(
    moving.getByRole("button", { name: "确认迁移", exact: true })
  ).toBeDisabled();
  snapshot = await owner("config.organizationMemberConfiguration", {
    userId: person.id,
  });
  await api("assignOrganizationMember", {
    unitId: a,
    userId: person.id,
    title: "其他管理员岗位_" + tag,
    isPrimary: true,
    expectedMembershipToken: snapshot.membershipToken,
  });
  const confirm = moving.getByRole("button", {
    name: "确认使用当前成员归属",
    exact: true,
  });
  let releaseMemberRead, heldMemberRead;
  const memberReadGate = new Promise(resolve => (releaseMemberRead = resolve));
  const memberReadHeld = new Promise(resolve => (heldMemberRead = resolve));
  const memberRoute = "**/api/trpc/**";
  const memberHandler = async route => {
    if (route.request().method() === "GET" &&
        route.request().url().includes("config.organizationMemberConfiguration")) {
      heldMemberRead();
      await memberReadGate;
    }
    await route.continue().catch(error => {
      if (!/already handled|Target.*closed|Invalid InterceptionId/i.test(error.message))
        errors.push(error.message);
    });
  };
  await page.route(memberRoute, memberHandler);
  try {
    await moving.getByRole("button", { name: "重新读取组织与权限", exact: true }).click();
    await memberReadHeld;
    // Cached conflict controls must not confirm an old snapshot during the read.
    if (await confirm.isVisible()) await expect(confirm).toBeDisabled();
    await expect(moving.getByRole("button", { name: "确认迁移", exact: true })).toBeDisabled();
    releaseMemberRead();
    await expect(moving.getByText(new RegExp("其他管理员岗位_" + tag))).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();
  } finally {
    releaseMemberRead();
    await page.unroute(memberRoute, memberHandler);
  }
  await expect(
    moving.getByLabel("迁移后岗位/职务", { exact: true })
  ).toHaveValue("其他管理员岗位_" + tag);
  await moving
    .getByLabel("迁移后岗位/职务", { exact: true })
    .fill("迁移填写_" + tag);
  await moving
    .getByLabel("已核对，允许合并到现有部门关系", { exact: true })
    .check();
  await moving.getByRole("button", { name: "确认迁移", exact: true }).click();
  await expect(moving).toBeHidden();
  snapshot = await owner("config.organizationMemberConfiguration", {
    userId: person.id,
  });
  assert.equal(snapshot.memberships.length, 1);
  assert.equal(snapshot.memberships[0].unitId, b);
  assert.equal(snapshot.memberships[0].title, "迁移填写_" + tag);
  assert.equal(Boolean(snapshot.memberships[0].isPrimary), true);
  report({
    editPositionWithoutRemoval: true,
    mergeRequiresConfirmation: true,
    moveKeptPositionAndPrimary: true,
  });
}
async function rolesAndMobile() {
  await selectUnit(b);
  await page.getByRole("tab", { name: /^权限组/ }).click();
  await page.getByRole("button", { name: "绑定权限组", exact: true }).click();
  const form = page.getByRole("dialog", {
    name: "绑定部门权限组",
    exact: true,
  });
  await expect(form).toBeVisible();
  await form
    .getByLabel("权限组", { exact: true })
    .selectOption(String(fixture.formRoleId));
  const future = new Date(Date.now() + 86400000);
  const local = new Date(future.getTime() - future.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await form.getByLabel("到期时间（可选）", { exact: true }).fill(local);
  let role = await owner("iam.customRoleConfiguration", {
    code: fixture.formRoleCode,
  });
  await owner(
    "iam.updateCustomRole",
    {
      code: fixture.formRoleCode,
      description: "界面变化_" + tag,
      expectedConfigToken: role.configToken,
    },
    true
  );
  await form
    .getByRole("button", { name: "重新读取组织与权限", exact: true })
    .click();
  await expect(
    form.getByText("角色配置已变化，请重新核对上方权限。")
  ).toBeVisible();
  await expect(
    form.getByLabel("到期时间（可选）", { exact: true })
  ).toHaveValue(local);
  await form
    .getByRole("button", { name: "确认使用当前权限", exact: true })
    .click();
  await form.getByRole("button", { name: "确认绑定", exact: true }).click();
  await expect(form).toBeHidden();
  await viewer("auth.login", personLogin, true);
  const flow = await viewer(
    "workflow.create",
    { name: "组织表单权限实际使用_" + tag },
    true
  );
  fixture.formFlowId = flow.id;
  remember();
  const row = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "更多操作" }) })
    .filter({ has: page.getByText(fixture.formRoleCode, { exact: true }) });
  // The role card owns its own action summary.
  const summary = page.getByLabel("权限组 组织表单角色_" + tag + " 的操作", {
    exact: true,
  });
  await summary.click();
  await page.getByRole("button", { name: "解绑权限组…", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "确认解绑权限组",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  try {
    await sql("fail_audit");
    await confirmation
      .getByRole("button", { name: "确认解绑", exact: true })
      .click();
    await expect(confirmation.getByRole("alert")).toContainText(
      "暂时无法确认组织保存结果"
    );
  } finally {
    await sql("restore_audit");
  }
  await confirmation
    .getByRole("button", { name: "确认解绑", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await assert.rejects(
    viewer("workflow.create", { name: "组织表单失权拒绝_" + tag }, true),
    error => error.status === 403
  );
  await selectUnit();
  await page.getByRole("tab", { name: "部门概览", exact: true }).click();
  await edit();
  await dialog()
    .getByLabel("部门说明")
    .fill("手机失败保留_" + tag);
  try {
    await sql("fail_audit");
    await dialog()
      .getByRole("button", { name: "保存部门", exact: true })
      .click();
    await expect(dialog().getByRole("alert")).toContainText(
      "暂时无法确认组织保存结果"
    );
  } finally {
    await sql("restore_audit");
  }
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [1024, 1000],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        dialog().evaluate(el => {
          const r = el.getBoundingClientRect();
          return (
            r.y >= 0 &&
            r.bottom <= innerHeight &&
            Math.abs(
              parseFloat(getComputedStyle(el).maxHeight) - (innerHeight - 16)
            ) < 1
          );
        })
      )
      .toBe(true);
    for (const label of ["取消", "保存部门"])
      await expect
        .poll(() =>
          dialog()
            .getByRole("button", { name: label, exact: true })
            .evaluate(button => {
              const r = button.getBoundingClientRect();
              return button.contains(
                document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
              );
            })
        )
        .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(directory, "organization-form-" + width + ".png"),
    });
  }
  await dialog()
    .getByRole("button", { name: "取消", exact: true })
    .click({ timeout: 1500 });
  await page
    .getByRole("button", { name: "放弃填写并关闭", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  report({
    rolePreviewAndConflict: true,
    bindingEffective: true,
    revokeEffective: true,
    revokeFailureKeptDialog: true,
    mobileActionsNotCovered: true,
    viewports: [320, 390, 1024, 1920],
  });
}

(async () => {
  try {
    await remote({
      action: "setup",
      tag,
      login,
      disabledPassword: memberLogin.password,
    });
    await remote({ action: "grant_identity", fixture });
    await owner("auth.login", login, true);
    fingerprint = (await remote({ action: "settings_fingerprint" })).trim();
    for (const suffix of ["A", "B"]) {
      const id = (
        await api("createOrganizationUnit", {
          code: prefix + suffix,
          name: unitName(suffix),
        })
      ).id;
      if (suffix === "A") a = id;
      else b = id;
    }
    if (!baseline) await apiSnapshots();
    browser = await chromium.launch({
      headless: true,
      executablePath: executable(),
      args: ["--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    await context.route("**/*", route =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", error => {
      errors.push(error.message);
      report({ browserError: error.message });
    });
    await loginPage(memberLogin);
    await draftAndSlowRead();
    if (!baseline) {
      await configurationAndBusy();
      await newUserRecovery();
      await memberEditingAndMerge();
      await rolesAndMobile();
      assert.deepEqual(errors, []);
    }
    report({ organizationForms: true, baseline, passed: true, tag });
  } catch (error) {
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: path.join(directory, "organization-form-failure.png"),
        })
        .catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (fixture) {
      await sql("restore_audit");
      if (fixture.formFlowId) {
        const flow = await owner("workflow.get", { id: fixture.formFlowId });
        assert.equal(flow.name, "组织表单权限实际使用_" + tag);
        assert(fixture.people.some(person => person.id === flow.ownerUserId));
        if (!flow.archivedAt)
          await owner("workflow.delete", { id: flow.id }, true);
      }
      const tree = await owner("config.organization", {});
      const own = tree.units.filter(row => row.code.startsWith(prefix));
      assert(own.every(row => row.name.includes(tag)));
      const ids = new Set(own.map(row => row.id));
      for (const row of tree.roleBindings.filter(row => ids.has(row.unitId))) {
        assert.equal(Number(row.roleId), fixture.formRoleId);
        await api("unbindOrganizationRole", {
          unitId: row.unitId,
          roleId: Number(row.roleId),
        });
      }
      for (const row of tree.members.filter(row => ids.has(row.unitId))) {
        assert(
          fixture.people.some(
            person => Number(person.id) === Number(row.userId)
          )
        );
        await api("removeOrganizationMember", {
          unitId: row.unitId,
          userId: Number(row.userId),
        });
      }
      for (const row of own) {
        if (row.parentUnitId)
          await api("updateOrganizationUnit", {
            id: row.id,
            parentUnitId: null,
          });
        await api("deleteOrganizationUnit", { id: row.id });
      }
      if (fixture.formRoleCode) {
        const role = await owner("iam.customRoleConfiguration", {
          code: fixture.formRoleCode,
        });
        await owner(
          "iam.deleteCustomRole",
          { code: fixture.formRoleCode, expectedConfigToken: role.configToken },
          true
        );
      }
      if (fingerprint)
        assert.equal(
          (await remote({ action: "settings_fingerprint" })).trim(),
          fingerprint
        );
      report({
        ownUnitsRemoved: own.length,
        output: (await remote({ action: "cleanup", fixture, login })).trim(),
      });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
