import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  access: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({ getConnection: mocks.connect }),
}));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
import {
  cancelDataflowRun,
  canCancelDataflowRun,
} from "./dataflow-run-control";
import type { ProjectPermission } from "./project-service";

const user = { id: 7, role: "user" as const, tokenVersion: 4 };
const input = {
  projectId: "project-owned",
  runId: "run-owned",
  reason: "  选择了错误的样本，请保留既有结果。  ",
};
let actor: any, run: any, job: any, session: boolean;
const permissions = (...items: ProjectPermission[]) => new Set(items);
beforeEach(() => {
  vi.resetAllMocks();
  actor = { ...user, status: "active", name: "测试运行者" };
  run = {
    id: input.runId,
    status: "running",
    triggeredByUserId: 7,
    executionSource: "published_plan",
  };
  job = { id: "job-owned", status: "leased" };
  session = true;
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    beginTransaction: vi.fn(),
    commit: mocks.commit,
    rollback: mocks.rollback,
    release: mocks.release,
  });
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: permissions("project:view", "project:workflow:run"),
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users WHERE")) return [actor ? [actor] : []];
    if (sql.includes("FROM auth_session"))
      return [session ? [{ id: "session-owned" }] : []];
    if (sql.includes("FROM flow_project"))
      return [[{ id: input.projectId, status: "active" }]];
    if (sql.startsWith("SELECT j.id")) return [job ? [job] : []];
    if (sql.startsWith("SELECT id,status,triggered")) return [run ? [run] : []];
    return [{ affectedRows: 1 }];
  });
});
const writes = () =>
  mocks.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE)/.test(sql));

