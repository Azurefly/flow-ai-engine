import { expect, it } from "vitest";
import {
  workflowPublicationGate,
  type WorkflowPublicationSnapshot,
} from "./workflow-publication";
const state = (
  values: Partial<WorkflowPublicationSnapshot> = {}
): WorkflowPublicationSnapshot => ({
  workflowId: "flow",
  definitionVersion: 3,
  status: "draft",
  auditStatus: "approved",
  projectScoped: true,
  archived: false,
  requireProjectApproval: true,
  ...values,
});
const gate = (
  publication: WorkflowPublicationSnapshot | null,
  definitionChanged = false,
  baseVersion: number | null = 3
) =>
  workflowPublicationGate({
    workflowId: "flow",
    baseVersion,
    publication,
    definitionChanged,
  });
it.each(["init", "rejected"])(
  "审批关闭时 %s 草稿可发布，不增加权限或版本绕过",
  auditStatus => {
    expect(
      gate(state({ requireProjectApproval: false, auditStatus }))
    ).toMatchObject({ allowed: true });
    expect(
      gate(state({ requireProjectApproval: false, auditStatus }), true)
    ).toMatchObject({ allowed: true });
    expect(
      gate(state({ requireProjectApproval: false, auditStatus }), false, 2)
    ).toMatchObject({ allowed: false, kind: "version" });
  }
);
it.each(["init", "rejected"])("审批开启时 %s 草稿说明需复核", auditStatus => {
  expect(gate(state({ auditStatus }))).toMatchObject({
    allowed: false,
    kind: "review",
  });
});
it("已审核版本只能发布已保存且被审核的定义", () => {
  expect(gate(state())).toMatchObject({ allowed: true });
  expect(gate(state(), true)).toMatchObject({
    allowed: false,
    kind: "draft",
    reason: expect.stringContaining("先保存画布"),
  });
  expect(gate(state({ status: "published" }), true)).toMatchObject({
    allowed: false,
    reason: expect.stringContaining("先取消发布"),
  });
});
it.each([
  null,
  state({ workflowId: "other" }),
  state({ definitionVersion: NaN }),
  state({ status: "invalid" }),
])("未知或串流程的元数据不能开放发布 %j", publication => {
  expect(gate(publication)).toMatchObject({
    allowed: false,
    kind: "unavailable",
  });
});
it.each([null, 0, -1, 1.5, NaN])("没有合法编辑基准时不开放发布 %s", version => {
  expect(gate(state(), false, version)).toMatchObject({
    allowed: false,
    kind: "unavailable",
  });
});
it("归档和版本变化优先于审批开关", () => {
  expect(
    gate(state({ archived: true, requireProjectApproval: false }))
  ).toMatchObject({ allowed: false, kind: "archived" });
  expect(
    gate(state({ definitionVersion: 4, requireProjectApproval: false }))
  ).toMatchObject({ allowed: false, kind: "version" });
});
it("独立流程不受业务审批规则影响", () => {
  expect(
    gate(state({ projectScoped: false, auditStatus: "init" }), true)
  ).toMatchObject({ allowed: true });
});
