import { describe, expect, it } from "vitest";
import { createAnnualLeaveApprovalDefinition, createReportingApprovalDefinition, createResignationApprovalDefinition } from "../shared/company-workflows";
import { selectRouterRoutes } from "./workflow-engine";

function node(definition: any, id: string) {
  return definition.nodes.find((item: any) => item.id === id);
}

describe("公司组织演示流程定义", () => {
  it("保持状态→操作→路由→状态拓扑，并为三类流程提供发布安全定义", () => {
    for (const definition of [createResignationApprovalDefinition(), createReportingApprovalDefinition(), createAnnualLeaveApprovalDefinition()]) {
      expect(definition.nodes.find((item: any) => item.type === "start")).toBeTruthy();
      expect(definition.nodes.find((item: any) => item.type === "end")).toBeTruthy();
      expect(definition.nodes.filter((item: any) => item.type === "router").length).toBeGreaterThan(0);
      expect(definition.nodes.some((item: any) => item.type === "operate")).toBe(true);
      expect(definition.edges.every((edge: any) => edge.sourceNodeId && edge.targetNodeId)).toBe(true);
    }
  });

  it("年假路由按 3 天阈值选择短链路或长链路", () => {
    const definition: any = createAnnualLeaveApprovalDefinition();
    const router: any = node(definition, "route-days");
    const short = selectRouterRoutes(router.config, { input: { days: 3 }, vars: {}, nodes: {} }, [101]);
    const long = selectRouterRoutes(router.config, { input: { days: 4 }, vars: {}, nodes: {} }, [101]);
    expect(short.selectedBranches[0]).toMatchObject({ handle: "short", targetNodeId: "short-pending", userIds: [101] });
    expect(long.selectedBranches[0]).toMatchObject({ handle: "long", targetNodeId: "long-pending", userIds: [101] });
  });

  it("辞职与汇报路由将审批角色和员工分别送往不同状态", () => {
    const role = "custom_company_approver_demo";
    for (const definition of [createResignationApprovalDefinition(role), createReportingApprovalDefinition(role)]) {
      const router: any = node(definition, "route-submit");
      const result = selectRouterRoutes(router.config, { input: {}, vars: {}, nodes: {} }, [1, 2], new Map([[1, ["default"]], [2, ["default", role]]]));
      expect(result.selectedBranches).toEqual(expect.arrayContaining([
        expect.objectContaining({ handle: "employee", userIds: [1] }),
        expect.objectContaining({ handle: "approver", userIds: [2] }),
      ]));
    }
  });
});

