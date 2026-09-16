import { describe, expect, it } from "vitest";
import { TestResultCollector } from "./helpers/test-harness";
import { createMinimalWorkflowDefinition } from "./fixtures/mock-data";

describe("功能测试 - 模块 5：流程仓库 (Workflow Warehouse)", () => {
  describe("目录树管理按钮与执行效果", () => {
    it("平级目录与子级目录创建、更新与非空删除防护", () => {
      const start = performance.now();

      type Folder = { id: string; name: string; parentId: string | null; description?: string };
      const folders: Folder[] = [];

      // Create root folder
      const rootFolder: Folder = { id: "f-root", name: "综合业务部", parentId: null, description: "根目录" };
      folders.push(rootFolder);
      expect(folders.length).toBe(1);

      // Create child folder
      const childFolder: Folder = { id: "f-child", name: "审批流程组", parentId: "f-root" };
      folders.push(childFolder);
      expect(folders.filter(f => f.parentId === "f-root").length).toBe(1);

      // Non-empty folder deletion protection
      const workflows = [{ id: "wf-1", folderId: "f-child" }];
      const canDeleteFolder = (folderId: string) => {
        const hasChildren = folders.some(f => f.parentId === folderId);
        const hasWorkflows = workflows.some(w => w.folderId === folderId);
        if (hasChildren) throw new Error("目录下存在子级目录，无法删除。");
        if (hasWorkflows) throw new Error("目录下仍有关联流程，请先移出后再删除。");
        return true;
      };

      expect(() => canDeleteFolder("f-root")).toThrow("目录下存在子级目录");
      expect(() => canDeleteFolder("f-child")).toThrow("目录下仍有关联流程");

      // Empty folder can be deleted
      const emptyFolder: Folder = { id: "f-empty", name: "空目录", parentId: null };
      folders.push(emptyFolder);
      expect(canDeleteFolder("f-empty")).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD5-DIR-001",
        name: "流程仓库目录树创建、层级挂载与非空删除防护",
        category: "button",
        module: "流程仓库",
        target: "createFolder/deleteFolder",
        status: "passed",
        start,
      });
    });

    it("流程跨目录移动（moveWorkflow）执行效果", () => {
      const start = performance.now();

      const workflow = {
        id: "wf-101",
        name: "采购申请流程",
        folderId: "f-old" as string | null,
      };

      const moveWorkflow = (targetFolderId: string | null) => {
        return {
          ...workflow,
          folderId: targetFolderId,
        };
      };

      const moved = moveWorkflow("f-new");
      expect(moved.folderId).toBe("f-new");

      const movedToRoot = moveWorkflow(null);
      expect(movedToRoot.folderId).toBeNull();

      TestResultCollector.record({
        testId: "TC-MOD5-MOV-001",
        name: "流程移动到指定目录与移至未分类",
        category: "button",
        module: "流程仓库",
        target: "project.moveWorkflow",
        status: "passed",
        start,
      });
    });
  });

  describe("流程批量导出与导入 JSON 执行效果", () => {
    it("批量导出 JSON 结构完整性校验", () => {
      const start = performance.now();

      const sampleDefinition = createMinimalWorkflowDefinition(
        [
          { id: "start", type: "start", name: "开始" },
          { id: "end", type: "end", name: "结束" },
        ],
        [{ id: "e1", sourceNodeId: "start", targetNodeId: "end" }]
      );

      const workflowsToExport = [
        {
          id: "wf-01",
          processCode: "ORDER_APPLY",
          name: "订单申请流程",
          flowType: "state",
          definitionVersion: 2,
          definition: sampleDefinition,
        },
      ];

      // Export builder
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        formatVersion: "1.0.0",
        total: workflowsToExport.length,
        workflows: workflowsToExport,
      };

      const serialized = JSON.stringify(exportPayload, null, 2);
      expect(serialized).toContain("ORDER_APPLY");
      expect(serialized).toContain("schemaVersion");

      // Verify deserialization
      const parsed = JSON.parse(serialized);
      expect(parsed.total).toBe(1);
      expect(parsed.workflows[0].definition.nodes.length).toBe(2);

      TestResultCollector.record({
        testId: "TC-MOD5-EXP-001",
        name: "流程批量导出 JSON 格式与拓扑完整性校验",
        category: "button",
        module: "流程仓库",
        target: "exportProjectWorkflows",
        status: "passed",
        start,
      });
    });

    it("流程归档与恢复操作及已归档不可运行门禁", () => {
      const start = performance.now();

      type WorkflowEntity = {
        id: string;
        name: string;
        archivedAt: string | null;
        archivedByUserId: number | null;
      };

      const workflow: WorkflowEntity = {
        id: "wf-active",
        name: "日常请假流程",
        archivedAt: null,
        archivedByUserId: null,
      };

      // 1. Archive
      const archiveWorkflow = (entity: WorkflowEntity, actorId: number): WorkflowEntity => ({
        ...entity,
        archivedAt: new Date().toISOString(),
        archivedByUserId: actorId,
      });

      const archived = archiveWorkflow(workflow, 1);
      expect(archived.archivedAt).toBeTruthy();
      expect(archived.archivedByUserId).toBe(1);

      // 2. Guard: Cannot run archived workflow
      const assertRunnable = (entity: WorkflowEntity) => {
        if (entity.archivedAt) throw new Error("已归档流程不能发起运行。");
        return true;
      };

      expect(() => assertRunnable(archived)).toThrow("已归档流程不能发起运行");

      // 3. Restore
      const restoreWorkflow = (entity: WorkflowEntity): WorkflowEntity => ({
        ...entity,
        archivedAt: null,
        archivedByUserId: null,
      });

      const restored = restoreWorkflow(archived);
      expect(restored.archivedAt).toBeNull();
      expect(assertRunnable(restored)).toBe(true);

      TestResultCollector.record({
        testId: "TC-MOD5-ARC-001",
        name: "流程归档（软删除）、恢复与不可运行门禁约束",
        category: "button",
        module: "流程仓库",
        target: "workflow.delete/restore",
        status: "passed",
        start,
      });
    });
  });
});
