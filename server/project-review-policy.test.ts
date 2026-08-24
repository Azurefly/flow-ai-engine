import { describe, expect, it } from "vitest";
import { assertWorkflowReviewerSeparation } from "./project-service";

describe("项目流程审核职责分离", () => {
  it("兼容原有的项目所有者或管理员模式", () => {
    expect(() =>
      assertWorkflowReviewerSeparation({
        reviewerMode: "project_owner_or_admin",
        actorUserId: 7,
        workflowOwnerUserId: 7,
      })
    ).not.toThrow();
  });

  it("独立复核模式拒绝流程设计所有人自审", () => {
    expect(() =>
      assertWorkflowReviewerSeparation({
        reviewerMode: "independent_reviewer",
        actorUserId: 7,
        workflowOwnerUserId: 7,
      })
    ).toThrow("不能审核自己的流程");
    expect(() =>
      assertWorkflowReviewerSeparation({
        reviewerMode: "independent_reviewer",
        actorUserId: 8,
        workflowOwnerUserId: 7,
      })
    ).not.toThrow();
  });
});
