import { afterEach, expect, it, vi } from "vitest";
const endpoint = vi.hoisted(() => vi.fn());
vi.mock("./service-endpoint-service", () => ({
  resolveProjectServiceEndpoint: endpoint,
}));
import { inspectWorkflowServiceConfiguration } from "./workflow-service-readiness";
afterEach(() => {
  vi.unstubAllEnvs();
  endpoint.mockReset();
});
const definition = {
  nodes: [
    {
      id: "http",
      name: "读取 Issue",
      type: "http",
      config: { endpointRef: "GITEA" },
    },
  ],
} as any;
it("运行前定位缺失密钥，返回配置指引且不泄露值", async () => {
  vi.stubEnv("FLOW_SECRET_READINESS_TEST", "");
  vi.stubEnv("FLOW_SECRET_FILE_DIR", "");
  endpoint.mockResolvedValue({
    baseUrl: "https://example.com",
    secretRef: "env:FLOW_SECRET_READINESS_TEST",
  });
  const issues = await inspectWorkflowServiceConfiguration(
    "project",
    definition
  );
  expect(issues[0].location).toMatchObject({
    nodeId: "http",
    field: "secretRef",
  });
  expect(issues[0].message).toContain("部署管理员");
  vi.stubEnv("FLOW_SECRET_READINESS_TEST", "do-not-expose-this-value");
  expect(
    await inspectWorkflowServiceConfiguration("project", definition)
  ).toEqual([]);
});
it("运行前报告端口策略，并允许已授权源站的无认证公开接口", async () => {
  vi.stubEnv("FLOW_HTTP_ALLOWED_ORIGINS", "");
  endpoint.mockResolvedValue({
    baseUrl: "http://example.com:3000",
    secretRef: null,
  });
  expect(
    (await inspectWorkflowServiceConfiguration("project", definition))[0]
      .message
  ).toContain("FLOW_HTTP_ALLOWED_ORIGINS");
  vi.stubEnv("FLOW_HTTP_ALLOWED_ORIGINS", "http://example.com:3000");
  expect(
    await inspectWorkflowServiceConfiguration("project", definition)
  ).toEqual([]);
});
