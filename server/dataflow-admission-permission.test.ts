import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), ready: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({ getConnection: async () => ({ query: mocks.query, beginTransaction: vi.fn(), commit: mocks.commit, rollback: mocks.rollback, release: mocks.release }) }) }));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
vi.mock("./dataflow-resource-readiness", () => ({ assertDataflowResourcesReady: mocks.ready }));
import { compileDataflowExecutionPlan, runDataflow } from "./p2-service";

const definition = {
  schemaVersion: 1 as const, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
  nodes: [
    { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: {} },
    { id: "source", type: "source", name: "样本", position: { x: 200, y: 0 }, config: { assetId: "asset" } },
    { id: "end", type: "end", name: "结束", position: { x: 400, y: 0 }, config: {} },
  ],
  edges: [ { id: "a", sourceNodeId: "start", targetNodeId: "source" }, { id: "b", sourceNodeId: "source", targetNodeId: "end" } ],
};
let workflow: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  const compiled = compileDataflowExecutionPlan(definition);
  workflow = { id: "workflow", projectId: "project", flowType: "data", status: "published", definitionVersion: 3, definitionJson: definition, publishedExecutionPlanJson: compiled.plan, publishedExecutionPlanHash: compiled.planHash };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users WHERE")) return [[{ id: 7, role: "user", status: "active", tokenVersion: 1 }]];
    if (sql.includes("FROM flow_project")) return [[{ id: "project", status: "active" }]];
    if (sql.includes("SELECT * FROM workflow")) return [[workflow]];
    return [{ affectedRows: 1 }];
  });
});

it.each([
  { mode: "test" as const, triggerType: "manual" as const, expected: "project:workflow:edit" },
  { mode: "formal" as const, triggerType: "manual" as const, expected: "project:workflow:run" },
  { mode: undefined, triggerType: "manual" as const, expected: "project:workflow:run" },
  { mode: "formal" as const, triggerType: "schedule" as const, expected: "project:workflow:edit" },
])("$triggerType/$mode记录实际核对的$expected，业务数据不能伪造", async ({ mode, triggerType, expected }) => {
  mocks.access.mockResolvedValue({ exists: true, permissions: new Set(["project:view", expected]) });
  const data = { admissionPermission: expected === "project:workflow:edit" ? "project:workflow:run" : "project:workflow:edit", mode: "spoofed", payload: 42 };
  await expect(runDataflow({ id: 7, role: "user", tokenVersion: 1 }, { projectId: "project", workflowId: "workflow", triggerType, mode, data })).resolves.toMatchObject({ status: "queued" });
  const [sql, values] = mocks.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO dataflow_run ("))!;
  const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",");
  const bound = (name: string) => values[columns.slice(0, columns.indexOf(name)).filter((column: string) => column !== "status").length];
  expect(bound("admissionPermission")).toBe(expected);
  expect(bound("executionSource")).toBe("published_plan");
  expect(JSON.parse(bound("inputJson"))).toEqual(data);
  expect(mocks.access.mock.calls.at(-1)?.[2]).toMatchObject({ lock: true });
  expect(mocks.commit).toHaveBeenCalledOnce();
  expect(mocks.rollback).not.toHaveBeenCalled();
});

it("实际准入权限已撤销时不会创建带可信权限标记的运行", async () => {
  mocks.access.mockResolvedValueOnce({ exists: true, permissions: new Set(["project:workflow:edit"]) })
    .mockResolvedValueOnce({ exists: true, permissions: new Set(["project:view"]) });
  await expect(runDataflow({ id: 7, role: "user" }, { projectId: "project", workflowId: "workflow", mode: "test" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO dataflow_run"))).toBe(false);
  expect(mocks.rollback).toHaveBeenCalledOnce();
});
