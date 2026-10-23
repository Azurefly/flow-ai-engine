import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  system: vi.fn(),
  project: vi.fn(),
  access: vi.fn(),
}));
vi.mock("./iam-service", () => ({
  hasSystemPermission: mocks.system,
  getWorkflowAccess: mocks.access,
}));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.project }));
import {
  prepareWorkflowCreationRequest,
  replayWorkflowCreationRequest,
  saveWorkflowCreationRequest,
  workflowConfigurationToken,
  assertWorkflowConfigurationToken,
} from "./workflow-creation-request";
const actor = { id: 7, role: "user" as const, tokenVersion: 3 };
const key = "abcdef0123456789abcdef0123456789";
let receipt: any, row: any, connection: any;
beforeEach(() => {
  vi.resetAllMocks();
  receipt = {
    requestKind: "project",
    payloadHash: prepareWorkflowCreationRequest(key, "project", {
      name: "新流程",
    })!.payloadHash,
    workflowId: "created",
    projectId: "project-a",
  };
  row = { id: "created", projectId: "project-a", archivedAt: null };
  mocks.system.mockResolvedValue(true);
  mocks.project.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:workflow:create"]),
  });
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view"]),
  });
  connection = {
    query: vi.fn(async (sql: string) =>
      sql.includes("FROM workflow_creation_request")
        ? [[receipt].filter(Boolean)]
        : sql.startsWith("SELECT w.*")
          ? [[row].filter(Boolean)]
          : [{ affectedRows: 1 }]
    ),
  };
});
it("旧API不写回执，非法请求标识在读库前拒绝", async () => {
  expect(
    prepareWorkflowCreationRequest(undefined, "global", {})
  ).toBeUndefined();
  for (const value of ["", "short", "a".repeat(97), "bad key with spaces"])
    expect(() => prepareWorkflowCreationRequest(value, "global", {})).toThrow(
      "标识无效"
    );
  await saveWorkflowCreationRequest(connection, actor, "created", null);
  expect(connection.query).not.toHaveBeenCalled();
});
it("只存哈希，稳定对象顺序但保留数组顺序和内容差异", () => {
  const first = prepareWorkflowCreationRequest(key, "global", {
    name: "流程",
    nodes: [1, 2],
  })!;
  expect(first.keyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(first.keyHash).not.toBe(key);
  expect(
    prepareWorkflowCreationRequest(key, "global", {
      nodes: [1, 2],
      name: "流程",
    })
  ).toEqual(first);
  expect(
    prepareWorkflowCreationRequest(key, "global", {
      name: "流程",
      nodes: [2, 1],
    })?.payloadHash
  ).not.toBe(first.payloadHash);
});
it("读取同一账号的回执时锁定行，重放返回原流程且不再写审计或版本", async () => {
  const request = prepareWorkflowCreationRequest(key, "project", {
    name: "新流程",
  });
  expect(
    await replayWorkflowCreationRequest(connection, actor, request)
  ).toEqual(row);
  expect(connection.query.mock.calls[0]).toEqual([
    expect.stringContaining("actorUserId=? AND requestKeyHash=? FOR UPDATE"),
    [7, request!.keyHash],
  ]);
  expect(
    connection.query.mock.calls.every(([sql]: [string]) =>
      sql.startsWith("SELECT")
    )
  ).toBe(true);
  expect(mocks.project).toHaveBeenCalledWith(actor, "project-a", {
    connection,
    lock: true,
  });
  expect(mocks.access).toHaveBeenCalledWith(actor, "created", {
    connection,
    lock: true,
  });
});
it.each(["kind", "payload"])("%s 不同的同标识请求明确冲突", async kind => {
  if (kind === "kind") receipt.requestKind = "duplicate";
  else receipt.payloadHash = "different";
  await expect(
    replayWorkflowCreationRequest(
      connection,
      actor,
      prepareWorkflowCreationRequest(key, "project", { name: "新流程" })
    )
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.access).not.toHaveBeenCalled();
});
it.each(["deleted", "archived", "moved"])(
  "已创建目标%s后不允许再创建",
  async kind => {
    if (kind === "deleted") row = null;
    if (kind === "archived") row.archivedAt = new Date();
    if (kind === "moved") row.projectId = "other";
    await expect(
      replayWorkflowCreationRequest(
        connection,
        actor,
        prepareWorkflowCreationRequest(key, "project", { name: "新流程" })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
);
it.each(["create", "view", "project"])("重放仍校验当前%s权限", async kind => {
  if (kind === "create")
    mocks.project.mockResolvedValue({ exists: true, permissions: new Set() });
  if (kind === "view")
    mocks.access.mockResolvedValue({ exists: true, permissions: new Set() });
  if (kind === "project")
    mocks.project.mockResolvedValue({ exists: false, permissions: new Set() });
  await expect(
    replayWorkflowCreationRequest(
      connection,
      actor,
      prepareWorkflowCreationRequest(key, "project", { name: "新流程" })
    )
  ).rejects.toMatchObject({
    code: kind === "project" ? "CONFLICT" : "FORBIDDEN",
  });
});
it("独立流程回执要求当前系统创建权限", async () => {
  receipt.projectId = null;
  row.projectId = null;
  receipt.requestKind = "global";
  mocks.system.mockResolvedValue(false);
  await expect(
    replayWorkflowCreationRequest(
      connection,
      actor,
      prepareWorkflowCreationRequest(key, "global", { name: "新流程" })
    )
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("无回执才进入正常创建，保存只使用调用者事务且不存原始输入", async () => {
  receipt = null;
  const request = prepareWorkflowCreationRequest(key, "project", {
    name: "新流程",
  });
  expect(
    await replayWorkflowCreationRequest(connection, actor, request)
  ).toBeNull();
  const id = await saveWorkflowCreationRequest(
    connection,
    actor,
    "created",
    "project-a",
    request
  );
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  const args = connection.query.mock.calls.at(-1)[1];
  expect(args).toEqual([
    id,
    7,
    "project-a",
    "project",
    request!.keyHash,
    request!.payloadHash,
    "created",
  ]);
  expect(JSON.stringify(args)).not.toContain("新流程");
});
it("配置令牌覆盖版本以外的目录、数据源、所有者与状态变化", () => {
  const source = {
    id: "source",
    name: "流程",
    projectId: "p",
    folderId: "folder",
    dataSourceId: "data",
    ownerUserId: 7,
    definitionVersion: 4,
    status: "draft",
  };
  const token = workflowConfigurationToken(source);
  expect(() =>
    assertWorkflowConfigurationToken(token, { ...source })
  ).not.toThrow();
  for (const field of Object.keys(source))
    expect(() =>
      assertWorkflowConfigurationToken(token, { ...source, [field]: "changed" })
    ).toThrow("配置已变化");
  expect(() =>
    assertWorkflowConfigurationToken(undefined, { ...source, name: "legacy" })
  ).not.toThrow();
});
