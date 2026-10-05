import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { listActiveUsersForWorkflowAssignment } from "./iam-service";
beforeEach(() => mocks.query.mockReset());

it("空搜索不加载全员名单", async () => {
  expect(
    await listActiveUsersForWorkflowAssignment({ query: "", selectedIds: [] })
  ).toEqual([]);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("直接搜索完整账号表，使用字面匹配并限制返回规模", async () => {
  mocks.query.mockResolvedValueOnce([
    [{ id: 999, username: "late_%", name: "匹配人员" }],
  ]);
  expect(
    await listActiveUsersForWorkflowAssignment({
      query: " Late_% ",
      selectedIds: [],
    })
  ).toHaveLength(1);
  expect(mocks.query.mock.calls[0][0]).toContain("status='active'");
  expect(mocks.query.mock.calls[0][0]).toContain("LOCATE(?,LOWER(username))");
  expect(mocks.query.mock.calls[0][0]).toContain("LIMIT 51");
  expect(mocks.query.mock.calls[0][1]).toEqual(["late_%", "late_%"]);
});
it("已选人员独立查询且去重，空搜索仍可显示已选账号", async () => {
  mocks.query.mockResolvedValueOnce([[{ id: 999, username: "selected" }]]);
  expect(
    await listActiveUsersForWorkflowAssignment({
      query: "",
      selectedIds: [999],
    })
  ).toEqual([{ id: 999, username: "selected" }]);
  expect(mocks.query.mock.calls[0][0]).toContain(
    "status='active' AND id IN (?)"
  );
  expect(mocks.query.mock.calls[0][1]).toEqual([999]);
  mocks.query
    .mockResolvedValueOnce([[{ id: 999, username: "selected" }]])
    .mockResolvedValueOnce([[{ id: 999, username: "selected" }]]);
  expect(
    await listActiveUsersForWorkflowAssignment({
      query: "selected",
      selectedIds: [999],
    })
  ).toHaveLength(1);
});
it("停用的已选人员不会重新出现在目录中", async () => {
  mocks.query.mockResolvedValueOnce([[]]);
  expect(
    await listActiveUsersForWorkflowAssignment({
      query: "",
      selectedIds: [999],
    })
  ).toEqual([]);
});
