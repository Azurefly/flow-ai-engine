import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const directory = vi.hoisted(() => ({
  selected: [{ value: "17", label: "审批人甲", disabled: false }],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    workflow: {
      participantDirectory: {
        useQuery: () => ({
          data: { selected: directory.selected, items: [] },
          isSuccess: true,
        }),
      },
    },
  },
}));
vi.mock("../client/src/components/SearchableMultiSelect", () => ({
  SearchableMultiSelect: ({ disabled }: any) =>
    createElement("button", { disabled }, "人员选择"),
}));
import { WorkflowParticipantPicker } from "../client/src/components/WorkflowParticipantPicker";
beforeEach(() => {
  directory.selected = [{ value: "17", label: "审批人甲", disabled: false }];
});
it("只读本身禁用选择及审批顺序，并显示只读说明", () => {
  const html = renderToStaticMarkup(
    createElement(WorkflowParticipantPicker, {
      workflowId: "abcdefgh",
      kind: "user",
      value: ["17"],
      readOnly: true,
      ordered: true,
      onChange: () => {},
    })
  );
  expect(html).toContain("仅查看已配置人员");
  expect(html).not.toContain("按姓名或账号搜索");
  expect(html).toMatch(/<button disabled="">人员选择/);
  expect(html).toMatch(/aria-label="下移第1位审批人"[^>]*disabled=""/);
});
it("停用人员保留姓名并提示替换，不仅展示编号", () => {
  directory.selected = [
    { value: "17", label: "审批人甲 · 已停用", disabled: true },
  ];
  const html = renderToStaticMarkup(
    createElement(WorkflowParticipantPicker, {
      workflowId: "abcdefgh",
      kind: "user",
      value: ["17"],
      ordered: true,
      onChange: () => {},
    })
  );
  expect(html).toContain("已选项目已停用或不存在");
  expect(html).toContain("请重新选择");
  expect(html).toContain("审批人甲 · 已停用");
  expect(html).not.toContain("：17");
});
