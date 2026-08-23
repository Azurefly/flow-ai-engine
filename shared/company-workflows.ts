/**
 * 公司演示流程定义。
 *
 * 所有定义都遵循参考项目的“状态 → 操作 → 路由 → 状态”结构：操作节点
 * 负责产生待办，路由节点只做安全条件/角色匹配，后继状态记录每一位参与人的
 * 当前状态。定义不包含任意脚本，能够直接通过服务端发布校验。
 */

type Route = {
  handle: string;
  label: string;
  roleKeys?: string[];
  targetNodeId: string;
  priority: number;
  conditions?: Array<{ left: unknown; operator: string; right?: unknown }>;
  isDefault?: boolean;
};

const state = (id: string, name: string, status: string, x: number, y: number) => ({
  id,
  type: "state" as const,
  name,
  position: { x, y },
  config: { nodeDh: id.toUpperCase(), jdmc: status, flowStatus: status, stateType: "business", stateColor: status.includes("通过") ? "#16a34a" : "#2563eb" },
});

const routeConfig = (code: string, name: string, routes: Route[], broadcast = false) => ({
  nodeDh: code,
  lymc: name,
  gbms: broadcast,
  defaultRoute: routes.find(route => route.isDefault)?.handle ?? routes[0]?.handle ?? "default",
  routes,
});

const approvalConfig = (code: string, name: string, roleCode: string, signMode: "single" | "orSignFor" | "andSignFor", instruction: string) => ({
  nodeDh: code,
  czmc: "审核通过",
  assigneeMode: "role",
  assigneeRoleCode: roleCode,
  pendingStatusName: "待审批",
  instruction,
  bdcz: { bdcz: [], bdczjs: ["acceptor"], hqhqsz: signMode, xzdfhq: {}, hqtgbfb: signMode === "andSignFor" ? 100 : undefined },
});

export function createResignationApprovalDefinition(roleCode = "company_hr_approver") {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 0.8 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 0, y: 180 }, config: { initialVariables: { resignationReason: "{{input.resignationReason}}" } } },
      state("resignation-application", "辞职申请", "申请中", 180, 180),
      { id: "submit", type: "operate", name: "提交辞职申请", position: { x: 390, y: 180 }, config: { nodeDh: "RESIGN_SUBMIT", czmc: "提交申请", assigneeMode: "none", instruction: "员工提交辞职申请", zdzx: { sfzdzx: "是" } } },
      { id: "route-submit", type: "router", name: "辞职审批路由", position: { x: 610, y: 180 }, config: routeConfig("RESIGN_ROUTE", "辞职审批路由", [{ handle: "approver", label: "审批人状态", roleKeys: [roleCode], targetNodeId: "resign-pending", priority: 300 }, { handle: "employee", label: "员工状态", roleKeys: ["default"], targetNodeId: "employee-resign-wait", priority: 200 }]) },
      state("employee-resign-wait", "员工等待审批", "等待审核", 850, 60),
      state("resign-pending", "多人辞职待审批", "待审批", 850, 300),
      { id: "resign-approve", type: "operate", name: "多人审批辞职", position: { x: 1100, y: 180 }, config: approvalConfig("RESIGN_APPROVE", "多人审批辞职", roleCode, "andSignFor", "请 HR 审核员工辞职申请") },
      { id: "route-approved", type: "router", name: "辞职结果分流", position: { x: 1330, y: 180 }, config: routeConfig("RESIGN_RESULT", "辞职结果分流", [{ handle: "approver", label: "审批完成", roleKeys: [roleCode], targetNodeId: "approver-resigned", priority: 300 }, { handle: "employee", label: "员工已通过", roleKeys: ["default"], targetNodeId: "employee-resigned", priority: 200 }]) },
      state("employee-resigned", "员工辞职已通过", "申请通过", 1570, 60),
      state("approver-resigned", "审批完成", "已审核", 1570, 300),
      { id: "end", type: "end", name: "结束", position: { x: 1810, y: 180 }, config: { resultTemplate: { status: "{{nodes.employee-resigned.flowStatus}}", resignationReason: "{{vars.resignationReason}}" } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "resignation-application" },
      { id: "e2", sourceNodeId: "resignation-application", targetNodeId: "submit" },
      { id: "e3", sourceNodeId: "submit", targetNodeId: "route-submit" },
      { id: "e4", sourceNodeId: "route-submit", sourceHandle: "employee", targetNodeId: "employee-resign-wait" },
      { id: "e5", sourceNodeId: "route-submit", sourceHandle: "approver", targetNodeId: "resign-pending" },
      { id: "e6", sourceNodeId: "employee-resign-wait", targetNodeId: "resign-approve" },
      { id: "e7", sourceNodeId: "resign-pending", targetNodeId: "resign-approve" },
      { id: "e8", sourceNodeId: "resign-approve", targetNodeId: "route-approved" },
      { id: "e9", sourceNodeId: "route-approved", sourceHandle: "employee", targetNodeId: "employee-resigned" },
      { id: "e10", sourceNodeId: "route-approved", sourceHandle: "approver", targetNodeId: "approver-resigned" },
      { id: "e11", sourceNodeId: "employee-resigned", targetNodeId: "end" },
      { id: "e12", sourceNodeId: "approver-resigned", targetNodeId: "end" },
    ],
  };
}

