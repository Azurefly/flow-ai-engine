import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  query: vi.fn(),
  resources: vi.fn(),
}));
vi.mock("./project-service", () => ({ getProjectAccess: mocks.access }));
vi.mock("./db", () => ({ getSharedPool: () => ({ query: mocks.query }) }));
vi.mock("./dataflow-resource-readiness", () => ({
  dataflowResourceDiagnostics: mocks.resources,
}));
import {
  inspectWarehouseImport,
  previewWarehouseImport,
} from "./warehouse-import";
const definition = {
  schemaVersion: 1,
  nodes: [
    {
      id: "start",
      name: "开始",
      type: "start",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "end",
      name: "结束",
      type: "end",
      position: { x: 200, y: 0 },
      config: {},
    },
  ],
  edges: [{ id: "edge", sourceNodeId: "start", targetNodeId: "end" }],
  settings: {},
  viewport: { x: 0, y: 0, zoom: 1 },
};
const payload = {
  workflows: ["state", "control", "data"].map(flowType => ({
    name: flowType,
    flowType,
    definition,
    processCode: "DUPLICATE",
  })),
};
const user = { id: 7, role: "user" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:workflow:create"]),
  });
  mocks.query.mockResolvedValue([[]]);
  mocks.resources.mockResolvedValue([]);
});
it("三类流程均能预检，默认生成新代号且不保留发布状态和授权", () => {
  const items = inspectWarehouseImport(payload);
  expect(items.map(item => item.flowType)).toEqual([
    "state",
    "control",
    "data",
  ]);
  expect(
    items.every(
      item => item.definition && !item.errors.length && !item.processCode
    )
  ).toBe(true);
});
it("保留代号时对文件内重复代号标记全部冲突项", () => {
  const items = inspectWarehouseImport(payload, true);
  expect(
    items.every(item =>
      item.errors.some(message => message.includes("代号重复"))
    )
  ).toBe(true);
});
it("混合文件中后项无效也完整返回预检，不忽略类型错误或空定义", () => {
  const items = inspectWarehouseImport({
    workflows: [
      payload.workflows[0],
      { name: "错误类型", flowType: "future", definition },
      { name: "缺定义" },
    ],
  });
  expect(items[0].errors).toEqual([]);
  expect(items[1].errors.length).toBeGreaterThan(0);
  expect(items[2].errors).toEqual([expect.stringContaining("缺少流程定义")]);
});
it.each([
  { workflows: [] },
  { workflows: Array(101).fill(payload.workflows[0]) },
  { name: "x".repeat(1024 * 1024) },
])("拒绝空批次、过量或过大输入", input => {
  expect(() => inspectWarehouseImport(input)).toThrow();
});
it("业务创建权限不足时不读取导入文件或资源", async () => {
  mocks.access.mockResolvedValue({
    exists: true,
    permissions: new Set(["project:view"]),
  });
  await expect(
    previewWarehouseImport(user, { projectId: "project", payload })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.resources).not.toHaveBeenCalled();
});
it("同一业务已有代号（含归档）阻止原代号导入，仅执行只读查询", async () => {
  mocks.query.mockResolvedValue([[{ processCode: "DUPLICATE" }]]);
  const result = await previewWarehouseImport(user, {
    projectId: "project",
    payload: { workflows: [payload.workflows[0]] },
    preserveCodes: true,
  });
  expect(result.canImport).toBe(false);
  expect(result.items[0].errors[0]).toContain("含归档流程");
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("SELECT processCode"),
    ["project", ["DUPLICATE"]]
  );
});
it("数据资源问题作为草稿绑定清单，不冒充可执行或触发外部探测", async () => {
  mocks.resources.mockResolvedValue([{ message: "资源不属于当前业务" }]);
  const result = await previewWarehouseImport(user, {
    projectId: "target",
    payload,
  });
  expect(result.canImport).toBe(true);
  expect(result.items[2].warnings).toEqual(["资源不属于当前业务"]);
  expect(mocks.resources).toHaveBeenCalledWith(
    expect.anything(),
    "target",
    expect.objectContaining({ nodes: expect.any(Array) })
  );
  expect(mocks.query).not.toHaveBeenCalled();
});
