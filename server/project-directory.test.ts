import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasSystemPermissionMock, queryMock } = vi.hoisted(() => ({
  hasSystemPermissionMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("./db", () => ({
  getSharedPool: () => ({ query: queryMock }),
}));
vi.mock("./iam-service", () => ({
  hasSystemPermission: hasSystemPermissionMock,
  recordAuthorizationAudit: vi.fn(),
}));

import {
  listActiveUsers,
  searchActiveUnits,
  searchActiveUsers,
} from "./project-service";

const regularUser = { id: 7, role: "user" as const };
const administrator = { id: 1, role: "admin" as const };

describe("project permission directories", () => {
  beforeEach(() => {
    queryMock.mockReset();
    hasSystemPermissionMock.mockReset();
  });

  it("does not expose the global people directory without project-create permission", async () => {
    hasSystemPermissionMock.mockResolvedValue(false);

    await expect(listActiveUsers(regularUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前账号无权搜索项目成员目录。",
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("searches users by name or account and omits email from picker results", async () => {
    hasSystemPermissionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce([
      [{ id: 12, name: "Alice", username: "alice.ops" }],
      [],
    ]);

    const result = await searchActiveUsers(administrator, {
      query: " Alice ",
    });

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("LOCATE(?,LOWER(COALESCE(name,'')))>0"),
      ["alice", "alice"]
    );
    expect(queryMock.mock.calls[0][0]).toContain("LIMIT 51");
    expect(queryMock.mock.calls[0][0]).not.toContain("email");
    expect(result).toEqual({
      items: [{ id: 12, name: "Alice", username: "alice.ops" }],
      hasMore: false,
    });
  });

  it("requires project management permission before scoped directory searches", async () => {
    queryMock
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ ownerUserId: 3, status: "active" }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    await expect(
      searchActiveUsers(regularUser, {
        projectId: "project-123456",
        query: "alice",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前账号无权搜索此项目的成员目录。",
    });

    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("FROM users"))
    ).toBe(false);
    expect(hasSystemPermissionMock).not.toHaveBeenCalled();
  });

  it("searches department paths in application code and caps returned options", async () => {
    hasSystemPermissionMock.mockResolvedValue(true);
    queryMock.mockResolvedValueOnce([
      [
        { id: "root", code: "HQ", name: "总部", parentUnitId: null },
        { id: "ops", code: "OPS", name: "运营部", parentUnitId: "root" },
      ],
      [],
    ]);

    const result = await searchActiveUnits(administrator, { query: "hq/ops" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "ops",
      displayPath: "总部 / 运营部（HQ/OPS）",
    });
    expect(result.hasMore).toBe(false);
  });
});
