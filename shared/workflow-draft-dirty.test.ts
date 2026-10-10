import { expect, it } from "vitest";
import { isWorkflowDraftDirty } from "./workflow-publish";

const persisted = { workflowId: "own", name: "原名称", definitionJson: '{"nodes":[]}' };
it("详情暂时缺失时仍按明确请求的流程判断未保存修改", () => {
  expect(isWorkflowDraftDirty("own", persisted, "已修改", { nodes: [] })).toBe(true);
  expect(isWorkflowDraftDirty("own", persisted, "原名称", { nodes: [{ id: "new" }] })).toBe(true);
});
it("未修改的同一草稿保持干净", () => {
  expect(isWorkflowDraftDirty("own", persisted, "原名称", { nodes: [] })).toBe(false);
});
it("尚未初始化或切换流程不把上一条草稿当作当前修改", () => {
  expect(isWorkflowDraftDirty("other", persisted, "已修改", { nodes: [] })).toBe(false);
  expect(isWorkflowDraftDirty("own", null, "已修改", { nodes: [] })).toBe(false);
  expect(isWorkflowDraftDirty(null, persisted, "已修改", { nodes: [] })).toBe(false);
});
