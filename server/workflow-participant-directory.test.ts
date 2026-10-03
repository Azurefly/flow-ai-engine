import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), query: vi.fn() }));
vi.mock("./iam-service", () => ({ hasWorkflowPermission: mocks.permission }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { searchWorkflowParticipants } from "./workflow-participant-directory";

const user = { id: 7, role: "user" as const };
const input = {
  workflowId: "workflow-test",
  kind: "role" as const,
  query: " 审批 ",
  selectedIds: ["reviewer", "reviewer"],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue(true);
});

it("角色按名称搜索，回显已选名称并保留运行需要的角色代号", async () => {
  mocks.query
    .mockResolvedValueOnce([[{ code: "reviewer", name: "审批人" }]])
    .mockResolvedValueOnce([[{ code: "reviewer", name: "审批人" }]]);
  expect(await searchWorkflowParticipants(user, input)).toEqual({
    selected: [{ value: "reviewer", label: "审批人（reviewer）" }],
    items: [{ value: "reviewer", label: "审批人（reviewer）" }],
    hasMore: false,
  });
  expect(mocks.permission).toHaveBeenCalledWith(
    user,
    input.workflowId,
    "workflow:edit"
  );
  expect(mocks.query.mock.calls[0][1]).toEqual(["reviewer"]);
  expect(mocks.query.mock.calls[1][1]).toEqual(["审批", "审批"]);
});

it("没有流程编辑权限时不读取角色目录", async () => {
  mocks.permission.mockResolvedValue(false);
  await expect(searchWorkflowParticipants(user, input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(mocks.query).not.toHaveBeenCalled();
});

it("空搜索不枚举目录，已删除角色不伪造回显", async () => {
  mocks.query.mockResolvedValueOnce([[]]);
  expect(
    await searchWorkflowParticipants(user, { ...input, query: "" })
  ).toEqual({ items: [], selected: [], hasMore: false });
  expect(mocks.query).toHaveBeenCalledTimes(1);
});

it("搜索返回最多五十项并提示还有更多", async () => {
  mocks.query.mockResolvedValueOnce([
    Array.from({ length: 51 }, (_, i) => ({
      code: `role_${i}`,
      name: `角色${i}`,
    })),
  ]);
  const result = await searchWorkflowParticipants(user, {
    ...input,
    selectedIds: [],
  });
  expect(result.items).toHaveLength(50);
  expect(result.hasMore).toBe(true);
});

const base = {
  workflowId: "workflow-123",
  kind: "user" as const,
  query: "",
  selectedIds: [] as string[],
};
it("rejects viewers before querying the directory", async () => {
  mocks.permission.mockResolvedValue(false);
  await expect(searchWorkflowParticipants(user, base)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
it("allows workflow editors and only hydrates selected users without bulk listing", async () => {
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValue([
    [{ id: 12, name: "张三", username: "zhang" }],
  ]);
  const result = await searchWorkflowParticipants(user, {
    ...base,
    selectedIds: ["12", "12"],
  });
  expect(mocks.permission).toHaveBeenCalledWith(
    user,
    base.workflowId,
    "workflow:edit"
  );
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][1]).toEqual(["12"]);
  expect(result.selected).toEqual([{ value: "12", label: "张三（zhang）" }]);
  expect(result.items).toEqual([]);
});
it("bounds search results, uses literal matching, and omits private fields", async () => {
  mocks.permission.mockResolvedValue(true);
  mocks.query.mockResolvedValue([
    Array.from({ length: 51 }, (_, i) => ({
      id: i + 1,
      name: "部门",
      code: `OPS${i}`,
    })),
  ]);
  const result = await searchWorkflowParticipants(user, {
    ...base,
    kind: "department",
    query: " OPS% ",
  });
  expect(result.items).toHaveLength(50);
  expect(result.hasMore).toBe(true);
  const [sql, args] = mocks.query.mock.calls[0];
  expect(sql).toContain("status='active'");
  expect(sql).toContain("LIMIT 51");
  expect(sql).not.toMatch(/email|password|phone/);
  expect(args).toEqual(["ops%", "ops%"]);
});
it("returns no directory on empty input and rejects excessive hydration", async () => {
  mocks.permission.mockResolvedValue(true);
  expect(await searchWorkflowParticipants(user, base)).toEqual({
    items: [],
    selected: [],
    hasMore: false,
  });
  expect(mocks.query).not.toHaveBeenCalled();
  await expect(
    searchWorkflowParticipants(user, {
      ...base,
      selectedIds: Array.from({ length: 101 }, (_, i) => String(i)),
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
