import { beforeEach, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
const permission = vi.hoisted(() => vi.fn());
vi.mock("./iam-service", () => ({ hasSystemPermission: permission }));
import { publicAuthAccount } from "./auth-account";
const user = {
  id: 41,
  openId: "internal:fixture",
  username: "fixture",
  name: "测试用户",
  email: null,
  role: "user",
  status: "active",
  loginMethod: "internal",
  tokenVersion: 7,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
  passwordHash: "fixture-hash",
  token: "fixture-token",
  futureSecret: "fixture-secret",
} as User;
beforeEach(() => {
  permission.mockReset();
  permission.mockResolvedValue(false);
});
it("账号公开投影不返回哈希、令牌版本或未知敏感字段", async () => {
  const account = await publicAuthAccount(user);
  expect(account).toMatchObject({
    id: user.id,
    username: user.username,
    role: "user",
    canManageIdentity: false,
  });
  for (const key of ["passwordHash", "tokenVersion", "token", "futureSecret"])
    expect(account).not.toHaveProperty(key);
});
it("身份管理能力取实际服务端权限，普通账号可通过有效授权获得入口", async () => {
  permission.mockResolvedValue(true);
  expect((await publicAuthAccount(user))?.canManageIdentity).toBe(true);
  expect(permission).toHaveBeenCalledWith(user, "iam:manage");
});
it("匿名和停用账号不返回资料或查询权限", async () => {
  expect(await publicAuthAccount(null)).toBeNull();
  expect(
    await publicAuthAccount({ ...user, status: "disabled", role: "admin" })
  ).toBeNull();
  expect(permission).not.toHaveBeenCalled();
});
