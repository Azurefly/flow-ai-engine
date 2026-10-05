import { expect, it } from "vitest";
import { visibleOrganizationIds as visible } from "./organization-tree-visibility";
const units = [
  { id: "root", name: "总部", status: "disabled" },
  {
    id: "active",
    parentUnitId: "root",
    name: "研发",
    code: "ENG",
    status: "active",
  },
  { id: "old", name: "历史", status: "disabled" },
];
it("默认隐藏停用部门但保留启用子部门的祖先", () =>
  expect([...visible(units, "", false)]).toEqual(["active", "root"]));
it("开关显示全部停用部门", () => expect(visible(units, "", true).size).toBe(3));
it("搜索遵守状态过滤并保留路径", () => {
  expect(visible(units, "历史", false).size).toBe(0);
  expect([...visible(units, "eng", false)]).toEqual(["active", "root"]);
  expect([...visible(units, "历史", true)]).toEqual(["old"]);
});
it("祖先环不造成死循环", () =>
  expect(
    visible(
      [
        { id: "a", parentUnitId: "b", name: "A", status: "active" },
        { id: "b", parentUnitId: "a", name: "B", status: "disabled" },
      ],
      "",
      false
    ).size
  ).toBe(2));

it("全停用目录默认为空，开启后可以恢复查看", () => {
  const disabled = [{ id: "old", name: "历史部门", status: "disabled" }];
  expect(visible(disabled, "", false).size).toBe(0);
  expect([...visible(disabled, "", true)]).toEqual(["old"]);
});
