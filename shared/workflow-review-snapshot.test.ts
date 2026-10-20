import { expect, it } from "vitest";
import { workflowReviewSnapshot } from "./workflow-review-snapshot";
const row = () => ({
  id: "flow",
  name: "订单审批",
  flowType: "control",
  status: "draft",
  definitionVersion: "2",
  auditStatus: "init" as const,
  description: "业务审批",
  definition: {
    nodes: [{ id: "start" }, { id: "end" }],
    edges: [{ id: "edge" }],
  },
  actions: { canReview: true, reviewBlockedReason: null },
});
it("只保留显示的版本、状态与数量，避免克隆整张画布和执行计划", () => {
  const input = row();
  Object.defineProperty(input, "publishedExecutionPlanJson", {
    get() {
      throw new Error("unneeded plan read");
    },
  });
  Object.defineProperty(input.definition.nodes[0], "config", {
    get() {
      throw new Error("unneeded node config read");
    },
  });
  expect(workflowReviewSnapshot(input)).toEqual({
    id: "flow",
    name: "订单审批",
    description: "业务审批",
    flowType: "control",
    status: "draft",
    definitionVersion: 2,
    auditStatus: "init",
    nodeCount: 2,
    edgeCount: 1,
    actions: { canReview: true, reviewBlockedReason: null },
  });
  expect(workflowReviewSnapshot(input)).not.toHaveProperty("definition");
});
it("原列表与权限对象变化不改变已取得的基准", () => {
  const input = row(),
    snapshot = workflowReviewSnapshot(input);
  input.name = "新名称";
  input.definitionVersion = "3";
  input.actions.canReview = false;
  input.definition.nodes.push({ id: "new" });
  expect(snapshot).toMatchObject({
    name: "订单审批",
    definitionVersion: 2,
    nodeCount: 2,
    actions: { canReview: true },
  });
});
it("无定义和无权限时明确显示零规模并禁用审核", () => {
  const { definition, actions, ...input } = row();
  expect(workflowReviewSnapshot(input)).toMatchObject({
    nodeCount: 0,
    edgeCount: 0,
    actions: { canReview: false },
  });
});
