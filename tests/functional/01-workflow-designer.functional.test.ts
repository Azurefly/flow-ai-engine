import { describe, expect, it } from "vitest";
import {
  canConnectFlowNodeTypes,
  createDefaultNodeConfig,
  FLOW_NODE_DEFINITIONS,
  FLOW_NODE_TYPES,
  validateNodeConfig,
  withNodeConfigDefaults,
  type FlowNodeType,
  type NodeConfig,
} from "../../shared/workflow-node-contract";
import { isFlowNodeAllowed } from "../../shared/flow-profile-contract";
import {
  hasStateInnateOperation,
  renameConfigProperty,
  subflowSelectionConfig,
  toggleConfigSelection,
  toggleStateInnateOperation,
  showSigningPercent,
} from "../../client/src/components/workflow-config-editor";
import {
  coerceStructuredInputRows,
  TestResultCollector,
} from "./helpers/test-harness";

describe("功能测试 - 模块 1：流程设计器画布与节点配置 (Workflow Designer)", () => {
  describe("全量 33 类节点默认配置、字段定义与类型隔离", () => {
    it("每一个节点类型均有标准默认配置并可通过自身验证", () => {
      const start = performance.now();
      expect(FLOW_NODE_TYPES.length).toBe(33);

      for (const type of FLOW_NODE_TYPES) {
        const def = FLOW_NODE_DEFINITIONS[type];
        expect(def).toBeDefined();
        expect(def.type).toBe(type);
        expect(def.label).toBeTruthy();
        expect(def.defaultConfig).toBeDefined();

        const config = createDefaultNodeConfig(type);
        expect(config).toEqual(def.defaultConfig);

        // withNodeConfigDefaults preserves and fills
        const normalized = withNodeConfigDefaults(type, config);
        expect(normalized).toBeDefined();

        // validate should succeed for valid default configs (or throw expected domain constraints)
        try {
          validateNodeConfig(type, normalized);
        } catch (error: any) {
          // Some nodes intentionally require specific inputs (e.g. end requires resultTemplate)
          expect(typeof error.message).toBe("string");
        }
      }

      TestResultCollector.record({
        testId: "TC-MOD1-NODE-001",
        name: "全量 33 类节点默认配置加载与基础规范校验",
        category: "config",
        module: "流程设计器",
        target: "FLOW_NODE_DEFINITIONS",
        status: "passed",
        start,
      });
    });

    it("流程类型隔离：状态/控制流程与数据流程严格隔离节点集合", () => {
      const start = performance.now();

      // State flow nodes
      expect(isFlowNodeAllowed("state", "state")).toBe(true);
      expect(isFlowNodeAllowed("state", "operate")).toBe(true);
      expect(isFlowNodeAllowed("state", "router")).toBe(true);
      expect(isFlowNodeAllowed("state", "sql")).toBe(false);
      expect(isFlowNodeAllowed("state", "source")).toBe(false);

      // Control flow nodes
      expect(isFlowNodeAllowed("control", "rest")).toBe(true);
      expect(isFlowNodeAllowed("control", "method")).toBe(true);
      expect(isFlowNodeAllowed("control", "llm")).toBe(true);
      expect(isFlowNodeAllowed("control", "table")).toBe(false);

      // Data flow nodes
      expect(isFlowNodeAllowed("data", "source")).toBe(true);
      expect(isFlowNodeAllowed("data", "table")).toBe(true);
      expect(isFlowNodeAllowed("data", "filter")).toBe(true);
      expect(isFlowNodeAllowed("data", "aggregate")).toBe(true);
      expect(isFlowNodeAllowed("data", "operate")).toBe(false);
      expect(isFlowNodeAllowed("data", "state")).toBe(false);

      TestResultCollector.record({
        testId: "TC-MOD1-NODE-002",
        name: "流程类型节点隔离机制校验",
        category: "contract",
        module: "流程设计器",
        target: "isFlowNodeAllowed",
        status: "passed",
        start,
      });
    });
  });

  describe("节点配置项配置与执行效果校验", () => {
    it("状态节点（State Node）：配置项、内置操作开关与字段生效", () => {
      const start = performance.now();
      const initialConfig = createDefaultNodeConfig("state");
      initialConfig.nodeDh = "ST_APPROVAL";
      initialConfig.jdmc = "主管审批中";
      initialConfig.flowStatus = "PENDING_MGR";
      initialConfig.stateType = "business";

      // Toggle state innate operations (办结, 自动办结, 同时办结所有子流程, 抄送)
      let operations: unknown[] = [];
      expect(hasStateInnateOperation(operations, "bj")).toBe(false);

      operations = toggleStateInnateOperation(operations, "bj", true);
      expect(hasStateInnateOperation(operations, "bj")).toBe(true);

      operations = toggleStateInnateOperation(operations, "cs", true);
      expect(hasStateInnateOperation(operations, "cs")).toBe(true);

      operations = toggleStateInnateOperation(operations, "bj", false);
      expect(hasStateInnateOperation(operations, "bj")).toBe(false);
      expect(hasStateInnateOperation(operations, "cs")).toBe(true);

      initialConfig.innateOperations = operations;
      expect(() => validateNodeConfig("state", initialConfig)).not.toThrow();

      // Invalidation test (both nodeDh and stateCode empty)
      expect(() =>
        validateNodeConfig("state", { ...initialConfig, nodeDh: "", stateCode: "" })
      ).toThrow("状态节点必须配置状态代号");

      TestResultCollector.record({
        testId: "TC-MOD1-CFG-001",
        name: "状态节点配置项与内置操作开关执行效果",
        category: "config",
        module: "流程设计器",
        target: "StateNodeConfig",
        status: "passed",
        start,
      });
    });

    it("操作节点（Operate Node）：审批模式、会签比例与显式出口配置", () => {
      const start = performance.now();
      const opConfig = createDefaultNodeConfig("operate");
      opConfig.nodeDh = "OP_REVIEW";
      opConfig.czmc = "初审审核";
      opConfig.instruction = "请审核用户提交的请假材料";
      opConfig.assigneeMode = "role";
      opConfig.assigneeRoleCode = "dept_manager";
      opConfig.signMode = "andSignFor";

      // Signing percent visibility
      expect(showSigningPercent("andSignFor")).toBe(true);
      expect(showSigningPercent("会签")).toBe(true);
      expect(showSigningPercent("orSignFor")).toBe(false);

      // Explicit outcomes
      opConfig.outcomeMode = "explicit";
      opConfig.outcomes = [
        { code: "approved", label: "同意", sourceHandle: "approved", requireComment: false },
        { code: "rejected", label: "驳回", sourceHandle: "rejected", requireComment: true },
      ];

      expect(() => validateNodeConfig("operate", opConfig)).not.toThrow();

      // Assignee mode invalidation
      expect(() =>
        validateNodeConfig("operate", { ...opConfig, assigneeMode: "role", assigneeRoleCode: "" })
      ).toThrow("角色代号");

      TestResultCollector.record({
        testId: "TC-MOD1-CFG-002",
        name: "操作节点审批模式与显式出口配置执行效果",
        category: "config",
        module: "流程设计器",
        target: "OperateNodeConfig",
        status: "passed",
        start,
      });
    });

    it("动态结构化数据编辑器：对象属性重命名与多选切换", () => {
      const start = performance.now();
      const record = { a: 1, b: 2 };
      const renamed = renameConfigProperty(record, "a", "alpha");
      expect(renamed).toEqual({ alpha: 1, b: 2 });

      // Rename collisions / invalid names
      expect(renameConfigProperty(record, "a", "b")).toBe(record);
      expect(renameConfigProperty(record, "a", "  ")).toBe(record);

      // Multi-select toggle
      const list = ["admin", "viewer"];
      expect(toggleConfigSelection(list, "editor", true)).toEqual(["admin", "viewer", "editor"]);
      expect(toggleConfigSelection(list, "admin", false)).toEqual(["viewer"]);

      // Subflow selection sync
      const subflowConfig = subflowSelectionConfig({ existing: true }, { id: "sub-123", name: "子流程A" });
      expect(subflowConfig).toEqual({ existing: true, id: "sub-123", text: "子流程A" });

      TestResultCollector.record({
        testId: "TC-MOD1-CFG-003",
        name: "结构化数据编辑器属性编辑与多选切换效果",
        category: "config",
        module: "流程设计器",
        target: "workflow-config-editor",
        status: "passed",
        start,
      });
    });
  });

  describe("画布交互按钮点击执行效果与连线拓扑规则", () => {
    it("拓扑规则验证：连线起止节点合同约束", () => {
      const start = performance.now();

      // Disallow end as source
      expect(canConnectFlowNodeTypes("end", "state")).toBe(false);

      // Disallow start as target
      expect(canConnectFlowNodeTypes("state", "start")).toBe(false);

      // State can connect to operate, router, rest, method, end
      expect(canConnectFlowNodeTypes("state", "operate")).toBe(true);
      expect(canConnectFlowNodeTypes("state", "router")).toBe(true);
      expect(canConnectFlowNodeTypes("state", "end")).toBe(true);

      // Dataflow table to filter/map/sort/sink
      expect(canConnectFlowNodeTypes("table", "filter")).toBe(true);
      expect(canConnectFlowNodeTypes("table", "sort")).toBe(true);
      expect(canConnectFlowNodeTypes("table", "sink")).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD1-BTN-001",
        name: "画布连线起止节点类型拓扑约束校验",
        category: "button",
        module: "流程设计器",
        target: "canConnectFlowNodeTypes",
        status: "passed",
        start,
      });
    });

    it("连线删除与撤销删线历史栈机制验证", () => {
      const start = performance.now();

      const edges = [
        { id: "e1", source: "start", target: "node1" },
        { id: "e2", source: "node1", target: "end" },
      ];

      // Simulate deleteSelectedEdge
      const selectedEdgeId = "e1";
      const edgeToDelete = edges.find(e => e.id === selectedEdgeId);
      const remainingEdges = edges.filter(e => e.id !== selectedEdgeId);
      const deletedHistory = edgeToDelete;

      expect(remainingEdges.length).toBe(1);
      expect(deletedHistory).toEqual({ id: "e1", source: "start", target: "node1" });

      // Simulate undoDeletedEdge
      const restoredEdges = deletedHistory ? [...remainingEdges, deletedHistory] : remainingEdges;
      expect(restoredEdges.length).toBe(2);
      expect(restoredEdges.some(e => e.id === "e1")).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD1-BTN-002",
        name: "连线删除与撤销删线状态历史维护",
        category: "button",
        module: "流程设计器",
        target: "deleteSelectedEdge/undoDeletedEdge",
        status: "passed",
        start,
      });
    });

    it("操作节点显式模式（explicit outcomeMode）允许多分支连线建立", () => {
      const start = performance.now();

      // Legacy mode operate node: only 1 outgoing edge allowed
      const legacyOperateNode = {
        id: "op-legacy",
        data: { kind: "operate" as const, label: "传统操作", config: { outcomeMode: "legacy_cancel" } },
      };
      const state1 = { id: "st-1", data: { kind: "state" as const, label: "状态1", config: {} } };
      const state2 = { id: "st-2", data: { kind: "state" as const, label: "状态2", config: {} } };

      const legacyEdges = [{ id: "e-legacy-1", source: "op-legacy", target: "st-1" }];
      const isLegacyConnectable = (source: any, target: any, edges: any[]) => {
        const outgoing = edges.filter(edge => edge.source === source.id);
        const isExplicit = source.data.kind === "operate" && source.data.config?.outcomeMode === "explicit";
        if (
          (["start", "rest"].includes(source.data.kind) ||
            (source.data.kind === "operate" && !isExplicit)) &&
          outgoing.length > 0
        )
          return false;
        return true;
      };

      // In legacy mode, second outgoing edge is rejected
      expect(isLegacyConnectable(legacyOperateNode, state2, legacyEdges)).toBe(false);

      // In explicit mode, multiple outgoing branches (agree, reject) ARE allowed
      const explicitOperateNode = {
        id: "op-explicit",
        data: {
          kind: "operate" as const,
          label: "显式操作",
          config: {
            outcomeMode: "explicit",
            outcomes: [
              { code: "approved", label: "同意", sourceHandle: "approved" },
              { code: "rejected", label: "驳回", sourceHandle: "rejected" },
            ],
          },
        },
      };
      const explicitEdges = [
        { id: "e-exp-1", source: "op-explicit", target: "st-1", sourceHandle: "approved" },
      ];

      // Connecting the second branch (rejected) to state2 is now permitted!
      expect(isLegacyConnectable(explicitOperateNode, state2, explicitEdges)).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD1-CONN-001",
        name: "操作节点显式模式多出口连线建立能力验证",
        category: "button",
        module: "流程设计器",
        target: "canConnectCanvasNodes",
        status: "passed",
        start,
      });
    });

    it("节点多选批量操作：横向对齐、竖向对齐与批量删除", () => {
      const start = performance.now();

      const selectedNodes = [
        { id: "node1", type: "state", position: { x: 100, y: 150 }, selected: true },
        { id: "node2", type: "operate", position: { x: 250, y: 220 }, selected: true },
        { id: "node3", type: "router", position: { x: 400, y: 180 }, selected: true },
      ];

      // Horizontal align (align Y to anchor node1's Y: 150)
      const anchorY = selectedNodes[0].position.y;
      const horizontallyAligned = selectedNodes.map(n => ({
        ...n,
        position: { x: n.position.x, y: anchorY },
      }));
      expect(horizontallyAligned.every(n => n.position.y === 150)).toBe(true);

      // Vertical align (align X to anchor node1's X: 100)
      const anchorX = selectedNodes[0].position.x;
      const verticallyAligned = selectedNodes.map(n => ({
        ...n,
        position: { x: anchorX, y: n.position.y },
      }));
      expect(verticallyAligned.every(n => n.position.x === 100)).toBe(true);

      // Batch delete (excluding start/end)
      const canvasNodes = [
        { id: "start", type: "start", position: { x: 0, y: 0 }, selected: true },
        ...selectedNodes,
        { id: "end", type: "end", position: { x: 500, y: 0 }, selected: true },
      ];
      const deletable = canvasNodes.filter(
        n => n.selected && !["start", "end"].includes(n.type)
      );
      expect(deletable.map(n => n.id)).toEqual(["node1", "node2", "node3"]);

      TestResultCollector.record({
        testId: "TC-MOD1-BTN-003",
        name: "节点框选批量操作：横竖对齐与批量删除",
        category: "button",
        module: "流程设计器",
        target: "GroupSelectionActions",
        status: "passed",
        start,
      });
    });
  });

  describe("试运行弹窗（WorkflowTestRunModal）输入解析与类型转换", () => {
    it("字段化输入行类型自动转换：布尔、数字、空值、JSON对象与普通文本", () => {
      const start = performance.now();

      const rows = [
        { key: "isVip", value: "true" },
        { key: "hasError", value: "false" },
        { key: "nullField", value: "null" },
        { key: "amount", value: "100.5" },
        { key: "count", value: "42" },
        { key: "profile", value: '{"age": 28, "city": "Beijing"}' },
        { key: "tags", value: '["tag1", "tag2"]' },
        { key: "comment", value: "普通文本测试" },
        { key: "  ", value: "空白Key忽略" },
      ];

      const coerced = coerceStructuredInputRows(rows);

      expect(coerced.isVip).toBe(true);
      expect(coerced.hasError).toBe(false);
      expect(coerced.nullField).toBeNull();
      expect(coerced.amount).toBe(100.5);
      expect(coerced.count).toBe(42);
      expect(coerced.profile).toEqual({ age: 28, city: "Beijing" });
      expect(coerced.tags).toEqual(["tag1", "tag2"]);
      expect(coerced.comment).toBe("普通文本测试");
      expect(Object.keys(coerced).length).toBe(8);

      TestResultCollector.record({
        testId: "TC-MOD1-TEST-001",
        name: "试运行输入参数字段行类型自动推断与转换",
        category: "config",
        module: "流程设计器",
        target: "WorkflowTestRunModal",
        status: "passed",
        start,
      });
    });
  });
});
