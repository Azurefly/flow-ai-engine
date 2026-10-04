import { expect, it } from "vitest";
import {
  roleExpiryInput,
  assertRoleExpiryRange,
  maxRoleExpiryTime,
} from "../shared/role-expiry";
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

it("限制临时授权日期在数据库可存储范围内，边界不改变长期授权", () => {
  expect(
    roleExpiryInput("1", maxRoleExpiryTime - 3_600_000).expiresAt?.getTime()
  ).toBe(maxRoleExpiryTime);
  expect(
    roleExpiryInput("2", maxRoleExpiryTime - 3_600_000).error
  ).toBeTruthy();
  expect(() =>
    assertRoleExpiryRange(new Date(maxRoleExpiryTime))
  ).not.toThrow();
  expect(() =>
    assertRoleExpiryRange(new Date(maxRoleExpiryTime + 1000))
  ).toThrow("有效期");
  expect(() => assertRoleExpiryRange(new Date("invalid"))).toThrow("有效期");
  expect(() => assertRoleExpiryRange(null)).not.toThrow();
  expect(() => assertRoleExpiryRange()).not.toThrow();
});
