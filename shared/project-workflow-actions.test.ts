import { expect, it } from "vitest";
import { projectWorkflowActions } from "./project-workflow-actions";

const actions = (
  workflow: Record<string, any>,
  permissions: string[],
  project = ["project:view"],
  actorId = 7,
  reviewerMode = "independent_reviewer"
) =>
  projectWorkflowActions({
    actorId,
    workflow: { projectStatus: "active", ...workflow },
    workflowPermissions: new Set(permissions),
    projectPermissions: new Set(project),
    reviewerMode,
  });
it("查看者可查看画布，但不能设计、发布或发起", () => {
  expect(
    actions({ status: "published", flowType: "control" }, ["workflow:view"])
  ).toMatchObject({
    canViewCanvas: true,
    canDesign: false,
    canRun: false,
    canPublish: false,
    canReview: false,
  });
});
it("按流程发布权限开放已审核草稿的发布，无需业务管理权限", () => {
  expect(
    actions({ status: "draft", auditStatus: "approved" }, [
      "workflow:view",
      "workflow:edit",
      "workflow:publish",
    ])
  ).toMatchObject({
    canDesign: true,
    canPublish: true,
    canRun: false,
    canReview: false,
  });
  expect(
    actions({ status: "draft", auditStatus: "init" }, ["workflow:publish"])
      .canPublish
  ).toBe(false);
});
it.each(["state", "control"])("%s 流程运行者仅可发起已发布流程", flowType => {
  expect(
    actions({ status: "published", flowType }, ["workflow:run"]).canRun
  ).toBe(true);
  expect(actions({ status: "draft", flowType }, ["workflow:run"]).canRun).toBe(
    false
  );
});
it("数据流正式执行与后端的业务运行权限一致", () => {
  expect(
    actions({ status: "published", flowType: "data" }, ["workflow:run"]).canRun
  ).toBe(false);
  expect(
    actions(
      { status: "published", flowType: "data" },
      [],
      ["project:view", "project:workflow:run"]
    ).canRun
  ).toBe(true);
});
it("独立复核阻止创建人自审；其他管理员可审核待审核草稿", () => {
  const project = ["project:view", "project:manage"];
  expect(
    actions(
      { status: "draft", auditStatus: "init", ownerUserId: 7 },
      [],
      project
    )
  ).toMatchObject({
    canReview: false,
    reviewBlockedReason: expect.stringContaining("其他业务管理员"),
  });
  expect(
    actions(
      { status: "draft", auditStatus: "init", ownerUserId: 8 },
      [],
      project
    ).canReview
  ).toBe(true);
  expect(
    actions(
      { status: "published", auditStatus: "init", ownerUserId: 8 },
      [],
      project
    ).canReview
  ).toBe(false);
  expect(
    actions(
      { status: "draft", auditStatus: "init", ownerUserId: 7 },
      [],
      project,
      7,
      "self_review_allowed"
    ).canReview
  ).toBe(true);
});
it("没有业务查看权限时所有列表操作关闭", () => {
  const result = actions(
    { status: "published", flowType: "control" },
    ["workflow:view", "workflow:run", "workflow:publish"],
    []
  );
  expect(
    Object.entries(result)
      .filter(([key]) => key.startsWith("can"))
      .every(([, value]) => value === false)
  ).toBe(true);
});
it("归档业务仍可查看画布，但不显示运行或发布入口", () => {
  expect(
    actions(
      { projectStatus: "archived", status: "published", flowType: "control" },
      ["workflow:view", "workflow:run", "workflow:publish"]
    )
  ).toMatchObject({ canViewCanvas: true, canRun: false, canUnpublish: false });
});
