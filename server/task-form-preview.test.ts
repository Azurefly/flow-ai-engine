import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskFormPreview } from "../client/src/components/TaskFormPreview";

it("办理预览显示真实字段控件和默认值，初次进入不提示未填写必填错误", () => {
  const html = renderToStaticMarkup(
    createElement(TaskFormPreview, {
      schema: {
        fields: [
          { key: "amount", label: "金额", type: "number", required: true },
          {
            key: "ref",
            label: "申请单",
            type: "text",
            readOnly: true,
            required: true,
            defaultValue: "FORM-01",
          },
          {
            key: "confirmed",
            label: "已确认",
            type: "boolean",
            defaultValue: false,
          },
        ],
      },
    })
  );
  expect(html).toContain("预览办理表单");
  expect(html).toContain('aria-label="金额"');
  expect(html).toContain("FORM-01");
  expect(html).toContain('readOnly=""');
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('role="alert"');
});

it("配置错误直接指出，禁止试填校验并保留可见预览", () => {
  const html = renderToStaticMarkup(
    createElement(TaskFormPreview, {
      schema: {
        fields: [
          {
            key: "fixed",
            label: "固定值",
            type: "number",
            readOnly: true,
            required: true,
          },
        ],
      },
    })
  );
  expect(html).toContain("请先修正字段配置");
  expect(html).toContain('role="alert"');
  expect(html).toContain("检查试填内容");
  expect(html).toContain('disabled=""');
});
