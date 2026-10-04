import { expect, it } from "vitest";
import { roleExpiryInput } from "../shared/role-expiry";
it("留空长期有效，合法小时数明确生成到期时间", () => {
  expect(roleExpiryInput(" ")).toEqual({});
  expect(roleExpiryInput("1", 0).expiresAt?.getTime()).toBe(3_600_000);
  expect(roleExpiryInput("24", 0).expiresAt?.getTime()).toBe(86_400_000);
});
it("零、负数、小数、非数字和超大范围不能变成长期授权", () => {
  for (const value of [
    "0",
    "-1",
    "0.5",
    "1.5",
    "NaN",
    "Infinity",
    "abc",
    "99999999999999",
  ]) {
    const result = roleExpiryInput(value);
    expect(result.error, value).toBeTruthy();
    expect(result.expiresAt, value).toBeUndefined();
  }
});
