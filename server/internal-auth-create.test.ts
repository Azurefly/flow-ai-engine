import { beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getSharedPool: () => ({ query }) }));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: vi.fn() }));
import { createUser } from "./internal-auth";

const input = {
  username: "New.User",
  password: "Test9_fixture_password",
  name: "测试账号",
};
beforeEach(() => query.mockReset());

describe("账号创建错误反馈", () => {
  it.each(["users_username_unique", "users_openId_unique"])(
    "将 %s 冲突转为可操作的中文提示",
    async index => {
      query.mockRejectedValueOnce({
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: `Duplicate entry for key '${index}'`,
      });
      await expect(createUser(input)).rejects.toThrow(
        "用户名已存在，请更换用户名。"
      );
      expect(query).toHaveBeenCalledTimes(1);
    }
  );
  it("没有错误 code 时仍识别明确的 MySQL 1062 用户名冲突", async () => {
    query.mockRejectedValueOnce({
      errno: 1062,
      message: "Duplicate entry for key 'users.users_username_unique'",
    });
    await expect(createUser(input)).rejects.toThrow("用户名已存在");
  });
  it.each([
    { code: "ER_DUP_ENTRY", message: "Duplicate entry for key 'PRIMARY'" },
    { code: "ER_ACCESS_DENIED_ERROR", message: "Access denied" },
    { code: "ER_DUP_ENTRY" },
  ])("不把其他数据库故障误报为用户名重复", async failure => {
    query.mockRejectedValueOnce(failure);
    await expect(createUser(input)).rejects.toBe(failure);
  });
  it("新账号仍规范化用户名、保存哈希并返回数据库创建结果", async () => {
    query.mockResolvedValueOnce([{ insertId: 42 }, []]);
    expect(await createUser(input)).toBe(42);
    const [, values] = query.mock.calls[0];
    expect(values.slice(0, 2)).toEqual(["internal:new.user", "new.user"]);
    expect(values[2]).not.toBe(input.password);
    expect(values[2]).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
  });
});
