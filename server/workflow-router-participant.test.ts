import { describe, expect, it } from "vitest";
import { selectRouterRoutes } from "./workflow-engine";

describe("人员级路由分流", () => {
  it("同一路由按流程身份把员工和直属上级送入不同状态节点", () => {
    const roles = new Map<number, string[]>([
      [101, ["leave_employee"]],
      [202, ["leave_supervisor"]],
    ]);
    const result = selectRouterRoutes({
      gbms: false,
      routes: [
        { handle: "employee", label: "员工路径", priority: 200, roleKeys: ["leave_employee"], targetNodeId: "employee-waiting" },
        { handle: "supervisor", label: "直属上级路径", priority: 100, roleKeys: ["leave_supervisor"], targetNodeId: "supervisor-pending" },
      ],
    }, { input: {} }, [101, 202], roles);

    expect(result.selectedBranches).toEqual([
      { handle: "employee", targetNodeId: "employee-waiting", userIds: [101] },
      { handle: "supervisor", targetNodeId: "supervisor-pending", userIds: [202] },
    ]);
  });

  it("非广播模式下每个人员只进入优先级最高的命中路径", () => {
    const result = selectRouterRoutes({
      gbms: false,
      routes: [
        { handle: "specific", priority: 200, roleKeys: ["leave_employee"], targetNodeId: "state-b" },
        { handle: "general", priority: 100, roleKeys: ["default"], targetNodeId: "state-c" },
      ],
    }, { input: {} }, [101], new Map([[101, ["leave_employee"]]]));

    expect(result.selectedBranches).toEqual([{ handle: "specific", targetNodeId: "state-b", userIds: [101] }]);
  });
});
