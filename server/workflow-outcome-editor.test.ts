import { isValidElement, type ReactElement } from "react";
import { expect, it } from "vitest";
import { WorkflowOutcomeEditor } from "../client/src/components/WorkflowOutcomeEditor";
import { assertOperateOutcomes } from "../shared/workflow-node-contract";
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
function editor(
  value: unknown,
  mode = "explicit",
  targets: Record<string, string> = {}
) {
  let changed: any;
  const tree = WorkflowOutcomeEditor({
    value,
    mode,
    targets,
    disabled: false,
    advanced: null,
    onChange: next => {
      changed = next;
    },
  });
  return { all: elements(tree), value: () => changed };
}
it("shows connected destinations and warns about missing connections", () => {
  const view = editor(
    [
      { code: "approved", label: "同意" },
      { code: "rejected", label: "退回" },
    ],
    "explicit",
    { approved: "经理审核、财务审核" }
  );
  expect(
    view.all
      .filter(item => item.type === "p")
      .map(item => item.props.children)
      .flat()
  ).toContain("经理审核、财务审核");
  expect(
    view.all
      .filter(item => item.type === "p")
      .map(item => item.props.children)
      .flat()
  ).toContain("未连接，请在画布上连接此出口");
});
it("does not mistake inherited property names for connected destinations", () => {
  const view = editor([{ code: "constructor", label: "自定义结果" }]);
  expect(
    view.all
      .filter(item => item.type === "p")
      .map(item => item.props.children)
      .flat()
  ).toContain("未连接，请在画布上连接此出口");
});
it("adds unique codes without replacing existing outcome metadata", () => {
  const original = {
    code: "outcome_2",
    label: "通过",
    sourceHandle: "outcome_3",
    extra: true,
  };
  const view = editor([original]);
  view.all
    .find(item => item.props.children === "添加处理结果")!
    .props.onClick();
  expect(view.value()).toEqual([
    original,
    {
      code: "outcome_4",
      label: "新处理结果",
      sourceHandle: "outcome_4",
      requireComment: false,
    },
  ]);
});
it("changes names and comment requirements without changing routing handles", () => {
  const original = {
    code: "approve",
    label: "通过",
    sourceHandle: "approved",
    extra: true,
  };
  const view = editor([original]);
  view.all
    .find(item => item.type === "input" && item.props.value === "通过")!
    .props.onChange({ target: { value: "确认完成" } });
  expect(view.value()).toEqual([{ ...original, label: "确认完成" }]);
  view.all
    .find(item => item.type === "input" && item.props.type === "checkbox")!
    .props.onChange({ target: { checked: true } });
  expect(view.value()).toEqual([{ ...original, requireComment: true }]);
});
it("shares strict publication validation while keeping malformed drafts editable", () => {
  const invalid = [
    { code: "same", label: "甲" },
    { code: "same", label: "乙" },
  ];
  expect(() =>
    assertOperateOutcomes({ outcomeMode: "explicit", outcomes: invalid })
  ).toThrow("重复");
  expect(
    editor(invalid).all.find(item => item.props.role === "alert")?.props
      .children
  ).toContain("重复");
  expect(
    editor([{ code: 3, label: "旧配置" }]).all.find(
      item => item.props.role === "alert"
    )?.props.children
  ).toContain("字符串");
  expect(
    editor(invalid, "legacy_cancel").all.find(
      item => item.props.role === "status"
    )?.props.children
  ).toContain("暂不生效");
});
