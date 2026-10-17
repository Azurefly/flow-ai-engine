import { expect, it } from "vitest";
import { acceptDataflowScheduleVersion } from "./dataflow-schedule-form";

const form = {
  workflowId: "owned-dataflow",
  cronExpression: "0 0 9 * * *",
  expectedRevision: 3,
};

it("保存和启停只推进同一版本的当前表单，并保留正在填写的表达式", () => {
  expect(acceptDataflowScheduleVersion(form, form, 4)).toEqual({
    ...form,
    expectedRevision: 4,
  });
});
it("列表已刷新到新版本时的启停不能替过期表单悄悄更新版本", () => {
  expect(
    acceptDataflowScheduleVersion(
      form,
      { workflowId: form.workflowId, expectedRevision: 5 },
      6
    )
  ).toBe(form);
});
it("切换目标或显式读取新版本后，旧请求返回不能改变当前表单", () => {
  expect(
    acceptDataflowScheduleVersion(
      form,
      { workflowId: "other", expectedRevision: 3 },
      4
    )
  ).toBe(form);
  expect(
    acceptDataflowScheduleVersion({ ...form, expectedRevision: 7 }, form, 4)
      .expectedRevision
  ).toBe(7);
});
it("新计划保存后更新无版本表单的基准", () => {
  const fresh = { ...form, expectedRevision: undefined };
  expect(acceptDataflowScheduleVersion(fresh, fresh, 1)).toEqual({
    ...fresh,
    expectedRevision: 1,
  });
});
