import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  poolQuery: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  access: vi.fn(),
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
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
import { queueDueNativeDataflowsOnce, runDataflow } from "./p2-service";
import { ScheduleSupersededError } from "./dataflow-schedule";

const owner = { id: 7, role: "admin" as const };
const input = {
  projectId: "project-owned",
  workflowId: "flow-owned",
  triggerType: "schedule" as const,
  scheduleAdmission: {
    id: "schedule-owned",
    revision: 4,
    dueAt: "2026-10-16T12:00:00Z",
  },
};
let schedule: any;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:workflow:edit"]),
  });
  schedule = {
    id: "schedule-owned",
    schedulerType: "internal",
    status: "active",
    revision: 4,
    cronExpression: "0 * * * * *",
    nextRunAtUtc: input.scheduleAdmission.dueAt,
    schedulerNow: "2026-10-17T12:00:15Z",
  };
  const definition = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 200, y: 0 },
        config: {},
      },
    ],
    edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }],
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("JOIN users u"))
      return [[{ ownerUserId: 7, status: "active" }]];
    if (sql.includes("FROM flow_project"))
      return [[{ id: input.projectId, status: "active" }]];
    if (sql.includes("FROM workflow WHERE"))
      return [
        [
          {
            id: input.workflowId,
            status: "published",
            definitionVersion: 1,
            definitionJson: definition,
          },
        ],
      ];
    if (sql.includes("FROM dataflow_schedule"))
      if (sql.includes("schedulerType='hosted'")) return [[]];
    if (sql.includes("FROM dataflow_schedule"))
      return [schedule ? [schedule] : []];
    return [{ affectedRows: 1 }];
  });
  mocks.poolQuery.mockResolvedValue([[]]);
});

it("运行、Job 和下一时刻在同一连接中提交，调度发现不执行数据节点", async () => {
  await expect(runDataflow(owner, input)).resolves.toMatchObject({
    status: "queued",
    output: null,
  });
  const sql = mocks.query.mock.calls.map(call => call[0]);
  const run = sql.findIndex(row => row.startsWith("INSERT INTO dataflow_run "));
  const job = sql.findIndex(row =>
    row.startsWith("INSERT INTO dataflow_run_job")
  );
  const advance = sql.findIndex(row =>
    row.startsWith("UPDATE dataflow_schedule")
  );
  expect(run).toBeGreaterThan(0);
  expect(job).toBeGreaterThan(run);
  expect(advance).toBeGreaterThan(job);
  expect(mocks.query.mock.calls[run][1][4]).toBe(
    `native:schedule-owned:4:${Date.parse(input.scheduleAdmission.dueAt)}`
  );
  expect(sql.some(row => row.includes("SKIP LOCKED"))).toBe(false);
  expect(mocks.poolQuery).not.toHaveBeenCalled();
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("任务入队失败时回滚运行记录，不推进到期时间", async () => {
  const original = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((sql: string, ...args: unknown[]) =>
    sql.startsWith("INSERT INTO dataflow_run_job")
      ? Promise.reject(new Error("queue failure"))
      : original(sql, ...args)
  );
  await expect(runDataflow(owner, input)).rejects.toThrow("queue failure");
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.startsWith("UPDATE dataflow_schedule")
    )
  ).toBe(false);
});
it("旧时刻重复扫描和旧版本准入都不会写入运行", async () => {
  schedule.nextRunAtUtc = "2026-10-17T12:01:00Z";
  await expect(runDataflow(owner, input)).rejects.toBeInstanceOf(
    ScheduleSupersededError
  );
  schedule.nextRunAtUtc = input.scheduleAdmission.dueAt;
  schedule.revision = 6;
  await expect(runDataflow(owner, input)).rejects.toBeInstanceOf(
    ScheduleSupersededError
  );
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
    false
  );
});
it("已暂停或已迁移的托管回调不能在读取旧快照后重新发起", async () => {
  await expect(
    runDataflow(owner, {
      ...input,
      scheduleAdmission: undefined,
      hostedTaskUid: "old-hosted-task",
    })
  ).rejects.toBeInstanceOf(ScheduleSupersededError);
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
    false
  );
});
it("发现器只读取内置活动计划，发生业务阻塞时只暂停原版本", async () => {
  mocks.poolQuery
    .mockResolvedValueOnce([
      [
        {
          ...schedule,
          projectId: input.projectId,
          workflowId: input.workflowId,
          dueAt: input.scheduleAdmission.dueAt,
          ownerUserId: 7,
          ownerRole: "admin",
        },
      ],
    ])
    .mockResolvedValue([{}]);
  mocks.access.mockRejectedValue(new Error("access revoked"));
  await expect(queueDueNativeDataflowsOnce()).resolves.toBe(0);
  expect(mocks.poolQuery.mock.calls[0][0]).toContain(
    "s.schedulerType='internal'"
  );
  expect(mocks.poolQuery.mock.calls[0][0]).toContain(
    "s.nextRunAt<=UTC_TIMESTAMP()"
  );
  expect(mocks.poolQuery.mock.calls[1][0]).toContain(
    "revision=? AND status='active'"
  );
  expect(mocks.poolQuery.mock.calls[1][0]).toContain("AND nextRunAt=?");
  expect(mocks.poolQuery.mock.calls[1][1].slice(1)).toEqual([
    schedule.id,
    4,
    "2026-10-16 12:00:00",
    7,
  ]);
});

it.each([
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
])("短暂数据库故障 %s 保留原到期计划等待重试", async code => {
  mocks.poolQuery.mockResolvedValueOnce([
    [
      {
        ...schedule,
        projectId: input.projectId,
        workflowId: input.workflowId,
        dueAt: input.scheduleAdmission.dueAt,
        ownerUserId: 7,
      },
    ],
  ]);
  mocks.access.mockRejectedValue(
    Object.assign(new Error("temporary database failure"), { code })
  );
  await expect(queueDueNativeDataflowsOnce()).resolves.toBe(0);
  expect(mocks.poolQuery).toHaveBeenCalledOnce();
});
