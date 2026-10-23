import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getConnection: vi.fn(),
  access: vi.fn(),
  system: vi.fn(),
  audit: vi.fn(),
  approval: vi.fn(),
  project: vi.fn(),
  catalog: vi.fn(),
  units: vi.fn(),
}));
vi.mock("./db", () => ({
  getSharedPool: () => ({
    query: mocks.query,
    getConnection: mocks.getConnection,
  }),
}));
vi.mock("./iam-service", () => ({
  getWorkflowAccess: mocks.access,
  hasSystemPermission: mocks.system,
  recordAuthorizationAudit: mocks.audit,
  ensureIamCatalog: mocks.catalog,
}));
vi.mock("./p1-service", () => ({ isProjectApprovalRequired: mocks.approval }));
vi.mock("./project-service", () => ({
  ensureProjectUnitTable: mocks.units,
  getProjectAccess: mocks.project,
}));
import {
  archiveWorkflow,
  createWorkflow,
  duplicateWorkflow,
  emptyDefinition,
  restoreWorkflow,
  rollbackWorkflowVersion,
} from "./workflow-service";
let row: any, target: any, tx: any, actor: any;
const user = { id: 7, role: "user" as const, tokenVersion: 3 };
const all = [
  "workflow:view",
  "workflow:edit",
  "workflow:publish",
  "workflow:members:manage",
];
beforeEach(() => {
  vi.resetAllMocks();
  row = {
    id: "workflow-a",
    name: "当前流程",
    ownerUserId: 7,
    projectId: "project-a",
    definitionVersion: 4,
    status: "draft",
    archivedAt: null,
    auditStatus: "approved",
    definitionJson: JSON.stringify(emptyDefinition()),
    flowType: "state",
  };
  target = {
    name: "历史流程",
    status: "draft",
    definitionJson: JSON.stringify(emptyDefinition()),
  };
  actor = { id: 7, role: "user", status: "active", tokenVersion: 3 };
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set(all) });
  mocks.system.mockResolvedValue(true);
  mocks.project.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:workflow:create"]),
  });
  mocks.approval.mockResolvedValue(false);
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("FROM workflow_version") ? [[target]] : [[row]]
  );
  tx = {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: vi.fn(async (sql: string, values: any[]) => {
      if (sql.includes("FROM users")) return [[actor]];
      if (sql.includes("FROM flow_project"))
        return [[{ id: "project-a", status: "active" }]];
      if (
        sql.startsWith("SELECT * FROM workflow") ||
        sql.startsWith("SELECT w.*")
      )
        return [[row]];
      if (sql.startsWith("UPDATE workflow SET name=")) {
        row = {
          ...row,
          name: values[0],
          definitionJson: values[1],
          status: values[2],
          definitionVersion: values[3],
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO workflow (")) {
        row = {
          ...row,
          id: values[0],
          ownerUserId: values[1],
          projectId: values[2],
          name: values[5],
          definitionJson: values[11],
          definitionVersion: 1,
        };
        return [{ affectedRows: 1 }];
      }
      return [[]];
    }),
  };
  mocks.getConnection.mockResolvedValue(tx);
});
it("创建在锁后复核系统权限，失权不插入空流程", async () => {
  mocks.system.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(createWorkflow(user, "新流程")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  expect(
    tx.query.mock.calls.some(([sql]: [string]) => sql.startsWith("INSERT"))
  ).toBe(false);
  expect(tx.commit).not.toHaveBeenCalled();
});
it("项目创建权限必须来自锁内业务访问，不能由标志绕过", async () => {
  mocks.project.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:view"]),
  });
  await expect(
    createWorkflow(user, "新流程", undefined, { projectId: "project-a" })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    tx.query.mock.calls.some(([sql]: [string]) => sql.startsWith("INSERT"))
  ).toBe(false);
});
it("完整初始定义与版本、所有者和创建审计在同一事务返回", async () => {
  const definition = emptyDefinition();
  definition.nodes[0].name = "完整导入的起点";
  const result = await createWorkflow(user, "导入流程", undefined, {
    projectId: "project-a",
    definition,
  });
  expect(result.definitionVersion).toBe(1);
  expect(result.definition.nodes.find(node=>node.id==="start")?.name).toBe("完整导入的起点");
  expect(
    tx.query.mock.calls.filter(([sql]: [string]) =>
      sql.startsWith("INSERT INTO workflow_version")
    )
  ).toHaveLength(1);
  expect(mocks.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        operation: "project_workflow_created",
      }),
    }),
    tx
  );
  expect(tx.commit).toHaveBeenCalledOnce();
});
it.each(["create", "duplicate", "archive", "restore", "rollback"])(
  "%s 的审计失败不能提交业务与版本",
  async operation => {
    if (operation === "restore")
      row.archivedAt = new Date("2026-10-23T00:00:00Z");
    mocks.audit.mockRejectedValue(new Error("fixture audit failure"));
    await expect(
      operation === "create"
        ? createWorkflow(user, "新流程")
        : operation === "duplicate"
          ? duplicateWorkflow(row.id, user, "副本", 4)
          : operation === "archive"
            ? archiveWorkflow(row.id, user, 4)
            : operation === "restore"
              ? restoreWorkflow(row.id, user, 4)
              : rollbackWorkflowVersion(row.id, 1, user, 4, true)
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledOnce();
  }
);
it("已发布流程不能通过恢复草稿绕过发布权限", async () => {
  row.status = "published";
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view", "workflow:edit"]),
  });
  await expect(
    rollbackWorkflowVersion(row.id, 1, user, 4, true)
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.getConnection).not.toHaveBeenCalled();
});
it("未发布流程可由编辑者将历史发布版本恢复为草稿并重新审核", async () => {
  target.status = "published";
  const definition = emptyDefinition();
  definition.nodes[0].name = "历史定义";
  target.definitionJson = JSON.stringify(definition);
  mocks.approval.mockResolvedValue(true);
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["workflow:view", "workflow:edit"]),
  });
  const result = await rollbackWorkflowVersion(row.id, 1, user, 4, true);
  expect(result.status).toBe("draft");
  expect(result.definitionVersion).toBe(5);
  const write = tx.query.mock.calls.find(([sql]: [string]) =>
    sql.startsWith("UPDATE workflow SET name=")
  );
  expect(write[1][4]).toBe(true);
  expect(write[1][5]).toBe(null);
});
it("历史发布状态也必须满足当前审批规则，不能恢复旧审批通行", async () => {
  row.flowType = "control";
  target.status = "published";
  row.auditStatus = "init";
  mocks.approval.mockResolvedValue(true);
  await expect(
    rollbackWorkflowVersion(row.id, 1, user, 4)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    tx.query.mock.calls.some(([sql]: [string]) =>
      sql.startsWith("UPDATE workflow")
    )
  ).toBe(false);
  expect(tx.commit).not.toHaveBeenCalled();
});
it("客户端过期版本在恢复时明确冲突，不产生新版本", async () => {
  await expect(
    rollbackWorkflowVersion(row.id, 1, user, 3, true)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(mocks.getConnection).not.toHaveBeenCalled();
});
it("副本源版本在等待期间变化后不创建任何新行", async () => {
  const original = tx.query.getMockImplementation();
  tx.query.mockImplementation(async (sql: string, values: any[]) =>
    sql.startsWith("SELECT * FROM workflow")
      ? [[{ ...row, definitionVersion: 5 }]]
      : original(sql, values)
  );
  await expect(
    duplicateWorkflow(row.id, user, "副本", 4)
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    tx.query.mock.calls.some(([sql]: [string]) => sql.startsWith("INSERT"))
  ).toBe(false);
});

it("复制前失去查看权限返回403且不创建空副本",async()=>{
  mocks.access.mockResolvedValue({exists:true,permissions:new Set()});
  await expect(duplicateWorkflow(row.id,user,"副本",4)).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(mocks.getConnection).not.toHaveBeenCalled();
});

it.each(["state","control","data"])("%s 副本保留目录和有效数据源，并分配独立合法代号",async flowType=>{
 row.flowType=flowType;row.folderId="folder-a";row.dataSourceId=flowType==="data"?"data-a":null;
 const original=tx.query.getMockImplementation();
 tx.query.mockImplementation(async(sql:string,values:any[])=>sql.includes("FROM workflow_folder")||sql.includes("FROM data_source")?[[{id:values[0]}]]:original(sql,values));
 await duplicateWorkflow(row.id,user,undefined,4);
 const insert=tx.query.mock.calls.find(([sql]:[string])=>sql.startsWith("INSERT INTO workflow ("))[1];
 expect(insert[2]).toBe("project-a");expect(insert[3]).toBe("folder-a");expect(insert[4]).toMatch(/^CPY_[A-Z0-9_-]+$/);expect(insert[7]).toBe(flowType);expect(insert[9]).toBe(flowType==="data"?"data-a":null);
});

it("创建回执与审计使用相同事务，审计失败不会提交回执",async()=>{
 const original=tx.query.getMockImplementation();
 tx.query.mockImplementation(async(sql:string,values:any[])=>sql.includes("FROM workflow_creation_request")?[[]]:original(sql,values));
 mocks.audit.mockRejectedValue(new Error("audit fixture failure"));
 await expect(createWorkflow(user,"回执创建",undefined,{requestKey:"abcdef0123456789abcdef0123456789"})).rejects.toMatchObject({code:"INTERNAL_SERVER_ERROR"});
 expect(tx.query.mock.calls.filter(([sql]:[string])=>sql.startsWith("INSERT INTO workflow_creation_request"))).toHaveLength(1);
 expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({details:expect.objectContaining({creationRequestId:expect.any(String)})}),tx);
 expect(tx.commit).not.toHaveBeenCalled();expect(tx.rollback).toHaveBeenCalledOnce();
});
