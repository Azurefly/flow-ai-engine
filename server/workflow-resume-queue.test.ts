import { expect, it } from "vitest";
import { resumeWorkflowQueue } from "./workflow-resume-queue";
it("恢复人工任务保留其他待执行分支及其顺序", () => {
  expect(resumeWorkflowQueue(["branch-b"], ["after-a"])).toEqual([
    "branch-b",
    "after-a",
  ]);
});
it("不丢弃多个分支对同一汇聚节点的到达", () => {
  expect(resumeWorkflowQueue(["join"], ["join"])).toEqual(["join", "join"]);
});
it("普通单分支保持原行为，损坏队列拒绝恢复", () => {
  expect(resumeWorkflowQueue(undefined, ["next"])).toEqual(["next"]);
  expect(() => resumeWorkflowQueue([null], ["next"])).toThrow();
});
