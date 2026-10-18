import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  poolQuery: vi.fn(),
  audit: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  getConnection: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.poolQuery,
    getConnection: mocks.getConnection,
  }),
}));
vi.mock("./iam-service", () => ({
  hasWorkflowPermission: vi.fn(),
  recordAuthorizationAudit: mocks.audit,
}));
vi.mock("./workflow-engine", () => ({ resumeWorkflowTask: vi.fn() }));
vi.mock("./workflow-worker", () => ({ wakeWorkflowWorker: vi.fn() }));
import { getP1SystemSettings, updateP1SystemSetting } from "./p1-service";
import {
  DEFAULT_SYSTEM_SETTINGS,
  systemSettingConfigToken,
} from "./system-setting-config";
const actor = { id: 1, role: "admin" as const, tokenVersion: 1 };
const connection = {
  query: mocks.query,
  beginTransaction: mocks.begin,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};
let current: Record<string, unknown> | undefined;
let actorState: { role: string; status: string; tokenVersion: number };
let deadlocks = 0;
let otherFailure = false;
beforeEach(() => {
  vi.resetAllMocks();
  current = undefined;
  actorState = { role: "admin", status: "active", tokenVersion: 1 };
  deadlocks = 0;
  otherFailure = false;
  mocks.getConnection.mockResolvedValue(connection);
  mocks.query.mockImplementation(async (sql: string) => {
    if (otherFailure)
      throw Object.assign(new Error("lock timeout"), { errno: 1205 });
    if (deadlocks > 0) {
      deadlocks--;
      throw Object.assign(new Error("deadlock"), { errno: 1213 });
    }
    if (sql.startsWith("SELECT id,role")) return [[{ id: 1, ...actorState }]];
    if (sql.startsWith("SELECT valueJson"))
      return [current ? [{ valueJson: current }] : []];
    return [{ affectedRows: 1 }];
  });
});
const token = (
  key: "general" | "approval" = "general",
  value: unknown = current
) => systemSettingConfigToken(key, value);
it("未读取配置的请求在获取连接前被拒绝", async () => {
  await expect(
    updateP1SystemSetting(actor, "general", { platformName: "未读取" })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.getConnection).not.toHaveBeenCalled();
  expect(mocks.poolQuery).not.toHaveBeenCalled();
});
it.each([
  [{ platformName: " " }, "平台名称不可为空"],
  [
    { watermarkEnabled: true, watermarkText: " " },
    "开启水印时必须配置水印文本",
  ],
] as const)("非法填写回滚，不写配置和审计", async (value, message) => {
  await expect(
    updateP1SystemSetting(actor, "general", value, token())
  ).rejects.toThrow(message);
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("持锁校验快照，部分更新保留其他字段并与审计一起提交", async () => {
  current = {
    platformName: "Original",
    watermarkEnabled: true,
    watermarkText: "Internal",
    customDisplay: "preserved",
  };
  const saved = await updateP1SystemSetting(
    actor,
    "general",
    { platformName: "Renamed" },
    token()
  );
  expect(saved.value).toEqual({ ...current, platformName: "Renamed" });
  expect(saved.configToken).toBe(token("general", saved.value));
  expect(mocks.query.mock.calls[0][0]).toContain("users WHERE id=? FOR UPDATE");
  expect(mocks.query.mock.calls[1][0]).toContain(
    "system_setting WHERE `key`=? FOR UPDATE"
  );
  expect(mocks.query.mock.calls[2][1]).toEqual([
    "general",
    JSON.stringify(saved.value),
    1,
  ]);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({ resourceId: "general", action: "user_updated" }),
    connection
  );
  expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.commit.mock.invocationCallOrder[0]
  );
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
});
it("审计失败回滚，不留下成功写入的配置", async () => {
  mocks.audit.mockRejectedValueOnce(new Error("audit failed"));
  await expect(
    updateP1SystemSetting(actor, "general", { platformName: "改变" }, token())
  ).rejects.toThrow("audit failed");
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("过期快照拒绝覆盖配置，连审计也不写", async () => {
  const before = token();
  current = { ...DEFAULT_SYSTEM_SETTINGS.general, platformName: "其他管理员" };
  await expect(
    updateP1SystemSetting(actor, "general", { platformName: "旧窗口" }, before)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("没有实际变化时不写配置或审计，仍返回有效快照", async () => {
  current = {
    reviewerMode: "project_owner_or_admin",
    requireProjectApproval: true,
  };
  const saved = await updateP1SystemSetting(
    actor,
    "approval",
    { requireProjectApproval: true },
    token("approval")
  );
  expect(saved.value).toEqual(current);
  expect(saved.configToken).toBe(token("approval"));
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.commit).toHaveBeenCalledOnce();
});
it.each(["disabled", "role", "version"])("事务内复核管理员 %s", async mode => {
  if (mode === "disabled") actorState.status = "disabled";
  if (mode === "role") actorState.role = "user";
  if (mode === "version") actorState.tokenVersion = 3;
  await expect(
    updateP1SystemSetting(
      actor,
      "general",
      { platformName: "无权更新" },
      token()
    )
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("死锁释放连接后重试完整事务，最多三次", async () => {
  deadlocks = 2;
  await updateP1SystemSetting(
    actor,
    "general",
    { platformName: "重试" },
    token()
  );
  expect(mocks.getConnection).toHaveBeenCalledTimes(3);
  expect(mocks.rollback).toHaveBeenCalledTimes(2);
  expect(mocks.release).toHaveBeenCalledTimes(3);
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.audit).toHaveBeenCalledOnce();
  expect(mocks.release.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.getConnection.mock.invocationCallOrder[1]
  );
});
it("死锁耗尽给出冲突反馈；锁超时不盲目重试", async () => {
  deadlocks = 5;
  await expect(
    updateP1SystemSetting(actor, "general", { platformName: "重试" }, token())
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.release).toHaveBeenCalledTimes(3);
  vi.clearAllMocks();
  deadlocks = 0;
  otherFailure = true;
  await expect(
    updateP1SystemSetting(actor, "general", { platformName: "等待" }, token())
  ).rejects.toThrow("lock timeout");
  expect(mocks.getConnection).toHaveBeenCalledOnce();
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("读取设置同时返回独立快照，不把快照混入配置值", async () => {
  mocks.poolQuery.mockResolvedValueOnce([
    [
      {
        key: "general",
        valueJson: JSON.stringify({
          ...DEFAULT_SYSTEM_SETTINGS.general,
          platformName: "Existing",
        }),
      },
    ],
  ]);
  const settings = await getP1SystemSettings();
  expect(settings.general.platformName).toBe("Existing");
  expect(settings.configTokens.general).toBe(
    token("general", settings.general)
  );
  expect(settings.configTokens.approval).toBe(
    token("approval", settings.approval)
  );
  expect(settings.general).not.toHaveProperty("configToken");
});