export function createReportingApprovalDefinition(roleCode = "company_reporting_approver") {
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 0.8 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 0, y: 180 }, config: { initialVariables: { reportTitle: "{{input.reportTitle}}" } } },
      state("report-application", "汇报申请", "申请中", 180, 180),
      { id: "submit", type: "operate", name: "提交汇报", position: { x: 390, y: 180 }, config: { nodeDh: "REPORT_SUBMIT", czmc: "提交汇报", assigneeMode: "none", instruction: "员工提交多人汇报申请", zdzx: { sfzdzx: "是" } } },
      { id: "route-submit", type: "router", name: "汇报人员路由", position: { x: 610, y: 180 }, config: routeConfig("REPORT_ROUTE", "汇报人员路由", [{ handle: "approver", label: "汇报审批人", roleKeys: [roleCode], targetNodeId: "report-pending", priority: 300 }, { handle: "employee", label: "员工查看", roleKeys: ["default"], targetNodeId: "employee-report-wait", priority: 200 }]) },
      state("employee-report-wait", "员工等待汇报审批", "等待审核", 850, 60),
      state("report-pending", "汇报待审批", "待审批", 850, 300),
      { id: "report-approve", type: "operate", name: "汇报会签", position: { x: 1100, y: 180 }, config: approvalConfig("REPORT_APPROVE", "汇报会签", roleCode, "orSignFor", "任一汇报负责人确认即可") },
      { id: "route-approved", type: "router", name: "汇报结果路由", position: { x: 1330, y: 180 }, config: routeConfig("REPORT_RESULT", "汇报结果路由", [{ handle: "approver", label: "负责人已审核", roleKeys: [roleCode], targetNodeId: "report-approved", priority: 300 }, { handle: "employee", label: "员工已确认", roleKeys: ["default"], targetNodeId: "employee-report-approved", priority: 200 }]) },
      state("employee-report-approved", "员工汇报已通过", "申请通过", 1570, 60),
      state("report-approved", "负责人已审核", "已审核", 1570, 300),
      { id: "end", type: "end", name: "结束", position: { x: 1810, y: 180 }, config: { resultTemplate: { status: "{{nodes.employee-report-approved.flowStatus}}", reportTitle: "{{vars.reportTitle}}" } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "report-application" },
      { id: "e2", sourceNodeId: "report-application", targetNodeId: "submit" },
      { id: "e3", sourceNodeId: "submit", targetNodeId: "route-submit" },
      { id: "e4", sourceNodeId: "route-submit", sourceHandle: "employee", targetNodeId: "employee-report-wait" },
      { id: "e5", sourceNodeId: "route-submit", sourceHandle: "approver", targetNodeId: "report-pending" },
      { id: "e6", sourceNodeId: "employee-report-wait", targetNodeId: "report-approve" },
      { id: "e7", sourceNodeId: "report-pending", targetNodeId: "report-approve" },
      { id: "e8", sourceNodeId: "report-approve", targetNodeId: "route-approved" },
      { id: "e9", sourceNodeId: "route-approved", sourceHandle: "employee", targetNodeId: "employee-report-approved" },
      { id: "e10", sourceNodeId: "route-approved", sourceHandle: "approver", targetNodeId: "report-approved" },
      { id: "e11", sourceNodeId: "employee-report-approved", targetNodeId: "end" },
      { id: "e12", sourceNodeId: "report-approved", targetNodeId: "end" },
    ],
  };
}

