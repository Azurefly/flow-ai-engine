import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ query: vi.fn(), poolQuery: vi.fn(), connection: vi.fn(), audit: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.poolQuery, getConnection: mocks.connection }) }));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit, hasSystemPermission: vi.fn(), getWorkflowAccess: vi.fn() }));
import { changeProjectStatus } from "./project-lifecycle";
import { lockActiveProject } from "./project-lifecycle-lock";
import { getProjectAccess } from "./project-service";
const actor = { id: 7, role: "admin" as const };
let actorRow: any, project: any, workflows: any[], members: any[], units: any[], blockedTable: string;
let connection: any;
beforeEach(() => {
  vi.clearAllMocks();
  actorRow = { id: 7, role: "admin", status: "active" };
  project = { id: "project-owned", ownerUserId: 7, name: "业务", code: "OWN", status: "active", lifecycleVersion: 1 };
  workflows = [{ id: "w1", archivedAt: null }, { id: "w2", archivedAt: new Date() }];
  members = []; units = []; blockedTable = "";
  mocks.poolQuery.mockResolvedValue([[]]); mocks.audit.mockResolvedValue(undefined);
  connection = { query: mocks.query, beginTransaction: mocks.begin, commit: mocks.commit, rollback: mocks.rollback, release: mocks.release };
  mocks.connection.mockResolvedValue(connection);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users")) return [[actorRow]];
    if (sql.includes("FROM flow_project WHERE")) return [[project]];
    if (sql.includes("FROM flow_project_member")) return [members];
    if (sql.includes("FROM flow_project_unit")) return [units];
    if (sql.startsWith("SELECT id,archivedAt FROM workflow")) return [workflows];
    if (blockedTable && sql.startsWith(`SELECT id FROM ${blockedTable} `)) return [[{ id: "busy" }]];
    if (sql.startsWith("SELECT")) return [[]];
    return [{ affectedRows: 1 }];
  });
});
const input = (changes: Record<string, unknown> = {}) => ({ projectId: "project-owned", status: "archived" as const, expectedVersion: 1, expectedWorkflowCount: 1, ...changes });
const updates = () => mocks.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE"));
describe("业务归档事务", () => {
  it("按项目与流程锁定并在同一事务保存归档、版本和审计，保留原定义与历史", async () => {
    expect(await changeProjectStatus(actor, input())).toMatchObject({ status: "archived", lifecycleVersion: 2, archivedWorkflows: 1 });
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("ORDER BY id FOR UPDATE"))).toBe(true);
    expect(updates()[0][0]).toContain("status='draft'");
    expect(updates()[0][0]).toContain("archivedAt IS NULL");
    expect(updates()[1][1]).toEqual(["archived", "project-owned", 1]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ resourceId: "project-owned", details: expect.objectContaining({ operation: "project_archived", archivedWorkflowIds: ["w1"], previousVersion: 1, lifecycleVersion: 2 }) }), connection);
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.commit.mock.invocationCallOrder[0]);
    expect(mocks.commit).toHaveBeenCalledOnce(); expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls.some(([sql]) => /DELETE|definitionJson\s*=/.test(sql))).toBe(false);
  });
  it.each(["workflow_run", "workflow_task", "dataflow_run", "dataflow_schedule"])("存在活动 %s 时不更改项目或流程", async table => {
    blockedTable = table;
    await expect(changeProjectStatus(actor, input())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(updates()).toHaveLength(0); expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("恢复只开启业务空间，不恢复流程发布或调度", async () => {
    project.status = "archived"; workflows.forEach(row => row.archivedAt = new Date());
    expect(await changeProjectStatus(actor, input({ status: "active", expectedWorkflowCount: 0 }))).toMatchObject({ status: "active", archivedWorkflows: 0 });
    expect(updates()).toHaveLength(1); expect(updates()[0][0]).toContain("UPDATE flow_project");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("UPDATE dataflow_schedule"))).toBe(false);
  });
  it("旧项目恢复时归档遗留在用流程，避免重新发布旧版本", async () => {
    project.status = "archived";
    expect(await changeProjectStatus(actor, input({ status: "active" }))).toMatchObject({ archivedWorkflows: 1 });
    expect(updates()[0][0]).toContain("status='draft'");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ archivedWorkflowIds: ["w1"] }) }), connection);
  });
  it.each([{ lifecycleVersion: 3 }, { lifecycleVersion: 0 }, { status: "archived" }])("拒绝旧版本与重复状态 %j", async changed => {
    Object.assign(project, changed);
    await expect(changeProjectStatus(actor, input())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(updates()).toHaveLength(0);
  });
  it("确认后新增流程需要重新确认数量", async () => {
    workflows.push({ id: "unreviewed", archivedAt: null });
    await expect(changeProjectStatus(actor, input())).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("流程数量已变化") });
    expect(updates()).toHaveLength(0);
  });
  it("审计写入失败会回滚项目及所有流程变更", async () => {
    mocks.audit.mockRejectedValueOnce(new Error("audit failure"));
    await expect(changeProjectStatus(actor, input())).rejects.toThrow("audit failure");
    expect(mocks.rollback).toHaveBeenCalledOnce(); expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("使用锁定账号类型判断管理员，不采信过时的请求账号类型", async () => {
    actorRow.role = "user"; project.ownerUserId = 99;
    await expect(changeProjectStatus(actor, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updates()).toHaveLength(0);
  });
  it.each(["member", "unit"])("普通账号的有效 %s 所有者可以管理业务归档", async kind => {
    actorRow.role = "user"; project.ownerUserId = 99;
    if (kind === "member") members = [{ id: "own" }]; else units = [{ id: "own" }];
    await expect(changeProjectStatus({ id: 7, role: "user" }, input())).resolves.toMatchObject({ status: "archived" });
    const sql = mocks.query.mock.calls.find(([sql]) => sql.includes("FROM flow_project_member"))?.[0];
    expect(sql).toContain("revokedAt IS NULL"); expect(sql).toContain("expiresAt>NOW()"); expect(sql).toContain("FOR UPDATE");
  });
  it("停用账号不进入项目变更", async () => {
    actorRow.status = "disabled";
    await expect(changeProjectStatus(actor, input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updates()).toHaveLength(0);
  });
  it("空业务可归档，不执行空的流程集合查询", async () => {
    workflows = [];
    await expect(changeProjectStatus(actor, input({ expectedWorkflowCount: 0 }))).resolves.toMatchObject({ archivedWorkflows: 0 });
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("IN (?)"))).toBe(false);
  });
});
it("归档项目的锁阻止旧创建、恢复、运行或激活请求继续执行", async () => {
  project.status = "archived";
  await expect(lockActiveProject(connection, project.id)).rejects.toMatchObject({ code: "CONFLICT" });
  project.status = "active";
  await expect(lockActiveProject(connection, project.id)).resolves.toBeUndefined();
});
it("归档项目的历史读取保留原角色但只授予查看权限，普通入口仍关闭", async () => {
  project.status = "archived";
  mocks.poolQuery.mockResolvedValue([[project]]);
  expect((await getProjectAccess(actor, project.id)).exists).toBe(false);
  const access = await getProjectAccess(actor, project.id, { includeArchived: true });
  expect(access.roles).toEqual(["owner"]);
  expect([...Array.from(access.permissions)]).toEqual(["project:view"]);
});
it("迁移只添加状态版本，SQL及生成快照一致", () => {
  const sql = readFileSync(new URL("../drizzle/0038_project_lifecycle.sql", import.meta.url), "utf8");
  const snapshot = JSON.parse(readFileSync(new URL("../drizzle/meta/0038_snapshot.json", import.meta.url), "utf8"));
  expect(sql.trim()).toBe("ALTER TABLE `flow_project` ADD `lifecycleVersion` int DEFAULT 1 NOT NULL;");
  expect(snapshot.tables.flow_project.columns.lifecycleVersion).toMatchObject({ type: "int", notNull: true, default: 1 });
});
