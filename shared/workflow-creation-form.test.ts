import { expect, it } from "vitest";
import { ResourceDraftStore } from "./resource-draft-session";
import {
  workflowCopyName,
  workflowCreationScope,
  workflowCreationCategory,
  initialWorkflowCreationFields,
  type WorkflowOperationSource,
} from "./workflow-creation-form";
const source: WorkflowOperationSource = {
  id: "flow-a",
  name: "审批",
  description: null,
  projectId: "p",
  flowType: "state",
  definitionVersion: 1,
  status: "draft",
  archivedAt: null,
  configurationToken: "token",
  folderId: null,
  dataSourceId: null,
};
it("创建与每个副本的会话隔离，独立流程不伪造业务ID", () => {
  expect(workflowCreationScope({ kind: "global" })).toBe("workflow-global");
  expect(workflowCreationScope({ kind: "copy", source })).toBe("p");
  expect(
    workflowCreationCategory({
      kind: "project",
      projectId: "p",
      projectName: "订单",
    })
  ).toBe("workflow-create");
  expect(workflowCreationCategory({ kind: "copy", source })).toBe(
    "workflow-copy:flow-a"
  );
  expect(initialWorkflowCreationFields({ kind: "copy", source }).name).toBe(
    "审批 · 副本"
  );
});
it("长名称截断不拆开Unicode字符且保留副本标识", () => {
  for (const name of ["a".repeat(160), "审批".repeat(80), "😀".repeat(80)]) {
    const copy = workflowCopyName(name);
    expect(copy.length).toBeLessThanOrEqual(160);
    expect(copy.endsWith(" · 副本")).toBe(true);
    expect(copy).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  }
});
it("单窗口确认成功只清理自身，其他窗口草稿和进行中的写锁保留", () => {
  const store = new ResourceDraftStore();
  store.set("p", "workflow-create", "fields", {}, { name: "待创建" });
  store.set("p", "workflow-copy:flow-a", "fields", {}, { name: "待复制" });
  store.set("other", "workflow-create", "fields", {}, { name: "其他业务" });
  const end = store.begin("p", "workflow-create");
  store.clearCategory("p", "workflow-create");
  expect(store.stats()).toEqual({ count: 2, pending: 1 });
  expect(store.read("p", "workflow-copy:flow-a", "fields", null)).toEqual({
    name: "待复制",
  });
  end();
  end();
  expect(store.stats().pending).toBe(0);
});
it("默认表单无修改但创建响应丢失仍能恢复并导出原请求", () => {
  const store = new ResourceDraftStore();
  const attempt = store.prepareCreation("workflow-global", "workflow-create", {
    projectId: "workflow-global",
    name: "新流程",
    flowType: "state",
    password: "never export",
  });
  store.failCreation(
    "workflow-global",
    "workflow-create",
    attempt.key,
    new Error("response lost")
  );
  expect(store.hasWorkflowDraft()).toBe(true);
  expect(store.hasWorkflowDraft("other")).toBe(false);
  expect(store.exportDrafts()).toEqual([
    {
      projectId: "workflow-global",
      category: "workflow-create",
      field: "unconfirmed-creation",
      value: {
        requestKey: attempt.key,
        uncertain: true,
        payload: {
          projectId: "workflow-global",
          name: "新流程",
          flowType: "state",
        },
      },
    },
  ]);
  expect(JSON.stringify(store.exportDrafts())).not.toContain("never export");
  store.clearCategory("workflow-global", "workflow-create");
  expect(store.hasWorkflowDraft()).toBe(false);
  expect(store.creation("workflow-global", "workflow-create")).toBeUndefined();
});
