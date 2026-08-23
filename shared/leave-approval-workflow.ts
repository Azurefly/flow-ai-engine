/**
 * 可重复使用的请假审批状态流定义。
 *
 * 结构遵循参考项目的“状态 -> 操作 -> 路由 -> 多个人员状态”模型：操作节点补充
 * 参与人和临时流程身份，路由节点按身份把同一运行中的员工、直属上级、经理分别
 * 送入不同状态，再汇合到下一项审批操作。
 */
export function createLeaveApprovalDefinition() {
  const roleChange = (roleKey: string) => [{ pzlx: "赋予", xzjs: { id: roleKey, text: roleKey } }];
  const route = (handle: string, label: string, roleKey: string, targetNodeId: string, priority: number) => ({ handle, label, roleKeys: [roleKey], priority, target: targetNodeId, targetNodeId });
  const routerConfig = (code: string, name: string, routes: ReturnType<typeof route>[]) => ({ nodeDh: code, lymc: name, gbms: false, defaultRoute: routes[0]?.handle ?? "default", routes });

  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 0.62 },
    settings: {},
    nodes: [
      { id: "start", type: "start", name: "开始", position: { x: 0, y: 180 }, config: { initialVariables: { leaveReason: "{{input.leaveReason}}" } } },
      { id: "application-state", type: "state", name: "请假申请", position: { x: 180, y: 180 }, config: { nodeDh: "LEAVE_APPLICATION", jdmc: "申请中", flowStatus: "申请中", stateColor: "#2563eb", stateType: "business" } },
      { id: "apply-auto", type: "operate", name: "申请操作", position: { x: 390, y: 180 }, config: { nodeDh: "APPLY", czmc: "申请操作", assigneeMode: "receivers", instruction: "提交请假申请并自动补充直属上级", sxsz: { zdglxgfsz: ["upperAuthUnitWord"], yrdbmsfkcz: "是", xzdzlcjywc: [] }, fsfsz: { fsfbm: "员工", lsjspz: roleChange("leave_employee") }, jsfsz: { jsfbm: "直属上级", lsjspz: roleChange("leave_supervisor") }, zdzx: { sfzdzx: "是", tjsz: [], code: [] } } },
      { id: "route-after-apply", type: "router", name: "申请后人员分流", position: { x: 600, y: 180 }, config: routerConfig("ROUTE_APPLY", "申请后人员分流", [route("employee", "员工路径", "leave_employee", "employee-waiting-supervisor", 200), route("supervisor", "直属上级路径", "leave_supervisor", "supervisor-pending", 100)]) },
      { id: "employee-waiting-supervisor", type: "state", name: "员工等待审核", position: { x: 850, y: 70 }, config: { nodeDh: "EMP_WAIT_SUPERVISOR", jdmc: "等待审核", flowStatus: "等待审核", stateColor: "#f59e0b", stateType: "business" } },
      { id: "supervisor-pending", type: "state", name: "直属上级待审批", position: { x: 850, y: 290 }, config: { nodeDh: "SUPERVISOR_PENDING", jdmc: "待审批", flowStatus: "待审批", stateColor: "#f59e0b", stateType: "business" } },
      { id: "supervisor-approve", type: "operate", name: "直属上级审核", position: { x: 1100, y: 180 }, config: { nodeDh: "SUPERVISOR_APPROVE", czmc: "审核通过", assigneeMode: "receivers", pendingStatusName: "待审批", instruction: "审核员工请假申请", fsfsz: { fsfbm: "员工", lsjspz: roleChange("leave_employee") }, jsfsz: { jsfbm: "直属上级", lsjspz: roleChange("leave_supervisor") } } },
      { id: "bind-manager-auto", type: "operate", name: "自动补充经理", position: { x: 1310, y: 180 }, config: { nodeDh: "BIND_MANAGER", czmc: "自动操作", assigneeMode: "receivers", instruction: "按当前发送方的上级权限部门自动补充经理", sxsz: { zdglxgfsz: ["upperAuthUnitWord"], yrdbmsfkcz: "是", xzdzlcjywc: [] }, fsfsz: { fsfbm: "直属上级", lsjspz: roleChange("leave_supervisor") }, jsfsz: { jsfbm: "经理", lsjspz: roleChange("leave_manager") }, zdzx: { sfzdzx: "是", tjsz: [], code: [] } } },
      { id: "route-after-supervisor", type: "router", name: "上级审核后人员分流", position: { x: 1520, y: 180 }, config: routerConfig("ROUTE_SUPERVISOR", "上级审核后人员分流", [route("employee", "员工路径", "leave_employee", "employee-waiting-manager", 300), route("supervisor", "直属上级路径", "leave_supervisor", "supervisor-approved", 200), route("manager", "经理路径", "leave_manager", "manager-pending", 100)]) },
      { id: "employee-waiting-manager", type: "state", name: "员工等待经理", position: { x: 1780, y: 10 }, config: { nodeDh: "EMP_WAIT_MANAGER", jdmc: "直接上级审核通过，待经理通过", flowStatus: "直接上级审核通过，待经理通过", stateColor: "#4f46e5", stateType: "business" } },
      { id: "supervisor-approved", type: "state", name: "直属上级已审核", position: { x: 1780, y: 180 }, config: { nodeDh: "SUPERVISOR_APPROVED", jdmc: "已审核", flowStatus: "已审核", stateColor: "#2563eb", stateType: "business" } },
      { id: "manager-pending", type: "state", name: "经理待审批", position: { x: 1780, y: 350 }, config: { nodeDh: "MANAGER_PENDING", jdmc: "待审批", flowStatus: "待审批", stateColor: "#f59e0b", stateType: "business" } },
      { id: "manager-approve", type: "operate", name: "经理审核", position: { x: 2040, y: 180 }, config: { nodeDh: "MANAGER_APPROVE", czmc: "审核通过", assigneeMode: "receivers", pendingStatusName: "待审批", instruction: "完成经理级请假审核", fsfsz: { fsfbm: "直属上级", lsjspz: roleChange("leave_supervisor") }, jsfsz: { jsfbm: "经理", lsjspz: roleChange("leave_manager") } } },
      { id: "route-after-manager", type: "router", name: "经理审核后人员分流", position: { x: 2250, y: 180 }, config: routerConfig("ROUTE_MANAGER", "经理审核后人员分流", [route("employee", "员工路径", "leave_employee", "employee-approved", 300), route("supervisor", "直属上级路径", "leave_supervisor", "supervisor-finished", 200), route("manager", "经理路径", "leave_manager", "manager-approved", 100)]) },
      { id: "employee-approved", type: "state", name: "员工申请通过", position: { x: 2510, y: 10 }, config: { nodeDh: "EMP_APPROVED", jdmc: "申请通过", flowStatus: "申请通过", stateColor: "#16a34a", stateType: "business" } },
      { id: "supervisor-finished", type: "state", name: "直属上级已审核", position: { x: 2510, y: 180 }, config: { nodeDh: "SUPERVISOR_FINISHED", jdmc: "已审核", flowStatus: "已审核", stateColor: "#2563eb", stateType: "business" } },
      { id: "manager-approved", type: "state", name: "经理已审核", position: { x: 2510, y: 350 }, config: { nodeDh: "MANAGER_APPROVED", jdmc: "已审核", flowStatus: "已审核", stateColor: "#2563eb", stateType: "business" } },
      { id: "end", type: "end", name: "结束", position: { x: 2770, y: 180 }, config: { resultTemplate: { status: "{{nodes.employee-approved.flowStatus}}", leaveReason: "{{vars.leaveReason}}" } } },
    ],
    edges: [
      { id: "e1", sourceNodeId: "start", targetNodeId: "application-state" },
      { id: "e2", sourceNodeId: "application-state", targetNodeId: "apply-auto" },
      { id: "e3", sourceNodeId: "apply-auto", targetNodeId: "route-after-apply" },
      { id: "e4", sourceNodeId: "route-after-apply", sourceHandle: "employee", targetNodeId: "employee-waiting-supervisor" },
      { id: "e5", sourceNodeId: "route-after-apply", sourceHandle: "supervisor", targetNodeId: "supervisor-pending" },
      { id: "e6", sourceNodeId: "employee-waiting-supervisor", targetNodeId: "supervisor-approve" },
      { id: "e7", sourceNodeId: "supervisor-pending", targetNodeId: "supervisor-approve" },
      { id: "e8", sourceNodeId: "supervisor-approve", targetNodeId: "bind-manager-auto" },
      { id: "e9", sourceNodeId: "bind-manager-auto", targetNodeId: "route-after-supervisor" },
      { id: "e10", sourceNodeId: "route-after-supervisor", sourceHandle: "employee", targetNodeId: "employee-waiting-manager" },
      { id: "e11", sourceNodeId: "route-after-supervisor", sourceHandle: "supervisor", targetNodeId: "supervisor-approved" },
      { id: "e12", sourceNodeId: "route-after-supervisor", sourceHandle: "manager", targetNodeId: "manager-pending" },
      { id: "e13", sourceNodeId: "employee-waiting-manager", targetNodeId: "manager-approve" },
      { id: "e14", sourceNodeId: "supervisor-approved", targetNodeId: "manager-approve" },
      { id: "e15", sourceNodeId: "manager-pending", targetNodeId: "manager-approve" },
      { id: "e16", sourceNodeId: "manager-approve", targetNodeId: "route-after-manager" },
      { id: "e17", sourceNodeId: "route-after-manager", sourceHandle: "employee", targetNodeId: "employee-approved" },
      { id: "e18", sourceNodeId: "route-after-manager", sourceHandle: "supervisor", targetNodeId: "supervisor-finished" },
      { id: "e19", sourceNodeId: "route-after-manager", sourceHandle: "manager", targetNodeId: "manager-approved" },
      { id: "e20", sourceNodeId: "employee-approved", targetNodeId: "end" },
      { id: "e21", sourceNodeId: "supervisor-finished", targetNodeId: "end" },
      { id: "e22", sourceNodeId: "manager-approved", targetNodeId: "end" },
    ],
  };
}
