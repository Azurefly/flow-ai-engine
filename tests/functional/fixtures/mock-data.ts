import {
  FLOW_NODE_TYPES,
  createDefaultNodeConfig,
  type FlowNodeType,
  type NodeConfig,
} from "../../../shared/workflow-node-contract";

export const MOCK_ADMIN_USER = {
  id: 1,
  username: "admin",
  name: "系统管理员",
  role: "admin" as const,
};

export const MOCK_OPERATOR_USER = {
  id: 2,
  username: "operator_zhang",
  name: "张操作员",
  role: "user" as const,
};

export const MOCK_DESIGNER_USER = {
  id: 3,
  username: "designer_li",
  name: "李设计员",
  role: "user" as const,
};

export const MOCK_APPROVER_USER = {
  id: 4,
  username: "manager_wang",
  name: "王经理",
  role: "user" as const,
};

export const VALID_CSV_BUSINESS_DATA = `业务代号,业务名称,工作域代号,业务说明
HR_OPS,人力资源运营,HR,处理员工入转调离等内部流程
FIN_SETTLE,财务结算中心,FIN,集团各业务线费用结算与审批
SUPPLY_CHAIN,供应链管理系统,,管理仓储、物流与采购订单流程`;

export const INVALID_CSV_MISSING_HEADER = `部门代号,部门名称,说明
DEPT_A,部门A,无业务代号和业务名称列`;

export const INVALID_CSV_DUPLICATE_CODE = `业务代号,业务名称,工作域代号,业务说明
DUPLICATE_CODE,业务1,,说明1
DUPLICATE_CODE,业务2,,说明2`;

export const INVALID_CSV_UNKNOWN_DOMAIN = `业务代号,业务名称,工作域代号,业务说明
TEST_BIZ,测试业务,NON_EXISTENT_DOMAIN_XYZ,关联不存在的工作域`;

export function createMinimalWorkflowDefinition(
  nodes: Array<{ id: string; type: FlowNodeType; name?: string; config?: NodeConfig }>,
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; sourceHandle?: string }>
) {
  return {
    schemaVersion: 1 as const,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      name: n.name ?? n.id,
      position: { x: 100, y: 100 },
      config: n.config ?? createDefaultNodeConfig(n.type),
    })),
    edges: edges.map(e => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
    })),
  };
}
