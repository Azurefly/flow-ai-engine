import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import target from "../scripts/acceptance-target.cjs";

const origin = "http://127.0.0.1:18000";
const configured = {
  FLOW_ACCEPTANCE_BASE_URL: origin,
  FLOW_ACCEPTANCE_CONFIRM_WRITES: origin,
  FLOW_BOOTSTRAP_ADMIN_USERNAME: "synthetic",
  FLOW_BOOTSTRAP_ADMIN_PASSWORD: "synthetic-only",
};

const mysqlTarget = { origin, host: "127.0.0.1", port: 43306, database: "flow_acceptance" };
const databaseEnv = {
  ...configured,
  DATABASE_URL: "mysql://sample:synthetic-only@127.0.0.1:43306/flow_acceptance?timezone=Z",
  FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify(mysqlTarget),
};

it("单独确认 HTTP 与 SQL 端点，支持数据库独立部署、默认端口和本机 SSH 转发端口", () => {
  expect(target.acceptanceDatabaseTarget(databaseEnv)).toBe(origin);
  expect(target.acceptanceDatabaseTarget({
    ...databaseEnv,
    DATABASE_URL: "mysql://account@db.internal/%E9%AA%8C%E6%94%B6",
    FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ origin, host: "DB.INTERNAL", port: 3306, database: "验收" }),
  })).toBe(origin);
});

it.each([
  { FLOW_ACCEPTANCE_DATABASE_TARGET: undefined },
  { DATABASE_URL: undefined },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ ...mysqlTarget, origin: "https://different.test" }) },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ ...mysqlTarget, host: "other.internal" }) },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ ...mysqlTarget, port: 3306 }) },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ ...mysqlTarget, database: "different" }) },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: JSON.stringify({ ...mysqlTarget, password: "synthetic-only" }) },
  { FLOW_ACCEPTANCE_DATABASE_TARGET: "broken-synthetic-only" },
  { DATABASE_URL: "broken-synthetic-only" },
  ...["host=other", "port=4400", "database=other", "socketPath=local", "uri=other", "stream=other", "%68ost=other"].map(option => ({
    DATABASE_URL: databaseEnv.DATABASE_URL + "&" + option,
  })),
])("MySQL 配置不匹配或可改写实际连接时拒绝，错误不带身份数据", overrides => {
  let error: unknown;
  try { target.acceptanceDatabaseTarget({ ...databaseEnv, ...overrides }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("FLOW_ACCEPTANCE_DATABASE_TARGET");
  expect((error as Error).message).not.toMatch(/synthetic-only|mysql:\/\//);
});

it.each([
  "run-ui-business-scenarios.js", "test-complex-scenarios.js",
  "test-multi-role-tiers.js", "test-state-flow-permissions.js",
])("%s 在缺失参数或目标不匹配时，启动浏览器和网络调用数均为零", file => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../01-test/014-自动化脚本/e2e", file), "utf8");
  const firstIo = vi.fn(() => { throw new Error("Unexpected I/O"); });
  for (const [override, expected] of [
    [{ FLOW_ACCEPTANCE_BASE_URL: "" }, /no default target/],
    [{ FLOW_BOOTSTRAP_ADMIN_USERNAME: "" }, /Missing existing login/],
    [{ FLOW_BOOTSTRAP_ADMIN_PASSWORD: "" }, /Missing existing login/],
    [{ FLOW_ACCEPTANCE_CONFIRM_WRITES: "" }, /exact target origin/],
    [{ FLOW_ACCEPTANCE_CONFIRM_WRITES: "http://localhost:19000" }, /exact target origin/],
  ] as const) {
    expect(() => runInNewContext(source, {
      process: { env: { ...configured, ...override } },
      fetch: firstIo,
      require: (name: string) => name === "../../../scripts/acceptance-target.cjs" ? target : firstIo(),
    }, { filename: file })).toThrow(expected);
  }
  expect(firstIo).not.toHaveBeenCalled();
});

it("多角色身份与测试来源绑定，拒绝缺失或重复身份", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flow-role-fixture-"));
  const filename = path.join(dir, "roles.json");
  const env = { FLOW_ACCEPTANCE_ROLE_USERS_FILE: filename };
  const users = Object.fromEntries(["alice","bob","fiona","leo","clark","oscar"].map((role, index) =>
    [role, { id: index + 1, username: "fixture-" + role, password: "synthetic-only" }]));
  try {
    writeFileSync(filename, JSON.stringify({ origin, users }));
    expect(target.loadRoleUsers(env, origin).alice.id).toBe("1");
    expect(() => target.loadRoleUsers(env, "https://other.test")).toThrow("confirmed acceptance origin");
    writeFileSync(filename, JSON.stringify({ origin, users: { ...users, leo: users.bob } }));
    expect(() => target.loadRoleUsers(env, origin)).toThrow("different account");
    writeFileSync(filename, JSON.stringify({ origin, users: {} }));
    expect(() => target.loadRoleUsers(env, origin)).toThrow("role alice");
  } finally {
    unlinkSync(filename);
    rmdirSync(dir);
  }
});
