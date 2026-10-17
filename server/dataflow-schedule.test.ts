import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    getConnection: async () => ({
      query: mocks.query,
      beginTransaction: mocks.begin,
      commit: mocks.commit,
      rollback: mocks.rollback,
      release: mocks.release,
    }),
  }),
}));
import {
  advanceNativeDataflowSchedule,
  changeNativeDataflowSchedule,
  lockNativeScheduleAdmission,
  nextDataflowScheduleRun,
  saveNativeDataflowSchedule,
  ScheduleSupersededError,
  validateDataflowScheduleCron,
} from "./dataflow-schedule";

const input = {
  projectId: "project-owned",
  workflowId: "flow-owned",
  expectedRevision: 4,
};
let schedule: any,
  projectStatus: string,
  workflowStatus: string,
  ownerStatus: string,
  archivedAt: string | null;
beforeEach(() => {
  vi.resetAllMocks();
  projectStatus = "active";
  workflowStatus = "published";
  ownerStatus = "active";
  archivedAt = null;
  schedule = {
    id: "schedule-owned",
    schedulerType: "internal",
    status: "paused",
    revision: 4,
    cronExpression: "0 * * * * *",
    nextRunAtUtc: "2026-10-16T12:00:00Z",
    schedulerNow: "2026-10-17T12:00:15Z",
  };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("JOIN users u"))
      return [[{ ownerUserId: 7, status: ownerStatus }]];
    if (sql.includes("FROM flow_project"))
      return [[{ id: input.projectId, status: projectStatus }]];
    if (sql.includes("FROM workflow"))
      return [[{ id: input.workflowId, status: workflowStatus, archivedAt }]];
    if (sql.includes("FROM dataflow_schedule"))
      return [
        !schedule ||
        (sql.includes("s.status='active'") && schedule.status !== "active")
          ? []
          : [schedule],
      ];
    return [{ affectedRows: 1 }];
  });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  "* * * * *",
  "10 * * * * *",
  "0 0 25 * * *",
  "0 0 9 * 13 *",
  "0 */0 * * * *",
  "0 0 0 31 2 *",
  "0 H * * * *",
])("拒绝范围、频率或日期无效的表达式 %s", cron => {
  expect(() => validateDataflowScheduleCron(cron)).toThrow();
  try {
    validateDataflowScheduleCron(cron);
  } catch (error) {
    expect(error).toMatchObject({ code: "BAD_REQUEST" });
  }
});
it("按 UTC 计算下一时刻，边界和间隔不受主机时区影响", () => {
  expect(nextDataflowScheduleRun("0 0 9 * * *", "2026-10-17T08:59:59Z")).toBe(
    "2026-10-17T09:00:00.000Z"
  );
  expect(nextDataflowScheduleRun("0 0 9 * * *", "2026-10-17T09:00:00Z")).toBe(
    "2026-10-18T09:00:00.000Z"
  );
  expect(nextDataflowScheduleRun("0 */5 * * * *", "2026-10-17T12:03:15Z")).toBe(
    "2026-10-17T12:05:00.000Z"
  );
  expect(validateDataflowScheduleCron(" 0  */5  * * * * ")).toBe(
    "0 */5 * * * *"
  );
});
it("新增计划显式写入 internal，默认暂停且带初始版本和同事务审计", async () => {
  schedule = null;
  await expect(
    saveNativeDataflowSchedule(7, {
      ...input,
      expectedRevision: undefined,
      cronExpression: "0 * * * * *",
    })
  ).resolves.toMatchObject({ status: "paused", revision: 1 });
  const sql = mocks.query.mock.calls.map(call => call[0]);
  expect(
    sql.find(row => row.startsWith("INSERT INTO dataflow_schedule"))
  ).toContain("'paused','internal'");
  expect(
    sql.find(row => row.startsWith("INSERT INTO authorization_audit_log"))
  ).toBeTruthy();
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("保存旧版本和保存活动计划都会保留当前配置", async () => {
  await expect(
    saveNativeDataflowSchedule(7, {
      ...input,
      expectedRevision: 3,
      cronExpression: "0 * * * * *",
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  schedule.status = "active";
  await expect(
    saveNativeDataflowSchedule(7, { ...input, cronExpression: "0 * * * * *" })
  ).rejects.toThrow("请先暂停");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(
    false
  );
});
it.each(["activate", "pause", "delete"] as const)(
  "%s 拒绝缺失或过期版本并回滚",
  async action => {
    await expect(
      changeNativeDataflowSchedule(
        7,
        { ...input, expectedRevision: undefined },
        action
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      changeNativeDataflowSchedule(7, { ...input, expectedRevision: 3 }, action)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledTimes(2);
  }
);
it("启用与下一触发时间、版本、审计一起提交", async () => {
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).resolves.toMatchObject({
    status: "active",
    revision: 5,
    nextRunAt: "2026-10-17T12:01:00.000Z",
  });
  const update = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith("UPDATE dataflow_schedule")
  );
  expect(update?.[1]).toEqual([
    "active",
    5,
    "2026-10-17 12:01:00",
    schedule.id,
  ]);
  expect(mocks.query.mock.calls[0][0]).toContain("FROM flow_project");
  expect(mocks.commit).toHaveBeenCalledOnce();
});
it("暂停清除到期时间并递增版本，重新启用不会复用旧版本", async () => {
  schedule.status = "active";
  const paused = await changeNativeDataflowSchedule(7, input, "pause");
  expect(paused).toMatchObject({
    status: "paused",
    revision: 5,
    nextRunAt: null,
  });
  schedule = { ...schedule, status: "paused", revision: 5 };
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    changeNativeDataflowSchedule(
      7,
      { ...input, expectedRevision: 5 },
      "activate"
    )
  ).resolves.toMatchObject({ revision: 6 });
});
it("执行器关闭或流程取消发布时不会虚假启用", async () => {
  vi.stubEnv("WORKFLOW_WORKER_ENABLED", "false");
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  vi.stubEnv("WORKFLOW_WORKER_ENABLED", "true");
  workflowStatus = "draft";
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toThrow("取消发布");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("归档业务或审计写入失败时不提交计划", async () => {
  projectStatus = "archived";
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toMatchObject({ code: "CONFLICT" });
  projectStatus = "active";
  const original = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation((sql: string, ...args: unknown[]) =>
    sql.startsWith("INSERT INTO authorization_audit_log")
      ? Promise.reject(new Error("audit unavailable"))
      : original(sql, ...args)
  );
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toThrow("audit unavailable");
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledTimes(2);
});
it("归档数据流的旧计划仍可暂停和删除，但不能启用或保存", async () => {
  archivedAt = "2026-10-17 12:00:00";
  for (const action of ["pause", "delete"] as const) {
    await expect(
      changeNativeDataflowSchedule(7, input, action)
    ).resolves.toMatchObject({ revision: 5 });
  }
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    saveNativeDataflowSchedule(7, { ...input, cronExpression: "0 * * * * *" })
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("旧托管计划不会被隐式接管", async () => {
  schedule.schedulerType = "hosted";
  schedule.scheduleCronTaskUid = "legacy-task";
  await expect(
    saveNativeDataflowSchedule(7, { ...input, cronExpression: "0 * * * * *" })
  ).rejects.toThrow("原托管计划");
  await expect(
    changeNativeDataflowSchedule(7, input, "activate")
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("已删除计划可显式新建，但旧页面携带的过期版本仍被拒绝", async () => {
  schedule.status = "deleted";
  await expect(
    saveNativeDataflowSchedule(7, {
      ...input,
      expectedRevision: 3,
      cronExpression: "0 * * * * *",
    })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    saveNativeDataflowSchedule(7, {
      ...input,
      expectedRevision: undefined,
      cronExpression: "0 * * * * *",
    })
  ).resolves.toMatchObject({ status: "paused", revision: 5 });
});

const admission = {
  id: "schedule-owned",
  revision: 4,
  dueAt: "2026-10-16T12:00:00Z",
};
const connection = () =>
  ({
    query: mocks.query,
  }) as unknown as import("mysql2/promise").PoolConnection;
it("只为同一版本和到期时刻发起任务，暂停、改版和重复扫描均跳过", async () => {
  await expect(
    lockNativeScheduleAdmission(connection(), input, admission, 7)
  ).rejects.toBeInstanceOf(ScheduleSupersededError);
  schedule.status = "active";
  const locked = await lockNativeScheduleAdmission(
    connection(),
    input,
    admission,
    7
  );
  expect(locked.bucket).toBe(
    `native:${schedule.id}:4:${Date.parse(admission.dueAt)}`
  );
  schedule.revision = 6;
  await expect(
    lockNativeScheduleAdmission(connection(), input, admission, 7)
  ).rejects.toBeInstanceOf(ScheduleSupersededError);
  schedule.revision = 4;
  schedule.nextRunAtUtc = "2026-10-17T12:01:00Z";
  await expect(
    lockNativeScheduleAdmission(connection(), input, admission, 7)
  ).rejects.toBeInstanceOf(ScheduleSupersededError);
});
it("负责人停用时不准入，停机积压只合并一次并恢复未来日历", async () => {
  schedule.status = "active";
  ownerStatus = "disabled";
  await expect(
    lockNativeScheduleAdmission(connection(), input, admission, 7)
  ).rejects.toThrow("负责人已停用");
  await advanceNativeDataflowSchedule(connection(), schedule, "run-owned");
  expect(mocks.query.mock.calls.at(-1)?.[1]).toEqual([
    "2026-10-17 12:01:00",
    "run-owned",
    schedule.id,
    4,
  ]);
});
