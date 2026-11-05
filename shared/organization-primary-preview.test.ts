import { expect, it } from "vitest";
import { organizationPrimaryPreview } from "./organization-primary-preview";

const target = Object.freeze({ id: "city", name: "市局", code: "CITY" });
const province = Object.freeze({
  unitId: "province",
  unitName: "省厅",
  unitCode: "PROVINCE",
  isPrimary: 1,
});
const city = Object.freeze({
  unitId: "city",
  unitName: "市局",
  unitCode: "CITY",
  isPrimary: true,
});

it("首次加入且勾选时，明确从未设置变为当前部门", () => {
  expect(organizationPrimaryPreview([], target, true)).toEqual({
    before: "未设置",
    after: "市局（CITY）",
    action: "设为主部门",
  });
});
it("跨部门加入且勾选时，说明切换而不是暗示保留原主部门", () => {
  expect(organizationPrimaryPreview([province], target, true)).toEqual({
    before: "省厅（PROVINCE）",
    after: "市局（CITY）",
    action: "切换主部门",
  });
});
it("跨部门加入未勾选，不误报清除其他主部门", () => {
  expect(organizationPrimaryPreview([province], target, false)).toBeNull();
});
it("编辑现有主部门并取消勾选，不虚构自动补选其他部门", () => {
  expect(
    organizationPrimaryPreview(
      [province, { ...city, isPrimary: 0 }],
      { id: "province" },
      false
    )
  ).toEqual({
    before: "省厅（PROVINCE）",
    after: "未设置",
    action: "取消主部门",
  });
});
it("原本无主部门且不设置，或保持现有主部门，都无变化提示", () => {
  expect(organizationPrimaryPreview([], target, false)).toBeNull();
  expect(organizationPrimaryPreview([city], target, true)).toBeNull();
});
it("完整保留长中文、编码，不改变归属或字段", () => {
  const name = "超长中文部门".repeat(50),
    code = "X".repeat(300);
  const rows = Object.freeze([
    province,
    Object.freeze({ ...city, isPrimary: false }),
  ]);
  const before = JSON.stringify(rows);
  expect(
    organizationPrimaryPreview(rows, { ...target, name, code }, true)?.after
  ).toBe(`${name}（${code}）`);
  expect(JSON.stringify(rows)).toBe(before);
});
