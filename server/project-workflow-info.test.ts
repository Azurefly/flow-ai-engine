import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  ensure: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connection }),
}));
vi.mock("./project-service", () => ({
  ensureProjectUnitTable: mocks.ensure,
  getProjectAccess: mocks.access,
}));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit }));
import { commitProjectWorkflowInfo } from "./project-workflow-info";
import { workflowInfoToken } from "./workflow-info-token";

const user = { id: 7, role: "admin" as const, tokenVersion: 3 };
const original = {
  id: "workflow_info",
  projectId: "project_info",
  name: "申请审批",
  description: "原说明",
  archivedAt: null,
};
const input = {
  workflowId: original.id,
  projectId: original.projectId,
  name: "新名称",
  description: "新说明",
  expectedConfigToken: workflowInfoToken(original),
};
function connection(
  actor: unknown = { ...user, status: "active" },
  workflow: unknown = { ...original }
) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.startsWith("SELECT id,role,status"))
        return [[actor].filter(Boolean)];
      if (sql.startsWith("SELECT id,projectId"))
        return [[workflow].filter(Boolean)];
      return [{ affectedRows: 1 }];
    }),
  };
}

describe("流程基本信息快照与提交合同", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensure.mockResolvedValue(undefined);
    mocks.access.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:workflow:edit"]),
    });
    mocks.audit.mockResolvedValue(undefined);
  });
  it("只由目标和名称说明产生确认凭据，不因无关运行、布局或审核变化造成冲突", () => {
    expect(
      workflowInfoToken({
        ...original,
        definitionVersion: 99,
        updatedAt: new Date(),
        status: "published",
        auditStatus: "approved",
      })
    ).toBe(input.expectedConfigToken);
    for (const change of [
      { id: "other" },
      { projectId: "other" },
      { name: "他人修改" },
      { description: "他人说明" },
    ])
      expect(workflowInfoToken({ ...original, ...change })).not.toBe(
        input.expectedConfigToken
      );
  });
  it.each([undefined, "", "old", "A".repeat(64)])(
    "缺少或不合法的确认凭据不会进入写事务 %s",
    async expectedConfigToken => {
      await expect(
        commitProjectWorkflowInfo(user, { ...input, expectedConfigToken })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(mocks.connection).not.toHaveBeenCalled();
    }
  );
  it.each([
    { name: " " },
    { name: "n".repeat(161) },
    { description: "d".repeat(1201) },
  ])("非法填写不进入事务 %j", async values => {
    await expect(
      commitProjectWorkflowInfo(user, { ...input, ...values })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.connection).not.toHaveBeenCalled();
  });
  it("锁定当前账号、业务权限和流程，仅修改名称说明，审计与业务同事务", async () => {
    const conn = connection();
    mocks.connection.mockResolvedValue(conn);
    expect(
      await commitProjectWorkflowInfo(user, {
        ...input,
        name: " 新名称 ",
        description: " 新说明 ",
      })
    ).toBe(true);
    expect(conn.query.mock.calls[0][0]).toContain(
      "users WHERE id=? FOR UPDATE"
    );
    expect(mocks.access).toHaveBeenCalledWith(
      { id: 7, role: "admin" },
      input.projectId,
      { connection: conn, lock: true }
    );
    expect(conn.query.mock.calls[1]).toEqual([
      expect.stringContaining("WHERE id=? AND projectId=? FOR UPDATE"),
      [input.workflowId, input.projectId],
    ]);
    expect(conn.query.mock.calls[2]).toEqual([
      "UPDATE workflow SET name=?,description=?,updatedAt=NOW() WHERE id=? AND projectId=?",
      ["新名称", "新说明", input.workflowId, input.projectId],
    ]);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: input.workflowId,
        details: expect.objectContaining({
          operation: "project_workflow_info_updated",
          previousConfigToken: input.expectedConfigToken,
          fields: { nameChanged: true, descriptionChanged: true },
        }),
      }),
      conn
    );
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
      conn.commit.mock.invocationCallOrder[0]
    );
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    { ...user, status: "disabled" },
    { ...user, status: "active", tokenVersion: 4 },
    { ...user, status: "active", role: "invalid" },
  ])("账号停用或登录状态变化不能写入 %j", async actor => {
    const conn = connection(actor);
    mocks.connection.mockResolvedValue(conn);
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("使用数据库当前角色复核权限，不能沿用请求时的管理员角色", async () => {
    const conn = connection({ ...user, role: "user", status: "active" });
    mocks.connection.mockResolvedValue(conn);
    mocks.access.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:view"]),
    });
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.access).toHaveBeenCalledWith(
      { id: 7, role: "user" },
      input.projectId,
      { connection: conn, lock: true }
    );
    expect(conn.query).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("业务已归档时不进入流程写入", async () => {
    const conn = connection();
    mocks.connection.mockResolvedValue(conn);
    mocks.access.mockResolvedValue({ exists: false, permissions: new Set() });
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...original, archivedAt: new Date() }])(
    "不存在、跨业务或已归档的流程不修改 %j",
    async workflow => {
      const conn = connection(undefined, workflow);
      mocks.connection.mockResolvedValue(conn);
      await expect(
        commitProjectWorkflowInfo(user, input)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it.each([{ name: "他人新名称" }, { description: "他人新说明" }])(
    "不覆盖他人已修改的基本信息 %j",
    async values => {
      const conn = connection(undefined, { ...original, ...values });
      mocks.connection.mockResolvedValue(conn);
      await expect(
        commitProjectWorkflowInfo(user, input)
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(conn.query).toHaveBeenCalledTimes(2);
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it("保存响应丢失后的相同绝对值请求只核对结果，不重复更新或审计", async () => {
    const conn = connection(undefined, {
      ...original,
      name: input.name,
      description: input.description,
    });
    mocks.connection.mockResolvedValue(conn);
    expect(await commitProjectWorkflowInfo(user, input)).toBe(true);
    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledOnce();
  });
  it("审计失败回滚，不返回成功", async () => {
    const conn = connection();
    mocks.connection.mockResolvedValue(conn);
    mocks.audit.mockRejectedValue(new Error("audit unavailable"));
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toThrow(
      "audit unavailable"
    );
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("有界重试死锁时重新检查账号、权限和快照", async () => {
    const first = connection(),
      second = connection(undefined, {
        ...original,
        description: "等待期间改变",
      });
    first.query.mockRejectedValueOnce(
      Object.assign(new Error("deadlock"), { errno: 1213 })
    );
    mocks.connection.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(first.rollback).toHaveBeenCalledOnce();
    expect(second.query.mock.calls[0][0]).toContain(
      "users WHERE id=? FOR UPDATE"
    );
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("锁等待超时回滚并返回可修正的冲突", async () => {
    const conn = connection();
    conn.query.mockRejectedValueOnce(
      Object.assign(new Error("wait"), { errno: 1205 })
    );
    mocks.connection.mockResolvedValue(conn);
    await expect(commitProjectWorkflowInfo(user, input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection).toHaveBeenCalledOnce();
  });
});
