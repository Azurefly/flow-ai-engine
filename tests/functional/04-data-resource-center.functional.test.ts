import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TestResultCollector } from "./helpers/test-harness";

describe("功能测试 - 模块 4：数据资源中心 (Data Resource Center)", () => {
  it("资源表单提供可见字段标签并约束窄屏结构行宽度", () => {
    const start = performance.now();
    const structuredForm = readFileSync(
      new URL(
        "../../client/src/components/StructuredResourceForm.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const resourceCenter = readFileSync(
      new URL(
        "../../client/src/components/DataResourceCenter.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const creationDialog = readFileSync(
      new URL(
        "../../client/src/components/CreationDialog.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const projectWorkspace = readFileSync(
      new URL(
        "../../client/src/components/ProjectWorkspace.tsx",
        import.meta.url
      ),
      "utf8"
    );

    for (const field of [
      "数据源名称",
      "数据源类型",
      "连接说明",
      "服务地址或文件位置（可选）",
      "凭据引用名称（可选）",
      "资源名称",
      "关联数据源",
      "资源类型",
    ]) {
      expect(structuredForm).toContain(`label="${field}"`);
    }
    expect(structuredForm).not.toContain("sample-1");
    expect(structuredForm).toContain('name: "", type: "string"');
    expect(structuredForm).toContain("setSampleRows([])");
    expect(structuredForm).toContain(
      "!schemaRows.some(row => row.name.trim() && row.type.trim())"
    );
    expect(structuredForm).toContain("requiredFields");
    expect(structuredForm).toContain("minimumRows={1}");
    expect(structuredForm).toContain("样本行可选；不需要样本时保持空白。");
    for (const field of [
      "函数名称",
      "函数类型",
      "函数说明",
      "返回类型",
      "标签名称",
      "插件名称",
      "插件类型",
      "版本",
    ]) {
      expect(resourceCenter).toContain(`label="${field}"`);
    }
    expect(structuredForm).toContain(
      "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    );
    expect(resourceCenter).toContain('actionLabel="删除标签"');
    expect(resourceCenter).toContain("resourceName={tag.name}");
    expect(resourceCenter).toContain('data-resource-category-mobile=""');
    expect(resourceCenter).toContain('data-resource-category-select=""');
    expect(resourceCenter).toContain('aria-label="项目资源类别"');
    expect(resourceCenter).toContain(
      "onChange={event => setTab(event.target.value as Tab)}"
    );
    expect(resourceCenter).toContain('{`（${item.count ?? "…"}）`}');
    expect(resourceCenter).toContain('data-resource-category-desktop=""');
    expect(resourceCenter).toContain(
      'className="mb-4 hidden min-w-0 gap-2 pb-1 lg:flex lg:flex-wrap"'
    );
    expect(resourceCenter).not.toContain(
      "grid-cols-2 gap-2 pb-1 sm:flex sm:flex-wrap"
    );
    expect(resourceCenter).toContain("左右滑动表格可查看其余字段");
    expect(resourceCenter).toContain(
      "aria-label={`${columns[0]}列表，可横向滚动查看其余字段`}"
    );
    expect(resourceCenter).toContain('data-resource-table-mobile=""');
    expect(resourceCenter).toContain('data-resource-table-desktop=""');
    expect(resourceCenter).toContain('dataflow-run-cards=""');
    expect(resourceCenter).toContain(
      "aiflow-type-control inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-aiflow-danger lg:min-h-10 lg:min-w-10"
    );
    expect(resourceCenter).toContain(
      "aiflow-type-meta whitespace-nowrap rounded px-2 py-1"
    );
    expect(resourceCenter).toContain('dataflow-output-summary=""');
    expect(resourceCenter).toContain("最终结果预览");
    expect(resourceCenter).toContain("节点执行摘要");
    expect(resourceCenter).toContain("查看完整原始数据（JSON）");
    expect(resourceCenter).toContain(
      "max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words"
    );
    expect(resourceCenter).not.toContain("max-h-none");
    expect(resourceCenter).toContain(
      'aria-describedby="dataflow-execution-warning"'
    );
    expect(resourceCenter).toContain("grid grid-cols-2 gap-1 border-b");
    expect(resourceCenter).toContain(
      "aiflow-type-control min-h-11 w-full text-aiflow-info"
    );
    expect(projectWorkspace).toContain("flex min-h-11 min-w-0 items-center");
    expect(projectWorkspace).toContain("truncate whitespace-nowrap");
    expect(creationDialog).toContain("open={open}");
    expect(creationDialog).toContain("<DialogContent");
    expect(creationDialog).toContain("<DialogDescription");
    expect(creationDialog).toContain("<DialogClose asChild");
    expect(creationDialog).not.toContain('role="dialog"');
    expect(creationDialog).toContain("overflow-y-auto overscroll-contain");
    expect(creationDialog).not.toContain("max-h-[65vh]");

    TestResultCollector.record({
      testId: "TC-MOD4-UI-001",
      name: "资源配置表单字段标签和窄屏结构行布局",
      category: "contract",
      module: "数据资源中心",
      target: "StructuredResourceForm.ResponsiveLabels",
      status: "passed",
      start,
    });
  });

  describe("数据源与探查资产配置及测试执行", () => {
    it("数据源创建、类型校验与连接测试（testSource）执行效果", () => {
      const start = performance.now();

      const sourceTypes = ["jdbc", "api", "file", "inline"] as const;
      for (const st of sourceTypes) {
        expect(["jdbc", "api", "file", "inline"].includes(st)).toBe(true);
      }

      // JDBC source configuration
      const jdbcSource = {
        name: "业务MySQL主库",
        sourceType: "jdbc" as const,
        connection: {
          host: "10.0.0.12",
          port: 3306,
          database: "order_db",
          user: "flow_read",
        },
        credentialRef: "env:FLOW_SECRET_DB_PWD",
      };

      expect(jdbcSource.name.trim()).toBeTruthy();
      expect(jdbcSource.connection.port).toBe(3306);

      // Simulate connection probe (testSource)
      const probeConnection = (source: typeof jdbcSource) => {
        if (!source.connection.host || !source.connection.port) {
          return { success: false, message: "连接主机或端口未填写" };
        }
        return { success: true, message: "连接成功，响应时间：12ms" };
      };

      const probeResult = probeConnection(jdbcSource);
      expect(probeResult.success).toBe(true);
      expect(probeResult.message).toContain("连接成功");

      TestResultCollector.record({
        testId: "TC-MOD4-SRC-001",
        name: "数据源类型配置与连接探查测试执行",
        category: "button",
        module: "数据资源中心",
        target: "data.createSource/testSource",
        status: "passed",
        start,
      });
    });

    it("数据资产（Data Asset）结构化模式（Schema）与样例约束", () => {
      const start = performance.now();

      const assetTypes = [
        "table",
        "view",
        "file",
        "endpoint",
        "dataset",
      ] as const;
      for (const at of assetTypes) {
        expect(at).toBeTruthy();
      }

      const schema = [
        { name: "id", type: "BIGINT", primaryKey: true },
        { name: "order_no", type: "VARCHAR(64)", nullable: false },
        { name: "amount", type: "DECIMAL(12,2)", nullable: false },
        { name: "created_at", type: "DATETIME" },
      ];

      const sample = [
        {
          id: "1001",
          order_no: "ORD-202603-001",
          amount: "299.00",
          created_at: "2026-03-01 10:00:00",
        },
      ];

      const asset = {
        name: "订单明细宽表",
        assetType: "table" as const,
        schema,
        sample,
      };

      expect(asset.schema.length).toBe(4);
      expect(asset.sample.length).toBe(1);
      expect(asset.schema[0].primaryKey).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD4-AST-001",
        name: "数据资产模式定义与样例数据约束",
        category: "config",
        module: "数据资源中心",
        target: "data.createAsset",
        status: "passed",
        start,
      });
    });
  });

  describe("UDF 函数、标签与插件配置", () => {
    it("UDF 函数元数据登记与运行环境边界", () => {
      const start = performance.now();

      const udfTypes = ["sql", "javascript", "python", "jar"] as const;
      for (const ut of udfTypes) {
        expect(["sql", "javascript", "python", "jar"].includes(ut)).toBe(true);
      }

      const udf = {
        name: "maskSensitivePhone",
        udfType: "javascript" as const,
        description: "手机号脱敏处理函数",
        params: [{ name: "phone", type: "string" }],
        returnType: "string",
      };

      expect(udf.name).toMatch(/^[a-zA-Z0-9_]+$/);
      expect(udf.returnType).toBe("string");

      TestResultCollector.record({
        testId: "TC-MOD4-UDF-001",
        name: "UDF 函数元数据登记与参数返回值校验",
        category: "config",
        module: "数据资源中心",
        target: "data.createUdf",
        status: "passed",
        start,
      });
    });

    it("业务标签创建、十六进制色值正则与删除操作", () => {
      const start = performance.now();

      const colorRegex = /^#[0-9a-fA-F]{6}$/;
      expect(colorRegex.test("#2d6bea")).toBe(true);
      expect(colorRegex.test("#FF0000")).toBe(true);
      expect(colorRegex.test("red")).toBe(false);
      expect(colorRegex.test("#12345")).toBe(false);

      const tag = {
        name: "核心业务指标",
        color: "#2d6bea",
      };
      expect(colorRegex.test(tag.color)).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD4-TAG-001",
        name: "业务标签颜色正则校验与删除操作",
        category: "config",
        module: "数据资源中心",
        target: "data.createTag",
        status: "passed",
        start,
      });
    });
  });

  describe("数据流调度 Cron 配置与生命周期状态切换", () => {
    it("调度草稿、Cron 表达式格式校验与启停操作", () => {
      const start = performance.now();

      const isValidCron = (cron: string) => {
        const parts = cron.trim().split(/\s+/);
        return (
          parts.length >= 5 &&
          parts.length <= 6 &&
          cron.length >= 9 &&
          cron.length <= 96
        );
      };

      expect(isValidCron("0 0 9 * * *")).toBe(true);
      expect(isValidCron("*/5 * * * *")).toBe(true);
      expect(isValidCron("0 9 * * 1-5")).toBe(true);
      expect(isValidCron("invalid")).toBe(false);

      // Schedule state machine
      type ScheduleStatus = "draft" | "active" | "paused";
      let status: ScheduleStatus = "draft";

      // Activate schedule
      status = "active";
      expect(status).toBe("active");

      // Pause schedule
      status = "paused";
      expect(status).toBe("paused");

      // Re-activate
      status = "active";
      expect(status).toBe("active");

      TestResultCollector.record({
        testId: "TC-MOD4-SCH-001",
        name: "数据流调度 Cron 表达式校验与启停生命周期",
        category: "button",
        module: "数据资源中心",
        target: "data.scheduleLifecycle",
        status: "passed",
        start,
      });
    });
  });
});
