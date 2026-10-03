import { expect, it } from "vitest";
import { taskResultView } from "../shared/task-result-view";
it("displays frozen field and option labels while preserving text and false/zero", () => {
  const config = {
    formSchema: {
      fields: [
        { key: "serial", label: "业务编号", type: "text" },
        { key: "amount", label: "金额", type: "number" },
        { key: "flag", label: "加急", type: "boolean" },
        {
          key: "choices",
          label: "标签",
          type: "multiselect",
          options: [
            { value: "a", label: "标签甲" },
            { value: "b", label: "标签乙" },
          ],
        },
      ],
    },
    outcomes: [{ code: "done", label: "办理完成" }],
  };
  expect(
    taskResultView(config, {
      serial: "true",
      amount: 0,
      flag: false,
      choices: ["a", "b"],
      outcome: "done",
      decision: "approved",
      comment: "已核对",
    })
  ).toEqual({
    outcome: "办理完成",
    comment: "已核对",
    rows: [
      { key: "serial", label: "业务编号", value: "true" },
      { key: "amount", label: "金额", value: "0" },
      { key: "flag", label: "加急", value: "否" },
      { key: "choices", label: "标签", value: "标签甲、标签乙" },
    ],
  });
});
it("keeps unknown additional values and does not confuse numeric and text option values", () => {
  const view = taskResultView(
    {
      formSchema: {
        fields: [
          {
            key: "choice",
            type: "select",
            options: [
              { value: 1, label: "数值一" },
              { value: "1", label: "文本一" },
            ],
          },
          { key: "missing" },
        ],
      },
    },
    { choice: "1", extra: { detail: "保留" }, decision: "approved" }
  );
  expect(view.outcome).toBe("同意");
  expect(view.rows[0].value).toBe("文本一");
  expect(view.rows[1].value).toBe("未填写");
  expect(view.rows[2]).toEqual({
    key: "extra",
    label: "extra",
    value: '{\n  "detail": "保留"\n}',
  });
});
it("handles old snapshots and duplicate declarations without throwing or losing data", () => {
  expect(taskResultView(null, null)).toEqual({
    outcome: "",
    comment: "",
    rows: [],
  });
  expect(
    taskResultView(
      { formSchema: { fields: [null, { key: "x" }, { key: "x" }] } },
      { x: "001", decision: "rejected" }
    )
  ).toEqual({
    outcome: "拒绝",
    comment: "",
    rows: [{ key: "x", label: "x", value: "001" }],
  });
});
it("handles blank labels, nullable options and normalized outcome codes", () => {
  const view = taskResultView(
    {
      formSchema: {
        fields: [
          { key: "x", label: " " },
          {
            key: "tags",
            type: "multiselect",
            options: [{ value: null, label: "无分类" }],
          },
        ],
      },
      outcomes: [{ code: " done ", label: "完成" }],
    },
    { x: "001", tags: [null], outcome: "done" }
  );
  expect(view.outcome).toBe("完成");
  expect(view.rows).toEqual([
    { key: "x", label: "x", value: "001" },
    { key: "tags", label: "tags", value: "无分类" },
  ]);
});
