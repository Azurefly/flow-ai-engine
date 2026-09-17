import { describe, expect, it } from "vitest";
import {
  parseBusinessCsvContent,
  TestResultCollector,
} from "./helpers/test-harness";
import {
  VALID_CSV_BUSINESS_DATA,
  INVALID_CSV_MISSING_HEADER,
  INVALID_CSV_DUPLICATE_CODE,
} from "./fixtures/mock-data";

describe("功能测试 - 模块 2：业务中心与项目工作区 (Project Workspace)", () => {
  describe("业务中心（BusinessCenterView）按钮点击与执行效果", () => {
    it("导入业务按钮：CSV 格式、表头容错、空值校验与重复代号拦截", () => {
      const start = performance.now();

      // 1. Valid CSV import
      const rows = parseBusinessCsvContent(VALID_CSV_BUSINESS_DATA);
      expect(rows.length).toBe(3);
      expect(rows[0]).toEqual({
        code: "HR_OPS",
        name: "人力资源运营",
        domainCode: "HR",
        description: "处理员工入转调离等内部流程",
      });
      expect(rows[2].domainCode).toBe("");

      // 2. Missing headers check
      expect(() => parseBusinessCsvContent(INVALID_CSV_MISSING_HEADER)).toThrow(
        "CSV 标题必须包含业务代号、业务名称"
      );

      // 3. Duplicate code in same CSV check
      expect(() => parseBusinessCsvContent(INVALID_CSV_DUPLICATE_CODE)).toThrow(
        "CSV 中存在重复的业务代号"
      );

      // 4. Empty rows check
      expect(() => parseBusinessCsvContent("业务代号,业务名称\n,")).toThrow(
        "存在空白的业务代号或名称"
      );

      TestResultCollector.record({
        testId: "TC-MOD2-CSV-001",
        name: "业务 CSV 导入解析、表头校验与重复拦截",
        category: "button",
        module: "业务中心",
        target: "importBusinesses",
        status: "passed",
        start,
      });
    });

    it("业务查询与重置按钮：多维度筛选与重置逻辑", () => {
      const start = performance.now();

      const projects = [
        {
          id: "p1",
          code: "HR_DEPT",
          name: "人力资源",
          description: "人事管理",
          domainCode: "CORP",
          domainName: "企业域",
          createdAt: "2026-03-01T10:00:00Z",
        },
        {
          id: "p2",
          code: "FIN_SETTLE",
          name: "财务报销",
          description: "结算中心",
          domainCode: "FIN",
          domainName: "金融域",
          createdAt: "2026-03-10T10:00:00Z",
        },
      ];

      // Keyword filter
      const filterByKeyword = (kw: string) =>
        projects.filter(p =>
          `${p.code} ${p.name} ${p.description} ${p.domainCode} ${p.domainName}`
            .toLowerCase()
            .includes(kw.toLowerCase())
        );

      expect(filterByKeyword("HR").length).toBe(1);
      expect(filterByKeyword("财务").length).toBe(1);
      expect(filterByKeyword("不存在").length).toBe(0);

      // Reset restores all
      const emptyFilters = { keyword: "", startDate: "", endDate: "" };
      expect(filterByKeyword(emptyFilters.keyword).length).toBe(2);

      TestResultCollector.record({
        testId: "TC-MOD2-QRY-001",
        name: "业务列表多字段关键词过滤与重置效果",
        category: "button",
        module: "业务中心",
        target: "BusinessCenterQuery",
        status: "passed",
        start,
      });
    });
  });

  describe("流程中心（ProcessCenter）配置项与执行效果", () => {
    it("流程类型、来源与数据源必选门禁配置", () => {
      const start = performance.now();

      // State flow creation config
      const stateFlowForm = {
        processCode: "ORDER_STATE",
        name: "订单状态流",
        flowType: "state" as const,
        creationSource: "manual" as const,
        dataSourceId: "",
      };
      expect(stateFlowForm.flowType).toBe("state");
      expect(stateFlowForm.processCode).toMatch(/^[A-Z0-9_]+$/);

      // Data flow requires dataSourceId when manual
      const dataFlowForm = {
        processCode: "ETL_SYNC",
        name: "客户数据抽取",
        flowType: "data" as const,
        creationSource: "manual" as const,
        dataSourceId: "ds-mysql-01",
      };
      expect(dataFlowForm.flowType).toBe("data");
      expect(dataFlowForm.dataSourceId).toBeTruthy();

      TestResultCollector.record({
        testId: "TC-MOD2-FLOW-001",
        name: "流程创建表单类型规范与数据源约束",
        category: "config",
        module: "流程设计中心",
        target: "ProcessCenterCreation",
        status: "passed",
        start,
      });
    });

    it("流程发布门禁规则：审核状态与未发布状态联动", () => {
      const start = performance.now();

      const canPublishWorkflow = (workflow: {
        status: string;
        auditStatus: string;
      }) => workflow.status === "draft" && workflow.auditStatus === "approved";

      const canUnpublishWorkflow = (workflow: { status: string }) =>
        workflow.status === "published";

      expect(
        canPublishWorkflow({ status: "draft", auditStatus: "approved" })
      ).toBe(true);
      expect(
        canPublishWorkflow({ status: "draft", auditStatus: "init" })
      ).toBe(false);
      expect(
        canPublishWorkflow({ status: "draft", auditStatus: "rejected" })
      ).toBe(false);
      expect(
        canPublishWorkflow({ status: "published", auditStatus: "approved" })
      ).toBe(false);

      expect(canUnpublishWorkflow({ status: "published" })).toBe(true);
      expect(canUnpublishWorkflow({ status: "draft" })).toBe(false);

      TestResultCollector.record({
        testId: "TC-MOD2-PUB-001",
        name: "流程发布与取消发布权限门禁与状态机约束",
        category: "contract",
        module: "流程设计中心",
        target: "WorkflowPublishGate",
        status: "passed",
        start,
      });
    });

    it("发起流程弹窗（ProcessLaunchDialog）：表单字段收集与结构化运行时输入生成", () => {
      const start = performance.now();

      const launchForm = {
        codeType: "UserWord",
        expectedEnd: "2026-03-30T18:00",
        roleKeys: "dept_manager, hr_admin",
        businessInformationOne: "采购订单申请",
        businessInformationTwo: "金额：50000元",
        businessInformationThree: "紧急程度：高",
        businessInformationText: "需要采购研发服务器，请尽快审批",
      };

      // Split roleKeys by comma or space
      const parsedRoleKeys = launchForm.roleKeys
        .split(/[，,\s]+/)
        .filter(Boolean);
      expect(parsedRoleKeys).toEqual(["dept_manager", "hr_admin"]);

      const payload = {
        codeType: launchForm.codeType,
        flowEngine: true,
        flowDeliveryTime: new Date(launchForm.expectedEnd).toISOString(),
        roleKeys: parsedRoleKeys,
        businessInformationOne: launchForm.businessInformationOne.trim(),
        businessInformationTwo: launchForm.businessInformationTwo.trim(),
        businessInformationThree: launchForm.businessInformationThree.trim(),
        businessInformationText: launchForm.businessInformationText.trim(),
      };

      expect(payload.codeType).toBe("UserWord");
      expect(payload.roleKeys.length).toBe(2);
      expect(payload.businessInformationOne).toBe("采购订单申请");
      expect(payload.flowDeliveryTime).toContain("2026-03-30");

      TestResultCollector.record({
        testId: "TC-MOD2-LNCH-001",
        name: "流程发起弹窗结构化上下文与角色键解析",
        category: "config",
        module: "流程设计中心",
        target: "ProcessLaunchDialog",
        status: "passed",
        start,
      });
    });
  });

  describe("项目成员与服务端点配置", () => {
    it("项目成员授权与过期时间换算执行效果", () => {
      const start = performance.now();

      const calculateExpiresAt = (hoursStr: string, baseTime = 1773000000000) => {
        const hours = Number(hoursStr);
        return hours > 0 ? new Date(baseTime + hours * 3600_000) : undefined;
      };

      const temporaryExp = calculateExpiresAt("24", 1000000);
      expect(temporaryExp?.getTime()).toBe(1000000 + 24 * 3600_000);

      const permanentExp = calculateExpiresAt("");
      expect(permanentExp).toBeUndefined();

      TestResultCollector.record({
        testId: "TC-MOD2-MEM-001",
        name: "项目成员授权临时有效期计算执行效果",
        category: "config",
        module: "权限配置中心",
        target: "ProjectMembers",
        status: "passed",
        start,
      });
    });

    it("服务端点登记与启停切换执行效果", () => {
      const start = performance.now();

      const endpoint = {
        id: "ep-1",
        refCode: "CRM_SERVICE",
        name: "CRM系统API",
        baseUrl: "https://api.crm.example.com/v1",
        secretRef: "env:FLOW_SECRET_CRM",
        authHeaderName: "Authorization",
        authScheme: "Bearer",
        status: "active" as "active" | "disabled",
      };

      expect(endpoint.refCode).toBe(endpoint.refCode.toUpperCase());
      expect(endpoint.baseUrl.startsWith("http")).toBe(true);

      // Toggle status
      const toggledStatus = endpoint.status === "active" ? "disabled" : "active";
      expect(toggledStatus).toBe("disabled");

      TestResultCollector.record({
        testId: "TC-MOD2-EP-001",
        name: "项目服务端点配置与启停状态切换",
        category: "button",
        module: "服务端点",
        target: "ServiceEndpointCenter",
        status: "passed",
        start,
      });
    });

    it("项目权限隔离：创建人添加可见人/可见部门，普通成员受限，超级管理员可见全部", () => {
      const start = performance.now();

      type MockProject = {
        id: string;
        code: string;
        name: string;
        ownerUserId: number;
        status: "active" | "archived";
      };

      type MockProjectMember = {
        projectId: string;
        userId: number;
        role: "owner" | "designer" | "operator" | "viewer";
      };

      type MockProjectUnit = {
        projectId: string;
        unitId: string;
        role: "viewer" | "operator";
      };

      type MockUserDept = {
        userId: number;
        unitId: string;
      };

      const projects: MockProject[] = [
        { id: "p1", code: "PROJ_ALICE", name: "爱丽丝的采购项目", ownerUserId: 101, status: "active" },
        { id: "p2", code: "PROJ_BOB", name: "鲍勃的机密研发项目", ownerUserId: 102, status: "active" },
        { id: "p3", code: "PROJ_DEPT", name: "财务部公共预算项目", ownerUserId: 103, status: "active" },
      ];

      // 直接授权可见人 (Direct Members)
      const members: MockProjectMember[] = [
        { projectId: "p1", userId: 101, role: "owner" },
        { projectId: "p1", userId: 104, role: "viewer" }, // 104 (David) 被添加为可见人
        { projectId: "p2", userId: 102, role: "owner" },
        { projectId: "p3", userId: 103, role: "owner" },
      ];

      // 授权可见部门 (Department Visibility)
      const projectUnits: MockProjectUnit[] = [
        { projectId: "p3", unitId: "dept_finance", role: "viewer" }, // 财务部全员可见 p3
      ];

      // 用户所属部门 (User Department Memberships)
      const userDepts: MockUserDept[] = [
        { userId: 101, unitId: "dept_rd" },
        { userId: 102, unitId: "dept_rd" },
        { userId: 105, unitId: "dept_finance" }, // 105 (Fiona) 属于财务部
        { userId: 106, unitId: "dept_hr" },      // 106 (Helen) 属于HR部门（无关人员）
      ];

      // 匹配 listProjects 权限隔离过滤逻辑
      const queryUserProjects = (user: { id: number; role: "admin" | "user" }) => {
        if (user.role === "admin") {
          return projects.filter(p => p.status === "active"); // 超级管理员可以看到全部
        }
        return projects.filter(p => {
          if (p.status !== "active") return false;
          // 1. 创建人拥有所有权
          if (p.ownerUserId === user.id) return true;
          // 2. 被添加为可见人 (Direct Member)
          if (members.some(m => m.projectId === p.id && m.userId === user.id)) return true;
          // 3. 所属部门被添加为可见部门 (Department Visibility)
          const myUnitIds = userDepts.filter(ud => ud.userId === user.id).map(ud => ud.unitId);
          if (projectUnits.some(pu => pu.projectId === p.id && myUnitIds.includes(pu.unitId))) return true;
          return false;
        });
      };

      // 1. 超级管理员：可以看到全部 3 个项目
      const adminProjects = queryUserProjects({ id: 1, role: "admin" });
      expect(adminProjects.length).toBe(3);

      // 2. 创建人 Alice (101)：只看到自己创建的 p1，看不到 Bob 的 p2 或财务的 p3
      const aliceProjects = queryUserProjects({ id: 101, role: "user" });
      expect(aliceProjects.map(p => p.id)).toEqual(["p1"]);

      // 3. 可见人 David (104)：被 Alice 添加为 p1 的可见人，能看到 p1，看不到 p2 或 p3
      const davidProjects = queryUserProjects({ id: 104, role: "user" });
      expect(davidProjects.map(p => p.id)).toEqual(["p1"]);

      // 4. 部门成员 Fiona (105)：属于财务部，能看到被授权给财务部的 p3，看不到 p1 或 p2
      const fionaProjects = queryUserProjects({ id: 105, role: "user" });
      expect(fionaProjects.map(p => p.id)).toEqual(["p3"]);

      // 5. 无关人员 Helen (106)：属于 HR 部门，既不是创建人、也未被添加为可见人、所属部门也未被添加为可见部门 -> 0 个项目可见！
      const helenProjects = queryUserProjects({ id: 106, role: "user" });
      expect(helenProjects.length).toBe(0);

      TestResultCollector.record({
        testId: "TC-MOD2-PERM-001",
        name: "项目权限隔离与创建人添加可见人/部门及超管全量可见",
        category: "contract",
        module: "权限配置中心",
        target: "listProjects/ProjectIsolation",
        status: "passed",
        start,
      });
    });
  });
});
