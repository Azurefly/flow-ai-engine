import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  poolQuery: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.poolQuery,
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: vi.fn(),
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }),
  }),
}));
vi.mock("./project-service", () => ({
  getProjectAccess: async () => ({
    exists: true,
    permissions: new Set(["project:workflow:edit"]),
  }),
}));
import { runDataSourceTestJobOnce, testDataSource } from "./p2-service";
let claimedStatus = "draft",
  currentStatus = "draft";
beforeEach(() => {
  vi.resetAllMocks();
  claimedStatus = "draft";
  currentStatus = "draft";
  const configHash = createHash("sha256")
    .update(
      JSON.stringify({
        sourceType: "inline",
        connection: {},
        credentialRef: null,
      })
    )
    .digest("hex");
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM data_source_test_run t JOIN"))
      return [
        [
          {
            id: "job",
            projectId: "owned",
            sourceId: "source",
            sourceType: "inline",
            sourceStatus: claimedStatus,
            status: "queued",
            configHash,
            attempt: 0,
            maxAttempts: 2,
            connectionJson: "{}",
            credentialRef: null,
            requestId: null,
          },
        ],
        [],
      ];
    if (sql.startsWith("SELECT connectionJson"))
      return [
        [
          {
            sourceType: "inline",
            status: currentStatus,
            connectionJson: "{}",
            credentialRef: null,
          },
        ],
        [],
      ];
    return [{ affectedRows: 1 }, []];
  });
});
it("连接成功后提交前被停用，迟到结果不能写回verified且测试终态失败", async () => {
  currentStatus = "disabled";
  expect(await runDataSourceTestJobOnce("job")).toBe(true);
  expect(mocks.rollback).toHaveBeenCalledTimes(1);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("UPDATE data_source SET status='verified'")
    )
  ).toBe(false);
  expect(
    mocks.query.mock.calls.some(
      ([sql, args]) =>
        sql.startsWith("UPDATE data_source_test_run SET status=?") &&
        args[0] === "failed" &&
        args[1] === "stale_configuration"
    )
  ).toBe(true);
});
it("领取到已停用数据源的排队测试直接失败，不会进入成功写回", async () => {
  claimedStatus = "disabled";
  await runDataSourceTestJobOnce("job");
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("SELECT connectionJson")
    )
  ).toBe(false);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("UPDATE data_source SET status='verified'")
    )
  ).toBe(false);
});
it("未变更的合法内联校验仍成功更新验证状态", async () => {
  await runDataSourceTestJobOnce("job");
  expect(mocks.rollback).not.toHaveBeenCalled();
  expect(
    mocks.query.mock.calls.filter(([sql]) =>
      sql.startsWith("UPDATE data_source SET status='verified'")
    )
  ).toHaveLength(1);
});
it("停用数据源不创建新的测试任务", async () => {
  mocks.poolQuery.mockResolvedValue([
    [
      {
        id: "source",
        sourceType: "inline",
        status: "disabled",
        connectionJson: "{}",
      },
    ],
    [],
  ]);
  await expect(
    testDataSource(
      { id: 7, role: "admin" },
      { projectId: "owned", sourceId: "source" }
    )
  ).rejects.toThrow("停用");
  expect(mocks.poolQuery).toHaveBeenCalledTimes(1);
  expect(mocks.query).not.toHaveBeenCalled();
});
