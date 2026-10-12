import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), pool: vi.fn(), connect: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), update: vi.fn(), create: vi.fn(), access: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.pool, getConnection: mocks.connect }) }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
vi.mock("./_core/heartbeat", () => ({ createHeartbeatJob: mocks.create, updateHeartbeatJob: mocks.update, deleteHeartbeatJob: vi.fn() }));
import { activateDataflowSchedule } from "./p2-service";
let projectStatus: string, workflowExists: boolean, scheduleExists: boolean;
const schedule = { id: "owned-schedule", status: "paused", scheduleCronTaskUid: "owned-job", cronExpression: "0 * * * * *" };
beforeEach(() => {
  vi.resetAllMocks(); projectStatus = "active"; workflowExists = true; scheduleExists = true;
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set(["project:workflow:edit"]) });
  mocks.update.mockResolvedValue({});
  mocks.connect.mockResolvedValue({ query: mocks.query, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release });
  mocks.pool.mockImplementation(async (sql: string) => [sql.includes("FROM dataflow_schedule") ? [schedule] : [{ id: "owned-flow", name: "归档测试数据流程" }]]);
  mocks.query.mockImplementation(async (sql: string) => [
    sql.includes("FROM flow_project") ? [{ id: "owned-project", status: projectStatus }] :
    sql.includes("FROM workflow WHERE") ? workflowExists ? [{ id: "owned-flow" }] : [] :
    sql.includes("FROM dataflow_schedule") ? scheduleExists ? [schedule] : [] : { affectedRows: 1 },
  ]);
});
const activate = () => activateDataflowSchedule({ id: 7, role: "admin" }, { projectId: "owned-project", workflowId: "owned-flow" });
it("远端激活返回后项目被归档时不提交调度，回滚并停用同一个远端计划", async () => {
  mocks.update.mockImplementationOnce(async () => { projectStatus = "archived"; });
  await expect(activate()).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.update).toHaveBeenLastCalledWith("owned-job", { enable: false }, "");
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.commit).not.toHaveBeenCalled();
});
it("远端返回后流程取消发布时不激活过期计划", async () => {
  mocks.update.mockImplementationOnce(async () => { workflowExists = false; });
  await expect(activate()).rejects.toThrow("流程已归档或取消发布");
  expect(mocks.update).toHaveBeenLastCalledWith("owned-job", { enable: false }, "");
});
it("调度在远端返回之前删除时不返回虚假的成功", async () => {
  mocks.update.mockImplementationOnce(async () => { scheduleExists = false; });
  await expect(activate()).rejects.toThrow("调度配置已变化");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("远端停用失败明确报告未确认状态", async () => {
  mocks.update.mockImplementationOnce(async () => { projectStatus = "archived"; }).mockRejectedValueOnce(new Error("provider offline"));
  await expect(activate()).rejects.toThrow("远端计划的停用尚未确认");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("有效项目、流程和计划在同一事务中激活", async () => {
  await expect(activate()).resolves.toMatchObject({ status: "active" });
  expect(mocks.query.mock.calls[0][0]).toContain("FROM flow_project");
  expect(mocks.query.mock.calls[1][0]).toContain("FOR UPDATE");
  expect(mocks.query.mock.calls[2][0]).toContain("FOR UPDATE");
  expect(mocks.commit).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
});
it("远端已激活但数据库连接获取失败时仍尝试停用远端计划", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("pool offline"));
  await expect(activate()).rejects.toThrow("pool offline");
  expect(mocks.update).toHaveBeenLastCalledWith("owned-job", { enable: false }, "");
  expect(mocks.commit).not.toHaveBeenCalled();
});
it("现有计划激活响应异常时补偿停用，避免假定远端没有执行", async () => {
  mocks.update.mockRejectedValueOnce(new Error("provider timeout"));
  await expect(activate()).rejects.toThrow("provider timeout");
  expect(mocks.update).toHaveBeenLastCalledWith("owned-job", { enable: false }, "");
});
