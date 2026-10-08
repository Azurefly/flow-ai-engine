import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ endpoint: vi.fn(), secret: vi.fn() }));
vi.mock("./service-endpoint-service", () => ({
  resolveProjectServiceEndpoint: mocks.endpoint,
  resolveExternalSecret: mocks.secret,
}));
import { executeSubflowNode } from "./workflow-engine";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.endpoint.mockRejectedValue(
    new Error("项目 EndpointRef 不存在或已停用。")
  );
});
const snapshot = (type: string) => ({
  subflowId: "private-child",
  resolvedSubflowDefinition: {
    schemaVersion: 1,
    settings: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "start", type: "start", config: {} },
      {
        id: "service",
        type,
        config:
          type === "http"
            ? { endpointRef: "CHILD_API", url: "/status", method: "GET" }
            : { endpointRef: "CHILD_API", restApi: "/status", restType: "GET" },
      },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { sourceNodeId: "start", targetNodeId: "service" },
      { sourceNodeId: "service", targetNodeId: "end" },
    ],
  },
});
it.each(["http", "rest", "method"])(
  "子流程 %s 节点使用父流程项目解析端点",
  async type => {
    await expect(
      executeSubflowNode(snapshot(type), { input: {} }, 7, "parent-project")
    ).rejects.toThrow("项目 EndpointRef 不存在或已停用");
    expect(mocks.endpoint).toHaveBeenCalledTimes(1);
    expect(mocks.endpoint).toHaveBeenCalledWith("parent-project", "CHILD_API");
    expect(mocks.secret).not.toHaveBeenCalled();
  }
);
it("非项目父流程不能凭空取得项目端点上下文", async () => {
  await expect(
    executeSubflowNode(snapshot("http"), { input: {} }, 7)
  ).rejects.toThrow("非项目流程不能引用项目");
  expect(mocks.endpoint).not.toHaveBeenCalled();
});
