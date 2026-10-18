import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  poolQuery: vi.fn(),
  acquire: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  catalog: vi.fn(),
  permission: vi.fn(),
  audit: vi.fn(),
  events: [] as string[],
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.poolQuery,
    getConnection: mocks.acquire,
  }),
}));
vi.mock("./iam-service", () => ({
  ensureIamCatalog: mocks.catalog,
  hasSystemPermission: mocks.permission,
  recordAuthorizationAudit: mocks.audit,
}));
import { createUser } from "./internal-auth";

const connection = {
  query: mocks.query,
  beginTransaction: mocks.begin,
  commit: mocks.commit,
  rollback: mocks.rollback,
  release: mocks.release,
};
const input = {
  username: "New.User",
  name: "事务测试人员",
  password: "Test9_transaction_password",
};
const context = { actorUserId: 7, details: { source: "ai_batch_preview" } };
const deadlock = { code: "ER_LOCK_DEADLOCK", errno: 1213 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.events = [];
  mocks.acquire.mockImplementation(async () => {
    mocks.events.push("acquire");
    return connection;
  });
  mocks.catalog.mockImplementation(async () => {
    mocks.events.push("catalog");
  });
  mocks.begin.mockImplementation(async () => {
    mocks.events.push("begin");
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT")) {
      mocks.events.push("actor_lock");
      return [[{ id: 7, role: "user", status: "active" }], []];
    }
    mocks.events.push("insert");
    return [{ insertId: 42 }, []];
  });
  mocks.permission.mockResolvedValue(true);
  mocks.audit.mockImplementation(async () => {
    mocks.events.push("audit");
  });
  mocks.commit.mockImplementation(async () => {
    mocks.events.push("commit");
  });
  mocks.rollback.mockImplementation(async () => {
    mocks.events.push("rollback");
  });
  mocks.release.mockImplementation(() => {
    mocks.events.push("release");
  });
});

describe("账号创建与审计事务", () => {
  it("操作人停用后重新启用也不能使用旧会话创建", async () => {
    mocks.query.mockResolvedValueOnce([
      [{ id: 7, role: "user", status: "active", tokenVersion: 3 }],
      [],
    ]);
    await expect(
      createUser(input, { ...context, actorTokenVersion: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalledOnce();
  });

  it("创建弹窗在提交期间通过原生字段集锁定所有子控件", () => {
    const source = readFileSync(
      "client/src/components/CreationDialog.tsx",
      "utf8"
    );
    expect(source).toMatch(
      /<fieldset\s+disabled=\{pending\}[\s\S]*?\{children\}[\s\S]*?<\/fieldset>/
    );
  });

  it("先锁操作人再创建，审计与账号在同一连接提交", async () => {
    expect(await createUser(input, context)).toBe(42);
    expect(mocks.events).toEqual([
      "catalog",
      "acquire",
      "begin",
      "actor_lock",
      "insert",
      "audit",
      "commit",
      "release",
    ]);
    expect(mocks.query.mock.calls[0]).toEqual([
      "SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE",
      [7],
    ]);
    expect(mocks.permission).toHaveBeenCalledWith(
      { id: 7, role: "user" },
      "iam:manage",
      connection
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 7,
        targetUserId: 42,
        resourceId: "42",
        action: "user_created",
        details: context.details,
      }),
      connection
    );
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.rollback).not.toHaveBeenCalled();
    const values = mocks.query.mock.calls[1][1];
    expect(values[2]).not.toBe(input.password);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(
      input.password
    );
  });

  it("审计失败回滚账号，不返回创建成功", async () => {
    const failure = new Error("audit unavailable");
    mocks.audit.mockRejectedValueOnce(failure);
    await expect(createUser(input, context)).rejects.toBe(failure);
    expect(mocks.events).toEqual([
      "catalog",
      "acquire",
      "begin",
      "actor_lock",
      "insert",
      "rollback",
      "release",
    ]);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each(["disabled", "missing", "revoked"])(
    "%s 操作人不能留下新账号",
    async mode => {
      if (mode !== "revoked")
        mocks.query.mockResolvedValueOnce([
          mode === "missing"
            ? []
            : [{ id: 7, role: "user", status: "disabled" }],
          [],
        ]);
      else mocks.permission.mockResolvedValueOnce(false);
      await expect(createUser(input, context)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocks.query).toHaveBeenCalledOnce();
      expect(mocks.audit).not.toHaveBeenCalled();
      expect(mocks.commit).not.toHaveBeenCalled();
      expect(mocks.rollback).toHaveBeenCalledOnce();
    }
  );

  it("死锁时重试整个已回滚事务，复用已计算的密码哈希", async () => {
    mocks.audit.mockRejectedValueOnce(deadlock);
    expect(await createUser(input, context)).toBe(42);
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledTimes(2);
    const inserts = mocks.query.mock.calls.filter(call =>
      call[0].startsWith("INSERT")
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual(inserts[1][1]);
    expect(mocks.events.indexOf("release")).toBeLessThan(
      mocks.events.lastIndexOf("acquire")
    );
  });

  it("锁操作人时发生死锁也会重试，失败尝试不创建账号", async () => {
    mocks.query.mockRejectedValueOnce({ errno: 1213 });
    expect(await createUser(input, context)).toBe(42);
    expect(
      mocks.query.mock.calls.filter(call => call[0].startsWith("INSERT"))
    ).toHaveLength(1);
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it("连续死锁有界结束，回滚三次并给出可重试提示", async () => {
    mocks.audit.mockRejectedValue(deadlock);
    await expect(createUser(input, context)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("本次账号未创建"),
    });
    expect(mocks.acquire).toHaveBeenCalledTimes(3);
    expect(mocks.rollback).toHaveBeenCalledTimes(3);
    expect(mocks.release).toHaveBeenCalledTimes(3);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("用户名冲突保留原提示，不盲目重试", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT"))
        return [[{ id: 7, role: "admin", status: "active" }], []];
      throw {
        code: "ER_DUP_ENTRY",
        errno: 1062,
        message: "Duplicate entry for key 'users_username_unique'",
      };
    });
    await expect(createUser(input, context)).rejects.toThrow("用户名已存在");
    expect(mocks.acquire).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("锁等待超时不按死锁重试，仍回滚释放", async () => {
    const failure = { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 };
    mocks.audit.mockRejectedValueOnce(failure);
    await expect(createUser(input, context)).rejects.toBe(failure);
    expect(mocks.acquire).toHaveBeenCalledOnce();
    expect(mocks.rollback).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("初始化失败不持有事务连接", async () => {
    mocks.catalog.mockRejectedValueOnce(new Error("catalog unavailable"));
    await expect(createUser(input, context)).rejects.toThrow(
      "catalog unavailable"
    );
    expect(mocks.acquire).not.toHaveBeenCalled();
  });
});
