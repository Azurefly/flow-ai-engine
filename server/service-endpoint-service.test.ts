import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeServiceEndpointDefinition,
  resolveExternalSecret,
} from "./service-endpoint-service";
import { assertProjectServiceTaskReferences } from "./workflow-service";

describe("项目 EndpointRef 与 SecretRef 安全边界", () => {
  afterEach(() => delete process.env.FLOW_SECRET_TEST_TOKEN);

  it("只接受标准端口、无内嵌凭据的端点和外部密钥引用", () => {
    expect(
      normalizeServiceEndpointDefinition({
        refCode: "crm_api",
        baseUrl: "https://api.example.com/v1/",
        secretRef: "env:FLOW_SECRET_TEST_TOKEN",
        authHeaderName: "Authorization",
        authScheme: "Bearer",
      })
    ).toMatchObject({
      refCode: "CRM_API",
      allowedHosts: ["api.example.com"],
      secretRef: "env:FLOW_SECRET_TEST_TOKEN",
    });
    expect(() =>
      normalizeServiceEndpointDefinition({
        refCode: "BAD",
        baseUrl: "https://user:password@example.com/",
      })
    ).toThrow("无内嵌凭据");
    expect(() =>
      normalizeServiceEndpointDefinition({
        refCode: "BAD_SECRET",
        baseUrl: "https://example.com/",
        secretRef: "env:PATH",
      })
    ).toThrow("FLOW_SECRET");
  });

  it("只从受限命名空间读取密钥且不返回引用以外的信息", () => {
    process.env.FLOW_SECRET_TEST_TOKEN = "runtime-only-value";
    expect(resolveExternalSecret("env:FLOW_SECRET_TEST_TOKEN")).toBe(
      "runtime-only-value"
    );
    expect(() => resolveExternalSecret("env:PATH")).toThrow("命名空间");
  });

  it("项目流程发布时禁止服务节点绕过 EndpointRef", () => {
    const definition = {
      schemaVersion: 1 as const,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "request",
          type: "http" as const,
          name: "调用 CRM",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "/customers", endpointRef: "CRM_API" },
        },
      ],
      edges: [],
    };
    expect(() => assertProjectServiceTaskReferences(definition)).not.toThrow();
    expect(() =>
      assertProjectServiceTaskReferences({
        ...definition,
        nodes: [{ ...definition.nodes[0]!, config: { method: "GET", url: "https://outside.example.com" } }],
      })
    ).toThrow("必须配置项目 EndpointRef");
  });
});