export function createAnnualLeaveApprovalDefinition(roleCode = "company_leave_approver") {
  const routes: Route[] = [
    { handle: "short", label: "3天以内", conditions: [{ left: "{{input.days}}", operator: "lessThan", right: 4 }], targetNodeId: "short-pending", priority: 200 },
    { handle: "long", label: "3天以上", conditions: [{ left: "{{input.days}}", operator: "greaterThan", right: 3 }], targetNodeId: "long-pending", priority: 190 },
    { handle: "default", label: "默认短假", isDefault: true, targetNodeId: "short-pending", priority: -1 },
  ];
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 0.8 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 0, y: 180 }, config: { initialVariables: { days: "{{input.days}}", annualLeaveReason: "{{input.reason}}" } } },
      state("annual-application", "年假申请", "申请中", 180, 180),
      { id: "submit", type: "operate", name: "提交年假申请", position: { x: 390, y: 180 }, config: { nodeDh: "ANNUAL_SUBMIT", czmc: "提交申请", assigneeMode: "none", instruction: "员工提交年假天数和事由", zdzx: { sfzdzx: "是" } } },
      { id: "route-days", type: "router", name: "按天数分流", position: { x: 610, y: 180 }, config: routeConfig("ANNUAL_DAYS_ROUTE", "按天数分流", routes) },
      state("short-pending", "短假待审批", "待直属上级审批", 850, 60),
      state("long-pending", "长假待审批", "待直属上级和经理审批", 850, 300),
      { id: "supervisor-approve", type: "operate", name: "直属上级审批", position: { x: 1100, y: 180 }, config: approvalConfig("ANNUAL_SUPERVISOR", "直属上级审批", roleCode, "single", "审核年假申请") },
      { id: "route-after-supervisor", type: "router", name: "短长假审批路由", position: { x: 1330, y: 180 }, config: routeConfig("ANNUAL_AFTER_SUPERVISOR", "短长假审批路由", [{ handle: "short", label: "短假完成", conditions: [{ left: "{{input.days}}", operator: "lessThan", right: 4 }], targetNodeId: "short-approved", priority: 200 }, { handle: "long", label: "长假加签经理", conditions: [{ left: "{{input.days}}", operator: "greaterThan", right: 3 }], targetNodeId: "long-manager-pending", priority: 190 }, { handle: "default", label: "默认短假", isDefault: true, targetNodeId: "short-approved", priority: -1 }]) },
      state("short-approved", "短假申请通过", "申请通过", 1570, 60),
      state("long-manager-pending", "长假经理待审批", "待经理审批", 1570, 300),
      { id: "manager-approve", type: "operate", name: "经理审批年假", position: { x: 1810, y: 300 }, config: approvalConfig("ANNUAL_MANAGER", "经理审批年假", roleCode, "single", "长假需经理追加审批") },
      state("long-approved", "长假申请通过", "申请通过", 2050, 300),
      { id: "end", type: "end", name: "结束", position: { x: 2290, y: 180 }, config: { resultTemplate: { status: "申请通过", days: "{{vars.days}}", reason: "{{vars.annualLeaveReason}}" } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "annual-application" },
      { id: "e2", sourceNodeId: "annual-application", targetNodeId: "submit" },
      { id: "e3", sourceNodeId: "submit", targetNodeId: "route-days" },
      { id: "e4", sourceNodeId: "route-days", sourceHandle: "short", targetNodeId: "short-pending" },
      { id: "e5", sourceNodeId: "route-days", sourceHandle: "long", targetNodeId: "long-pending" },
      { id: "e6", sourceNodeId: "route-days", sourceHandle: "default", targetNodeId: "short-pending" },
      { id: "e7", sourceNodeId: "short-pending", targetNodeId: "supervisor-approve" },
      { id: "e8", sourceNodeId: "long-pending", targetNodeId: "supervisor-approve" },
      { id: "e9", sourceNodeId: "supervisor-approve", targetNodeId: "route-after-supervisor" },
      { id: "e10", sourceNodeId: "route-after-supervisor", sourceHandle: "short", targetNodeId: "short-approved" },
      { id: "e11", sourceNodeId: "route-after-supervisor", sourceHandle: "long", targetNodeId: "long-manager-pending" },
      { id: "e12", sourceNodeId: "route-after-supervisor", sourceHandle: "default", targetNodeId: "short-approved" },
      { id: "e13", sourceNodeId: "long-manager-pending", targetNodeId: "manager-approve" },
      { id: "e14", sourceNodeId: "manager-approve", targetNodeId: "long-approved" },
      { id: "e15", sourceNodeId: "short-approved", targetNodeId: "end" },
      { id: "e16", sourceNodeId: "long-approved", targetNodeId: "end" },
    ],
  };
}
