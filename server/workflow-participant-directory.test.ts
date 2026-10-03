import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), query: vi.fn() }));
vi.mock("./iam-service", () => ({ hasWorkflowPermission: mocks.permission }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
import { searchWorkflowParticipants } from "./workflow-participant-directory";
const user = { id: 7, role: "user" as const };
const base = {
  workflowId: "workflow-123",
  kind: "user" as const,
  query: "",
  selectedIds: [] as string[],
};
beforeEach(() => {
  vi.resetAllMocks();
});
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
