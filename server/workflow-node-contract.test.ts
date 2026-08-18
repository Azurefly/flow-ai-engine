import { createDefaultNodeConfig, getNodeConfigEvidence, validateNodeConfig, withNodeConfigDefaults } from "@shared/workflow-node-contract";
import { describe, expect, it } from "vitest";
import { emptyDefinition, validate } from "./workflow-service";

describe("原始节点配置统一契约", () => {
  it("为开始、结束、状态、操作、路由、REST、表单、SQL、条件、LLM 和子流程提供可追溯默认字段", () => {
    expect(createDefaultNodeConfig("start")).toMatchObject({ initialVariables: {} });
    expect(createDefaultNodeConfig("end")).toMatchObject({ resultTemplate: "{{vars}}" });
    expect(createDefaultNodeConfig("state")).toMatchObject({ stateCode: "STATE_CODE", displayName: "业务状态", stateType: "business" });
    expect(createDefaultNodeConfig("operate")).toMatchObject({ commandCode: "COMMAND_CODE", assigneeMode: "role", instruction: expect.any(String) });
    expect(createDefaultNodeConfig("router")).toMatchObject({ routes: [], defaultRoute: "default" });
    expect(createDefaultNodeConfig("rest")).toMatchObject({ endpoint: "", method: "POST", headers: {}, body: {}, timeout: 15000 });
    expect(createDefaultNodeConfig("form")).toMatchObject({ fields: [] });
    expect(createDefaultNodeConfig("sql")).toMatchObject({ datasourceId: "", statement: expect.stringContaining("SELECT"), parameters: {} });
    expect(createDefaultNodeConfig("condition")).toMatchObject({ left: "{{input.value}}", operator: "equals", trueHandle: "true", falseHandle: "false" });
    expect(createDefaultNodeConfig("llm")).toMatchObject({ systemPrompt: expect.any(String), prompt: "{{input.prompt}}", maxTokens: 1024 });
    expect(createDefaultNodeConfig("subflow")).toMatchObject({ subflowId: "", input: "{{input}}" });
  });

  it("允许保存未完整配置的设计草稿，但在创建可执行定义时精确阻断缺失字段", () => {
    const draft = emptyDefinition();
    draft.nodes.splice(1, 0, { id: "rest", type: "rest", name: "REST", position: { x: 240, y: 120 }, config: createDefaultNodeConfig("rest") });
    draft.edges = [{ id: "start-rest", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "rest" }, { id: "rest-end", sourceNodeId: "rest", sourceHandle: "default", targetNodeId: "end" }];
    expect(() => validate(draft)).not.toThrow();
    expect(() => validate(draft, true)).toThrow("REST 节点必须配置请求地址");
  });

  it("保留历史或安装包导入定义的未知字段，同时填充缺失的已知默认值", () => {
    const merged = withNodeConfigDefaults("state", { stateCode: "APPROVED", originalExtension: { color: "#3370ED" } });
    expect(merged).toMatchObject({ stateCode: "APPROVED", displayName: "业务状态", stateType: "business", originalExtension: { color: "#3370ED" } });
    expect(getNodeConfigEvidence("rest")).toBe("compatibility-extension");
  });

  it("严格验证路由分支、表单结构、REST 方法和条件句柄", () => {
    expect(() => validateNodeConfig("router", { routes: [{ handle: "approve", condition: { left: "{{input.status}}", operator: "equals", right: "approved" } }], defaultRoute: "reject" })).not.toThrow();
    expect(() => validateNodeConfig("router", { routes: [{ label: "缺少句柄" }], defaultRoute: "default" })).toThrow("路由规则必须配置分支句柄");
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", label: "原因", type: "textarea", required: true }] })).not.toThrow();
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", label: "原因", type: "textarea", required: "true" }] })).toThrow("required 必须是布尔值");
    expect(() => validateNodeConfig("rest", { endpoint: "https://example.com", method: "TRACE", headers: {} })).toThrow("请求方法不受支持");
    expect(() => validateNodeConfig("condition", { left: "{{input.ok}}", operator: "equals", right: true, trueHandle: "yes", falseHandle: "no" })).not.toThrow();
    expect(() => validateNodeConfig("condition", { left: "{{input.ok}}", operator: "invalid", right: true, trueHandle: "yes", falseHandle: "no" })).toThrow("条件节点操作符无效");
  });

  it("兼容安装包历史定义中的对象结束模板、简写表单字段和 code/target 路由", () => {
    expect(() => validateNodeConfig("end", { resultTemplate: { result: "{{vars.value}}" } })).not.toThrow();
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", required: true }] })).not.toThrow();
    expect(() => validateNodeConfig("router", { defaultRoute: "default", routes: [{ code: "default", target: "end" }] })).not.toThrow();
    expect(withNodeConfigDefaults("end", { resultTemplate: undefined }).resultTemplate).toBe("{{vars}}");
  });
});
