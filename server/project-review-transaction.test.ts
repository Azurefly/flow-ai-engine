import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  ensure: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
  settings: vi.fn(),
  separation: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.getConnection }),
}));
vi.mock("./project-service", () => ({
  ensureProjectUnitTable: mocks.ensure,
  getProjectAccess: mocks.access,
  assertWorkflowReviewerSeparation: mocks.separation,
}));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit }));
vi.mock("./p1-service", () => ({ getP1SystemSettings: mocks.settings }));
import { commitProjectWorkflowReview } from "./project-review-transaction";

const user = { id: 7, role: "admin" as const, tokenVersion: 3 };
const input = {
  projectId: "project_review",
  workflowId: "workflow_review",
  expectedDefinitionVersion: 2,
  expectedAuditStatus: "init" as const,
};
function connection(options: { actor?: unknown; workflow?: unknown } = {}) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id,role,status"))
        return [
          [
            options.actor === undefined
              ? { ...user, status: "active" }
              : options.actor,
          ].filter(Boolean),
        ];
      if (sql.startsWith("SELECT id,ownerUserId"))
        return [
          [
            options.workflow === undefined
              ? {
                  id: input.workflowId,
                  projectId: input.projectId,
                  ownerUserId: 8,
                  status: "draft",
                  archivedAt: null,
                  definitionVersion: 2,
                  auditStatus: "init",
                }
              : options.workflow,
          ].filter(Boolean),
        ];
      return [{ affectedRows: 1 }];
    }),
  };
}
function workflow(values = {}) {
  return {
    id: input.workflowId,
    projectId: input.projectId,
    ownerUserId: 8,
    status: "draft",
    archivedAt: null,
    definitionVersion: 2,
    auditStatus: "init",
    ...values,
  };
}
describe("流程审核版本、权限和事务", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensure.mockResolvedValue(undefined);
    mocks.access.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:manage"]),
    });
    mocks.audit.mockResolvedValue(undefined);
    mocks.settings.mockResolvedValue({
      approval: { reviewerMode: "independent_reviewer" },
    });
  });
  it.each([
    {},
    { expectedDefinitionVersion: 0 },
    { expectedDefinitionVersion: 1.5 },
    { expectedDefinitionVersion: NaN },
    { expectedDefinitionVersion: 2 },
  ])("无完整版本或状态的审核不会进入数据库 %j", async baseline => {
    await expect(
      commitProjectWorkflowReview(
        user,
        {
          projectId: input.projectId,
          workflowId: input.workflowId,
          ...baseline,
        },
        "approved"
      )
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
  it("依次锁定最新账号、业务与流程，并在同一事务锁定策略和提交审核审计", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    expect(await commitProjectWorkflowReview(user, input, "approved")).toBe(
      true
    );
    expect(conn.query.mock.calls[0][0]).toContain(
      "users WHERE id=? FOR UPDATE"
    );
    expect(mocks.access).toHaveBeenCalledWith(
      { id: 7, role: "admin" },
      input.projectId,
      { connection: conn, lock: true }
    );
    expect(conn.query.mock.calls[1]).toEqual([
      expect.stringContaining("workflow WHERE id=? AND projectId=? FOR UPDATE"),
      [input.workflowId, input.projectId],
    ]);
    expect(mocks.settings).toHaveBeenCalledWith({
      connection: conn,
      lock: true,
    });
    expect(mocks.separation).toHaveBeenCalledWith({
      reviewerMode: "independent_reviewer",
      actorUserId: 7,
      workflowOwnerUserId: 8,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: input.workflowId,
        details: expect.objectContaining({
          operation: "workflow_audited",
          definitionVersion: 2,
          previousAuditStatus: "init",
          auditStatus: "approved",
        }),
      }),
      conn
    );
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(
      conn.commit.mock.invocationCallOrder[0]
    );
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    { ...user, status: "disabled" },
    { ...user, status: "active", tokenVersion: 4 },
  ])("账号状态或登录版本变化不审核：%j", async actor => {
    const conn = connection({ actor });
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("使用数据库最新角色，并拒绝已撤销的业务管理权限", async () => {
    const conn = connection({
      actor: { ...user, role: "user", status: "active" },
    });
    mocks.getConnection.mockResolvedValue(conn);
    mocks.access.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:view"]),
    });
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.access).toHaveBeenCalledWith(
      { id: 7, role: "user" },
      input.projectId,
      { connection: conn, lock: true }
    );
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([null, workflow({ archivedAt: new Date() })])(
    "不存在或归档的流程不能审核 %j",
    async row => {
      const conn = connection({ workflow: row });
      mocks.getConnection.mockResolvedValue(conn);
      await expect(
        commitProjectWorkflowReview(user, input, "approved")
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(mocks.audit).not.toHaveBeenCalled();
    }
  );
  it.each([
    workflow({ status: "published" }),
    workflow({ definitionVersion: 3 }),
    workflow({ auditStatus: "rejected" }),
  ])("发布、定义变化或相反审核决定阻止旧决定 %j", async row => {
    const conn = connection({ workflow: row });
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      conn.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))
    ).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("独立复核失败回滚，不写审核状态和审计", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    mocks.separation.mockImplementation(() => {
      throw new Error("独立复核被拒绝");
    });
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toThrow("独立复核被拒绝");
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("同版本同结果的响应丢失重试只读确认，不重复写入或审计", async () => {
    const conn = connection({
      workflow: workflow({ auditStatus: "approved" }),
    });
    mocks.getConnection.mockResolvedValue(conn);
    expect(await commitProjectWorkflowReview(user, input, "approved")).toBe(
      true
    );
    expect(
      conn.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))
    ).toBe(false);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
  it("即使结果相同，定义版本变化仍必须重新复核", async () => {
    const conn = connection({
      workflow: workflow({ definitionVersion: 3, auditStatus: "approved" }),
    });
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("重置仅接受已驳回基准，保留定义版本并记录前后状态", async () => {
    await expect(
      commitProjectWorkflowReview(user, input, "init")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const conn = connection({
      workflow: workflow({ auditStatus: "rejected" }),
    });
    mocks.getConnection.mockResolvedValue(conn);
    expect(
      await commitProjectWorkflowReview(
        user,
        { ...input, expectedAuditStatus: "rejected" },
        "init"
      )
    ).toBe(true);
    expect(
      conn.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE"))?.[0]
    ).not.toContain("definitionVersion=");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          operation: "workflow_audit_reset",
          definitionVersion: 2,
          retainedDefinition: true,
          previousAuditStatus: "rejected",
          auditStatus: "init",
        }),
      }),
      conn
    );
  });
  it("审计失败同时回滚审核状态", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    mocks.audit.mockRejectedValue(new Error("audit failure"));
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toThrow("audit failure");
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it("死锁释放后有界重试并重新检查权限", async () => {
    const first = connection(),
      second = connection();
    first.commit.mockRejectedValue(
      Object.assign(new Error("deadlock"), { errno: 1213 })
    );
    mocks.getConnection
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    expect(await commitProjectWorkflowReview(user, input, "approved")).toBe(
      true
    );
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(first.release.mock.invocationCallOrder[0]).toBeLessThan(
      second.beginTransaction.mock.invocationCallOrder[0]
    );
  });
  it("连续死锁最多三次，不无限占用连接", async () => {
    const conn = connection();
    conn.commit.mockRejectedValue(
      Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" })
    );
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      commitProjectWorkflowReview(user, input, "approved")
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(conn.release).toHaveBeenCalledTimes(3);
  });
  it.each(["ECONNRESET", "ER_LOCK_WAIT_TIMEOUT"])(
    "未知提交结果和等待超时不盲目重试 %s",
    async code => {
      const conn = connection();
      conn.commit.mockRejectedValue(Object.assign(new Error(code), { code }));
      mocks.getConnection.mockResolvedValue(conn);
      await expect(
        commitProjectWorkflowReview(user, input, "approved")
      ).rejects.toThrow(code);
      expect(mocks.getConnection).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    }
  );
});
