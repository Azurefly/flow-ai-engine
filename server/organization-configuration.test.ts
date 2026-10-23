import { expect, it } from "vitest";
import {
  organizationUnitToken,
  organizationMembershipToken,
  organizationBindingToken,
  assertOrganizationToken,
  organizationMembershipTokens,
} from "./organization-configuration";
const unit = {
  id: "a",
  code: "AA",
  name: "部门",
  status: "active",
  parentUnitId: null,
  managerUserId: 1,
  sortOrder: 0,
};
it("单位快照覆盖可编辑配置，忽略目录派生统计与展示字段", () => {
  const token = organizationUnitToken(unit);
  expect(
    organizationUnitToken({ ...unit, managerName: "新姓名", memberCount: 8 })
  ).toBe(token);
  for (const change of [
    { id: "b" },
    { name: "新部门" },
    { parentUnitId: "b" },
    { managerUserId: 2 },
    { status: "disabled" },
    { description: "新说明" },
    { sortOrder: 1 },
  ])
    expect(organizationUnitToken({ ...unit, ...change })).not.toBe(token);
});
it("成员快照覆盖所有归属而非仅当前页，排序不影响结果", () => {
  const rows = [
    { id: "a", unitId: "A", userId: 1, title: "岗位", isPrimary: 1 },
    { id: "b", unitId: "B", userId: 1, title: null, isPrimary: 0 },
  ];
  const token = organizationMembershipToken(1, rows);
  expect(organizationMembershipToken(1, [...rows].reverse())).toBe(token);
  expect(organizationMembershipToken(1, [rows[0]])).not.toBe(token);
  expect(
    organizationMembershipToken(1, [rows[0], { ...rows[1], isPrimary: 1 }])
  ).not.toBe(token);
  expect(organizationMembershipToken(2, rows)).not.toBe(token);
  expect(organizationMembershipTokens(rows).get(1)).toBe(token);
});
it("空归属也有有效快照，不同账号之间不能复用", () => {
  expect(organizationMembershipToken(1, [])).toMatch(/^[a-f0-9]{64}$/);
  expect(organizationMembershipToken(1, [])).not.toBe(
    organizationMembershipToken(2, [])
  );
});
it("绑定快照识别范围、有效期、重建以及操作者变化", () => {
  const row = {
    id: "binding",
    unitId: "a",
    roleId: 2,
    includeDescendants: 1,
    effectiveFrom: new Date("2026-10-20T00:00:00Z"),
    expiresAt: null,
    createdByUserId: 1,
  };
  const token = organizationBindingToken(row);
  expect(
    organizationBindingToken({
      ...row,
      effectiveFrom: row.effectiveFrom.toISOString(),
    })
  ).toBe(token);
  for (const change of [
    { id: "new" },
    { includeDescendants: 0 },
    { expiresAt: new Date("2026-11-01T00:00:00Z") },
    { createdByUserId: 2 },
  ])
    expect(organizationBindingToken({ ...row, ...change })).not.toBe(token);
});
it("冲突返回409；旧调用方不带快照仍保持原API兼容", () => {
  expect(() =>
    assertOrganizationToken(undefined, "new", "部门配置")
  ).not.toThrow();
  expect(() =>
    assertOrganizationToken("same", "same", "部门配置")
  ).not.toThrow();
  try {
    assertOrganizationToken("old", "new", "成员归属");
    throw new Error("应发生冲突");
  } catch (error) {
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("填写已保留"),
    });
  }
});