it.each(["queued", "running"])(
  "%s取消在同一事务结束Job/运行/活动节点并记录一份审计",
  async status => {
    run.status = status;
    job.status = status === "queued" ? "queued" : "leased";
    expect(await cancelDataflowRun(user, input, "local-session-token")).toEqual(
      { runId: input.runId, status: "cancelled", outcome: "cancelled" }
    );
    expect(writes()).toHaveLength(4);
    expect(writes()[0][0]).toContain(
      "leaseToken=NULL,leaseExpiresAt=NULL,workerId=NULL"
    );
    expect(writes()[2][0]).toContain("AND status='running'");
    const metadata = JSON.parse(writes()[1][1][0]);
    expect(metadata).toMatchObject({
      actorUserId: 7,
      actorLabel: "测试运行者",
      reason: input.reason.trim(),
    });
    expect(new Date(metadata.cancelledAt).toString()).not.toBe("Invalid Date");
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
    const calls = mocks.query.mock.calls.map(([sql]) => sql);
    expect(calls.findIndex(sql => sql.startsWith("SELECT j.id"))).toBeLessThan(
      calls.findIndex(sql => sql.startsWith("SELECT id,status,triggered"))
    );
    const sessionChecks = mocks.query.mock.calls.filter(([sql]) =>
      sql.includes("FROM auth_session")
    );
    expect(sessionChecks).toHaveLength(2);
    expect(sessionChecks[0][1]).toEqual([
      7,
      createHash("sha256").update("local-session-token").digest("hex"),
    ]);
    expect(JSON.stringify(writes())).not.toContain("local-session-token");
    expect(mocks.access.mock.calls.at(-1)?.[2]).toMatchObject({ lock: true });
  }
);
it.each(["cancelled", "success", "failed"])(
  "%s保持真实终态且不重复写入或审计",
  async status => {
    run.status = status;
    expect(await cancelDataflowRun(user, input, "session")).toMatchObject({
      status,
      outcome:
        status === "cancelled" ? "already_cancelled" : "already_finished",
    });
    expect(writes()).toHaveLength(0);
    expect(mocks.commit).toHaveBeenCalledOnce();
  }
);
it.each(["success", "failed", "cancelled", "running"])(
  "他人%s运行不因终态或重试绕过权限",
  async status => {
    run.status = status;
    run.triggeredByUserId = 8;
    await expect(
      cancelDataflowRun(user, input, "session")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes()).toHaveLength(0);
  }
);
it("管理员资格来自锁后的DB角色，不能信任调用前的角色", async () => {
  actor.role = "user";
  await cancelDataflowRun({ ...user, role: "admin" }, input, "session");
  expect(mocks.access.mock.calls.at(-1)?.[0]).toEqual({ id: 7, role: "user" });
});
it("管理者可取消本业务他人运行，草稿设计者可取消自己的草稿测试", async () => {
  run.triggeredByUserId = 8;
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: permissions("project:view", "project:manage"),
  });
  await expect(
    cancelDataflowRun(user, input, "session")
  ).resolves.toMatchObject({ status: "cancelled" });
  run.triggeredByUserId = 7;
  run.executionSource = "draft";
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: permissions("project:view", "project:workflow:edit"),
  });
  await expect(
    cancelDataflowRun(user, input, "session")
  ).resolves.toMatchObject({ status: "cancelled" });
});
it.each(["viewer", "designer", "expired_grant", "revoked_after_wait"])(
  "%s不能取消正式运行",
  async variant => {
    const denied = {
      exists: true,
      permissions: permissions(
        "project:view",
        ...(variant === "designer" ? ["project:workflow:edit" as const] : [])
      ),
    };
    if (variant === "revoked_after_wait" || variant === "expired_grant")
      mocks.access
        .mockResolvedValueOnce({
          exists: true,
          permissions: permissions("project:view", "project:workflow:run"),
        })
        .mockResolvedValueOnce(denied);
    else mocks.access.mockResolvedValue(denied);
    await expect(
      cancelDataflowRun(user, input, "session")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes()).toHaveLength(0);
    expect(mocks.rollback).toHaveBeenCalledOnce();
  }
);
it.each(["disabled", "missing", "token_version"])(
  "%s账号变化在写入前拒绝",
  async variant => {
    if (variant === "missing") actor = null;
    else if (variant === "disabled") actor.status = "disabled";
    else actor.tokenVersion++;
    await expect(
      cancelDataflowRun(user, input, "session")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(writes()).toHaveLength(0);
  }
);
it.each(["revoked", "expired_during_lock_wait"])(
  "%s会话不能取消",
  async variant => {
    if (variant === "revoked") session = false;
    else
      mocks.access.mockImplementation(async (_u, _p, options) => {
        if (options.lock) session = false;
        return {
          exists: true,
          permissions: permissions("project:view", "project:workflow:run"),
        };
      });
    await expect(
      cancelDataflowRun(user, input, "session")
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(writes()).toHaveLength(0);
  }
);
it("业务不存在/归档或跨业务实例不会写入", async () => {
  run = null;
  await expect(cancelDataflowRun(user, input, "session")).rejects.toMatchObject(
    { code: "NOT_FOUND" }
  );
  expect(writes()).toHaveLength(0);
  expect(
    mocks.query.mock.calls.find(([sql]) => sql.startsWith("SELECT j.id"))?.[1]
  ).toEqual([input.runId, input.projectId]);
});
it("Job缺失/终态不一致不能生成伪取消", async () => {
  job.status = "completed";
  await expect(cancelDataflowRun(user, input, "session")).rejects.toMatchObject(
    { code: "CONFLICT" }
  );
  expect(writes()).toHaveLength(0);
});
it("审计失败使全部取消写入回滚，不能先提交取消再单独审计", async () => {
  const original = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (...args) => {
    if (String(args[0]).startsWith("INSERT INTO authorization_audit_log"))
      throw new Error("audit unavailable");
    return original(...args);
  });
  await expect(cancelDataflowRun(user, input, "session")).rejects.toThrow(
    "audit unavailable"
  );
  expect(mocks.commit).not.toHaveBeenCalled();
  expect(mocks.rollback).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it("缺会话或无有效原因时不取得数据库连接", async () => {
  await expect(cancelDataflowRun(user, input, undefined)).rejects.toMatchObject(
    { code: "UNAUTHORIZED" }
  );
  for (const reason of [" ", "长".repeat(501)])
    await expect(
      cancelDataflowRun(user, { ...input, reason }, "session")
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.connect).not.toHaveBeenCalled();
});
it("设计者可取消自己以编辑权限测试的已发布计划，提示能力与事务一致", async () => {
  run.admissionPermission = "project:workflow:edit";
  const granted = permissions("project:view", "project:workflow:edit");
  mocks.access.mockResolvedValue({ exists: true, permissions: granted });
  expect(canCancelDataflowRun(user.id, granted, run)).toBe(true);
  await expect(cancelDataflowRun(user, input, "session")).resolves.toMatchObject({
    status: "cancelled",
  });
  expect(writes()).toHaveLength(4);
});
it.each([
  ["project:workflow:run", "project:workflow:edit"],
  ["project:workflow:edit", "project:workflow:run"],
  ["project:manage", "project:workflow:edit"],
  ["", "project:workflow:run"],
])("准入权限%s不能由当前%s替代或被未知元数据放开", async (required, current) => {
  run.admissionPermission = required;
  const granted = permissions("project:view", current as ProjectPermission);
  mocks.access.mockResolvedValue({ exists: true, permissions: granted });
  expect(canCancelDataflowRun(user.id, granted, run)).toBe(false);
  await expect(cancelDataflowRun(user, input, "session")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(writes()).toHaveLength(0);
});
it("测试运行等待锁后仍重新检查编辑权限，不能沿用过期权限", async () => {
  run.admissionPermission = "project:workflow:edit";
  mocks.access.mockResolvedValueOnce({ exists: true, permissions: permissions("project:view", "project:workflow:edit") })
    .mockResolvedValueOnce({ exists: true, permissions: permissions("project:view") });
  await expect(cancelDataflowRun(user, input, "session")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(writes()).toHaveLength(0);
});
it("同为设计者仍不能取消他人的已发布测试", async () => {
  run.admissionPermission = "project:workflow:edit";
  run.triggeredByUserId = 8;
  mocks.access.mockResolvedValue({ exists: true, permissions: permissions("project:view", "project:workflow:edit") });
  await expect(cancelDataflowRun(user, input, "session")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(writes()).toHaveLength(0);
});
it("界面能力保留终态/本人/草稿与正式权限边界", () => {
  const own = {
    status: "running",
    triggeredByUserId: 7,
    executionSource: "published_plan",
  };
  expect(canCancelDataflowRun(7, permissions("project:view"), own)).toBe(false);
  expect(
    canCancelDataflowRun(7, permissions("project:workflow:run"), own)
  ).toBe(true);
  expect(
    canCancelDataflowRun(8, permissions("project:workflow:run"), own)
  ).toBe(false);
  expect(canCancelDataflowRun(8, permissions("project:manage"), own)).toBe(
    true
  );
  expect(
    canCancelDataflowRun(7, permissions("project:workflow:edit"), {
      ...own,
      executionSource: "draft",
    })
  ).toBe(true);
  expect(
    canCancelDataflowRun(7, permissions("project:manage"), {
      ...own,
      status: "cancelled",
    })
  ).toBe(false);
});
