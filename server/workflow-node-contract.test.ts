import { createDefaultNodeConfig, getNodeConfigEvidence, validateNodeConfig, withNodeConfigDefaults } from "@shared/workflow-node-contract";
import { describe, expect, it } from "vitest";
import { emptyDefinition, validate } from "./workflow-service";

describe("原始节点配置统一契约", () => {
  it("为开始、结束、状态、操作、路由、REST、方法、表单、SQL、条件、LLM 和子流程提供可追溯默认字段", () => {
    expect(createDefaultNodeConfig("start")).toMatchObject({ initialVariables: {} });
    expect(createDefaultNodeConfig("end")).toMatchObject({ resultTemplate: "{{vars}}" });
    expect(createDefaultNodeConfig("state")).toMatchObject({ stateCode: "STATE_CODE", displayName: "业务状态", stateType: "business" });
    expect(createDefaultNodeConfig("operate")).toMatchObject({ commandCode: "COMMAND_CODE", assigneeMode: "receivers", instruction: expect.any(String) });
    expect(createDefaultNodeConfig("router")).toMatchObject({ routes: [], defaultRoute: "default" });
    expect(createDefaultNodeConfig("rest")).toMatchObject({ nodeDh: "", restmc: "", restApi: "", restType: "POST", restHeaderParam: [{ key: "", value: "" }], timeout: 15000 });
    expect(createDefaultNodeConfig("method")).toMatchObject({ nodeDh: "", restmc: "", restApi: "", restType: "POST", restAttributeMap: { valid: false, suspend: true, async: false } });
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
    expect(getNodeConfigEvidence("rest")).toBe("reference-confirmed");
    expect(getNodeConfigEvidence("method")).toBe("reference-confirmed");
  });

  it("严格验证路由分支、表单结构、REST 方法和条件句柄", () => {
    expect(() => validateNodeConfig("router", { routes: [{ handle: "approve", condition: { left: "{{input.status}}", operator: "equals", right: "approved" } }], defaultRoute: "reject" })).not.toThrow();
    expect(() => validateNodeConfig("router", { routes: [{ label: "缺少句柄" }], defaultRoute: "default" })).toThrow("路由规则必须配置分支句柄");
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", label: "原因", type: "textarea", required: true }] })).not.toThrow();
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", label: "原因", type: "textarea", required: "true" }] })).toThrow("required 必须是布尔值");
    expect(() => validateNodeConfig("rest", { endpoint: "https://example.com", method: "TRACE", headers: {} })).toThrow("请求方法不受支持");
    expect(() => validateNodeConfig("rest", { restApi: "https://example.com/api", restType: "GET", restHeaderParam: [{ key: "x-token", value: "demo" }] })).not.toThrow();
    expect(() => validateNodeConfig("method", { restApi: "https://example.com/method", restType: "POST", restHeaderParam: [] })).not.toThrow();
    expect(() => validateNodeConfig("condition", { left: "{{input.ok}}", operator: "equals", right: true, trueHandle: "yes", falseHandle: "no" })).not.toThrow();
    expect(() => validateNodeConfig("condition", { left: "{{input.ok}}", operator: "invalid", right: true, trueHandle: "yes", falseHandle: "no" })).toThrow("条件节点操作符无效");
  });

  it("接纳结构化原版权限配置，但继续阻止任意代码和未迁移路由被静默执行", () => {
    expect(() => validateNodeConfig("operate", withNodeConfigDefaults("operate", {
      nodeDh: "APPROVE",
      czmc: "审批",
      qxkz: [{ qxid: "legacy-auth", qxmc: "原版权限" }],
    }))).not.toThrow();
    expect(() => validateNodeConfig("operate", withNodeConfigDefaults("operate", { nodeDh: "ROLE_APPROVE", assigneeMode: "role", assigneeRoleCode: "" }))).toThrow("必须配置角色代号");
    expect(() => validateNodeConfig("operate", withNodeConfigDefaults("operate", {
      nodeDh: "AND_SIGN",
      bdcz: { bdcz: [], bdczjs: ["acceptor"], hqhqsz: "andSignFor", xzdfhq: {}, hqtgbfb: 101 },
    }))).toThrow("会签通过百分比必须在 1 至 100 之间");
    expect(() => validateNodeConfig("operate", withNodeConfigDefaults("operate", {
      nodeDh: "AUTO_CODE",
      zdzx: { sfzdzx: "是", tjsz: [], code: ["return true;"] },
    }))).toThrow("自动执行代码尚未迁移为安全条件");
    expect(() => validateNodeConfig("operate", withNodeConfigDefaults("operate", {
      nodeDh: "AUTO_CONDITION",
      zdzx: { sfzdzx: "是", tjsz: [{ left: "{{input.days}}", operator: "lessThan", right: 3 }], code: [] },
    }))).not.toThrow();
    expect(() => validateNodeConfig("router", withNodeConfigDefaults("router", {
      nodeDh: "ROUTE1",
      lymc: "旧路由",
      lysz: [{ routerTargetyId: "approved", route: { routerJavaCode: "return true;" } }],
      routes: [],
    }))).toThrow("必须迁移为安全路由规则");
    expect(() => validateNodeConfig("router", withNodeConfigDefaults("router", {
      nodeDh: "ROUTE_SAFE",
      lymc: "原版安全路由",
      lysz: [{ routerTargetyId: "approved", route: { routerRuleId: "rule-1", routerRulePriority: 100, routerTargetId: "approved", routerAuthGroups: [{ authReceiver: { receiverRole: ["manager"] } }] } }],
      routes: [],
    }))).not.toThrow();
    expect(() => validateNodeConfig("rest", withNodeConfigDefaults("rest", {
      nodeDh: "REST1",
      restmc: "旧校验",
      restApi: "https://example.com/api",
      restScriptCode: "return response.code == 0;",
    }))).toThrow("尚未隔离迁移");
    expect(() => validateNodeConfig("router", withNodeConfigDefaults("router", {
      nodeDh: "ROUTE2",
      lymc: "已迁移路由",
      lysz: [{ routerTargetyId: "approved", route: { routerJavaCode: "legacy" } }],
      routes: [{ handle: "approved", condition: { left: "{{input.status}}", operator: "equals", right: "approved" } }],
    }))).not.toThrow();
  });

  it("兼容安装包历史定义中的对象结束模板、简写表单字段和 code/target 路由", () => {
    expect(() => validateNodeConfig("end", { resultTemplate: { result: "{{vars.value}}" } })).not.toThrow();
    expect(() => validateNodeConfig("form", { fields: [{ key: "reason", required: true }] })).not.toThrow();
    expect(() => validateNodeConfig("router", { defaultRoute: "default", routes: [{ code: "default", target: "end" }] })).not.toThrow();
    expect(withNodeConfigDefaults("end", { resultTemplate: undefined }).resultTemplate).toBe("{{vars}}");
  });

  it("填充原版 REST 默认值时保留未知安装包字段", () => {
    const merged = withNodeConfigDefaults("rest", { restApi: "https://example.com/api", originalExtension: { responseMode: "legacy" } });
    expect(merged).toMatchObject({ restApi: "https://example.com/api", restType: "POST", originalExtension: { responseMode: "legacy" } });
  });
});
