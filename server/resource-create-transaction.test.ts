import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalResourcePayload } from "../shared/resource-creation";

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  ensure: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.getConnection }),
}));
vi.mock("./project-service", () => ({
  ensureProjectUnitTable: mocks.ensure,
  getProjectAccess: mocks.access,
}));
vi.mock("./iam-service", () => ({ recordAuthorizationAudit: mocks.audit }));
import { createProjectResource } from "./resource-create-transaction";

const user = { id: 7, role: "admin" as const, tokenVersion: 3 };
const payload = { name: "订单资源", schema: [{ name: "id", type: "string" }] };
const key = "request_1234567890abcdef";
const hash = () =>
  createHash("sha256").update(canonicalResourcePayload(payload)).digest("hex");
function connection(
  input: { actor?: unknown; receipt?: unknown; resource?: unknown } = {}
) {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT id,role,status"))
        return [
          [
            input.actor === undefined
              ? { id: 7, role: "admin", status: "active", tokenVersion: 3 }
              : input.actor,
          ].filter(Boolean),
        ];
      if (sql.startsWith("SELECT payloadHash"))
        return [[input.receipt].filter(Boolean)];
      if (sql.startsWith("SELECT id FROM data_"))
        return [
          [
            input.resource === undefined
              ? { id: "resource_original" }
              : input.resource,
          ].filter(Boolean),
        ];
      return [{ affectedRows: 1 }];
    }),
  };
}
function input(create = vi.fn().mockResolvedValue(undefined)) {
  return {
    projectId: "project_123",
    kind: "asset" as const,
    requestKey: key,
    payload,
    create,
  };
}

