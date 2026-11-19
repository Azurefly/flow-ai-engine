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
