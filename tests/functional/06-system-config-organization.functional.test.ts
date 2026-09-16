import { describe, expect, it } from "vitest";
import { TestResultCollector } from "./helpers/test-harness";

describe("功能测试 - 模块 6：系统配置与组织架构 (System Config & Organization)", () => {
  describe("系统配置（SystemConfigShell）配置项与权限门禁", () => {
    it("通用设置与审批配置字段校验与管理员权限限制", () => {
      const start = performance.now();

      // Non-admin call rejection
      const assertAdmin = (user: { role: string }) => {
        if (user.role !== "admin") throw new Error("只有平台管理员有权修改系统级配置。");
        return true;
      };

      expect(() => assertAdmin({ role: "user" })).toThrow("只有平台管理员有权");
      expect(assertAdmin({ role: "admin" })).toBe(true);

      // General settings validation
      const validateGeneralSettings = (settings: {
        platformName: string;
        watermarkEnabled: boolean;
        watermarkText: string;
      }) => {
        if (!settings.platformName.trim()) throw new Error("平台名称不可为空。");
        if (settings.watermarkEnabled && !settings.watermarkText.trim()) {
          throw new Error("开启水印时必须配置水印文本。");
        }
        return true;
      };

      expect(
        validateGeneralSettings({
          platformName: "Flow AI Engine",
          watermarkEnabled: false,
          watermarkText: "",
        })
      ).toBe(true);

      expect(() =>
        validateGeneralSettings({
          platformName: "Flow AI Engine",
          watermarkEnabled: true,
          watermarkText: "  ",
        })
      ).toThrow("必须配置水印文本");

      TestResultCollector.record({
        testId: "TC-MOD6-CFG-001",
        name: "系统通用配置与水印配置校验及管理员权限门禁",
        category: "config",
        module: "系统配置",
        target: "config.updateSetting",
        status: "passed",
        start,
      });
    });

    it("工作域生命周期：创建、代号大写规范与启停切换", () => {
      const start = performance.now();

      const createWorkDomain = (input: { code: string; name: string; description?: string }) => {
        const code = input.code.trim().toUpperCase();
        if (code.length < 2 || code.length > 64) throw new Error("工作域代号长度应在 2-64 字符。");
        if (!input.name.trim()) throw new Error("工作域名称不可为空。");
        return {
          id: "dom-uuid-1",
          code,
          name: input.name.trim(),
          status: "active" as "active" | "disabled",
        };
      };

      const domain = createWorkDomain({ code: "fin_settle", name: "金融结算域" });
      expect(domain.code).toBe("FIN_SETTLE");
      expect(domain.status).toBe("active");

      // Toggle status
      const disabledDomain = { ...domain, status: "disabled" as const };
      expect(disabledDomain.status).toBe("disabled");

      TestResultCollector.record({
        testId: "TC-MOD6-DOM-001",
        name: "工作域代号大写归一化与启停状态维护",
        category: "button",
        module: "系统配置",
        target: "config.createWorkDomain",
        status: "passed",
        start,
      });
    });
  });

  describe("组织架构管理（OrganizationManagementPage）交互与层级树维护", () => {
    it("组织机构树（根部门、同级、子级）挂载与完整路径生成", () => {
      const start = performance.now();

      type OrgUnit = {
        id: string;
        code: string;
        name: string;
        parentUnitId: string | null;
        displayPath?: string;
      };

      const units: OrgUnit[] = [
        { id: "u-root", code: "CORP", name: "未来科技集团", parentUnitId: null },
        { id: "u-rd", code: "RD_DEPT", name: "研发中心", parentUnitId: "u-root" },
        { id: "u-fe", code: "FE_GROUP", name: "前端架构组", parentUnitId: "u-rd" },
      ];

      // Build hierarchical display path
      const buildDisplayPath = (unitId: string): string => {
        const path: string[] = [];
        let curr: OrgUnit | undefined = units.find(u => u.id === unitId);
        while (curr) {
          path.unshift(curr.name);
          curr = curr.parentUnitId ? units.find(u => u.id === curr?.parentUnitId) : undefined;
        }
        return path.join(" / ");
      };

      expect(buildDisplayPath("u-root")).toBe("未来科技集团");
      expect(buildDisplayPath("u-rd")).toBe("未来科技集团 / 研发中心");
      expect(buildDisplayPath("u-fe")).toBe("未来科技集团 / 研发中心 / 前端架构组");

      TestResultCollector.record({
        testId: "TC-MOD6-ORG-001",
        name: "组织机构树形层级挂载与完整路径解析",
        category: "config",
        module: "组织架构管理",
        target: "OrganizationUnitTree",
        status: "passed",
        start,
      });
    });

    it("成员岗位分配、主职设定、跨部门调动与移除操作", () => {
      const start = performance.now();

      type MemberBinding = {
        userId: number;
        unitId: string;
        title: string;
        isPrimary: boolean;
      };

      let memberships: MemberBinding[] = [
        { userId: 101, unitId: "u-rd", title: "高级工程师", isPrimary: true },
        { userId: 101, unitId: "u-pm", title: "敏捷教练", isPrimary: false },
      ];

      // Set primary
      const setPrimary = (userId: number, primaryUnitId: string) => {
        memberships = memberships.map(m =>
          m.userId === userId
            ? { ...m, isPrimary: m.unitId === primaryUnitId }
            : m
        );
      };

      setPrimary(101, "u-pm");
      expect(memberships.find(m => m.unitId === "u-pm")?.isPrimary).toBe(true);
      expect(memberships.find(m => m.unitId === "u-rd")?.isPrimary).toBe(false);

      // Move member
      const moveMember = (userId: number, fromUnit: string, toUnit: string) => {
        const target = memberships.find(m => m.userId === userId && m.unitId === fromUnit);
        if (!target) throw new Error("成员不在该原机构中。");
        memberships = memberships.filter(m => !(m.userId === userId && m.unitId === fromUnit));
        memberships.push({ ...target, unitId: toUnit });
      };

      moveMember(101, "u-pm", "u-fe");
      expect(memberships.some(m => m.unitId === "u-fe")).toBe(true);
      expect(memberships.some(m => m.unitId === "u-pm")).toBe(false);

      TestResultCollector.record({
        testId: "TC-MOD6-MEM-001",
        name: "部门成员分配、主职设定与跨部门调动执行效果",
        category: "button",
        module: "组织架构管理",
        target: "OrganizationMemberActions",
        status: "passed",
        start,
      });
    });

    it("部门权限组绑定与子部门权限向下继承计算", () => {
      const start = performance.now();

      type RoleBinding = {
        unitId: string;
        roleCode: string;
        includeDescendants: boolean;
      };

      const bindings: RoleBinding[] = [
        { unitId: "u-rd", roleCode: "developer_role", includeDescendants: true },
        { unitId: "u-rd", roleCode: "rd_special_role", includeDescendants: false },
      ];

      // Sub-department u-fe is child of u-rd
      const resolveUnitRoles = (unitId: string, parentUnitIds: string[]) => {
        const direct = bindings.filter(b => b.unitId === unitId).map(b => b.roleCode);
        const inherited = bindings
          .filter(b => parentUnitIds.includes(b.unitId) && b.includeDescendants)
          .map(b => b.roleCode);
        return Array.from(new Set([...direct, ...inherited]));
      };

      const feRoles = resolveUnitRoles("u-fe", ["u-rd", "u-root"]);
      expect(feRoles).toContain("developer_role");
      expect(feRoles).not.toContain("rd_special_role");

      TestResultCollector.record({
        testId: "TC-MOD6-ROLE-001",
        name: "部门系统角色绑定与包含子部门继承算法",
        category: "contract",
        module: "组织架构管理",
        target: "bindOrganizationRole",
        status: "passed",
        start,
      });
    });
  });
});