describe("资源创建回执与事务", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensure.mockResolvedValue(undefined);
    mocks.access.mockResolvedValue({
      exists: true,
      permissions: new Set(["project:workflow:edit"]),
    });
    mocks.audit.mockResolvedValue(undefined);
  });
  it("校验标识和内容后才打开事务，非法内容不会触碰数据库", async () => {
    await expect(
      createProjectResource(user, { ...input(), requestKey: "bad" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const cycle: any = {};
    cycle.self = cycle;
    await expect(
      createProjectResource(user, { ...input(), payload: cycle })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.getConnection).not.toHaveBeenCalled();
  });
  it("先锁定最新账号、同连接检查业务权限，再原子写回执、资源和审计", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    const create = vi.fn(async (active, id) => {
      await active.query("INSERT owned_resource", [id]);
    });
    const resourceId = await createProjectResource(user, input(create));
    expect(resourceId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(conn.query.mock.calls[0][0]).toContain(
      "users WHERE id=? FOR UPDATE"
    );
    expect(mocks.access).toHaveBeenCalledWith(
      { id: 7, role: "admin" },
      "project_123",
      { connection: conn, lock: true }
    );
    const writes = conn.query.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT")
    );
    expect(writes[0][0]).toContain("resource_creation_request");
    expect(JSON.stringify(writes[0])).not.toContain(key);
    expect(JSON.stringify(writes[0])).not.toContain("订单资源");
    expect(writes[1][0]).toBe("INSERT owned_resource");
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 7,
        resourceId,
        resourceType: "data_asset",
        details: expect.objectContaining({
          projectId: "project_123",
          operation: "created",
          creationRequestId: expect.any(String),
        }),
      }),
      conn
    );
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it("重复请求重新检查权限并返回原资源，不重复创建或审计", async () => {
    const conn = connection({
      receipt: { payloadHash: hash(), resourceId: "resource_original" },
    });
    mocks.getConnection.mockResolvedValue(conn);
    const command = input();
    expect(await createProjectResource(user, command)).toBe(
      "resource_original"
    );
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(command.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(
      conn.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))
    ).toBe(false);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });
  it("同一标识携带不同内容时冲突，不覆盖原资源", async () => {
    const conn = connection({
      receipt: { payloadHash: "different", resourceId: "original" },
    });
    mocks.getConnection.mockResolvedValue(conn);
    const command = input();
    await expect(createProjectResource(user, command)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(command.create).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("原资源已删除时保留历史回执，拒绝静默重建", async () => {
    const conn = connection({
      receipt: { payloadHash: hash(), resourceId: "original" },
      resource: null,
    });
    mocks.getConnection.mockResolvedValue(conn);
    const command = input();
    await expect(createProjectResource(user, command)).rejects.toThrow(
      "已删除"
    );
    expect(command.create).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { id: 7, role: "admin", status: "disabled", tokenVersion: 3 },
    { id: 7, role: "admin", status: "active", tokenVersion: 4 },
  ])("账号停用、消失或登录版本变化不返回历史结果：%j", async actor => {
    const conn = connection({
      actor,
      receipt: { payloadHash: hash(), resourceId: "original" },
    });
    mocks.getConnection.mockResolvedValue(conn);
    await expect(createProjectResource(user, input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(
      conn.query.mock.calls.some(([sql]) =>
        sql.startsWith("SELECT payloadHash")
      )
    ).toBe(false);
  });
  it("权限已收回时不读取历史回执，并使用数据库中的最新账号角色", async () => {
    const conn = connection({
      actor: { id: 7, role: "user", status: "active", tokenVersion: 3 },
    });
    mocks.getConnection.mockResolvedValue(conn);
    mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
    await expect(createProjectResource(user, input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.access.mock.calls[0][0].role).toBe("user");
    expect(
      conn.query.mock.calls.some(([sql]) =>
        sql.startsWith("SELECT payloadHash")
      )
    ).toBe(false);
  });
  it("审计失败回滚资源和回执，不能报告创建成功", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    mocks.audit.mockRejectedValue(new Error("audit failed"));
    const command = input();
    await expect(createProjectResource(user, command)).rejects.toThrow(
      "audit failed"
    );
    expect(command.create).toHaveBeenCalledTimes(1);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
  it("重复名称映射为可处理冲突并回滚，不猜测同名记录就是原保存", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      createProjectResource(
        user,
        input(vi.fn().mockRejectedValue({ code: "ER_DUP_ENTRY", errno: 1062 }))
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("只重试已回滚的死锁，释放旧连接后重新确认账号和权限", async () => {
    const first = connection(),
      second = connection();
    mocks.getConnection
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const command = input(
      vi
        .fn()
        .mockRejectedValueOnce({ code: "ER_LOCK_DEADLOCK", errno: 1213 })
        .mockResolvedValue(undefined)
    );
    await createProjectResource(user, command);
    expect(first.rollback).toHaveBeenCalledTimes(1);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.commit).toHaveBeenCalledTimes(1);
    expect(mocks.access).toHaveBeenCalledTimes(2);
    expect(command.create).toHaveBeenCalledTimes(2);
    expect(first.release.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getConnection.mock.invocationCallOrder[1]
    );
  });
  it("死锁有三次上限，不无限占用请求", async () => {
    const conn = connection();
    mocks.getConnection.mockResolvedValue(conn);
    await expect(
      createProjectResource(
        user,
        input(vi.fn().mockRejectedValue({ errno: 1213 }))
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.getConnection).toHaveBeenCalledTimes(3);
    expect(conn.rollback).toHaveBeenCalledTimes(3);
    expect(conn.release).toHaveBeenCalledTimes(3);
  });
  it.each(["ECONNRESET", "ER_LOCK_WAIT_TIMEOUT"])(
    "提交结果不明或其他错误不盲目重试：%s",
    async code => {
      const conn = connection();
      conn.commit.mockRejectedValue({ code });
      mocks.getConnection.mockResolvedValue(conn);
      const command = input();
      await expect(createProjectResource(user, command)).rejects.toMatchObject({
        code,
      });
      expect(command.create).toHaveBeenCalledTimes(1);
      expect(mocks.getConnection).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
    }
  );
});
