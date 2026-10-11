import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const canvas = readFileSync(
  new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8"
);

it("账号字段有持久标签、客户端范围检查和独立的初始密码自动填充语义", () => {
  for (const label of [
    "用户名（3–64 位）",
    "显示名称",
    "初始密码（至少 12 位）",
    "邮箱（可选）",
    "账号类型",
  ])
    expect(home).toContain(label);
  expect(home).toContain("internalAccountFields.map");
  expect(home).toContain(
    'autoComplete={key === "password" ? "new-password" : "off"}'
  );
  expect(home).toContain('required={key !== "email"}');
  expect(home).toContain("minLength: 3, maxLength: 64");
  expect(home).toContain("minLength: 12, maxLength: 256");
});

it("普通账号提交捕获失败并把提示保留在弹窗中，不关闭表单或清空输入", () => {
  const handler = home.slice(
    home.indexOf("const submitNormalUser = async"),
    home.indexOf("const submitAiUser = async")
  );
  expect(handler).toContain("catch (error)");
  expect(handler).toContain("setNormalError(error instanceof Error");
  expect(handler).not.toContain("setForm(");
  expect(home).toContain("errorMessage={normalError}");
});

it("审批预览和兼容提示位于对应分组，字段与选项定义保持不变", () => {
  const panel = canvas.slice(canvas.indexOf('role="tabpanel"'));
  expect(panel).toContain(
    'activeInspectorGroup.label === "处理人" && workflowId'
  );
  expect(panel).toContain('activeInspectorGroup.label === "结果与分支"');
  expect(panel).toContain(
    'fallbackApplied === "owner" ? "流程所有者" : "流程发起人"'
  );
  expect(canvas.slice(0, canvas.indexOf('role="tabpanel"'))).not.toContain(
    "参与人解析预览"
  );
});

it("配置分组保持可见，并提供关联的面板和标准键盘切换", () => {
  expect(canvas).toContain("sticky top-0 z-10 grid");
  expect(canvas).toContain("aria-controls={`${inspectorTabId}-panel`}");
  expect(canvas).toContain(
    "aria-labelledby={`${inspectorTabId}-${activeInspectorGroup.label}`}"
  );
  expect(canvas).toContain(
    "tabIndex={activeInspectorGroup?.label === group.label ? 0 : -1}"
  );
  for (const key of ["Home", "End", "ArrowRight", "ArrowLeft"])
    expect(canvas).toContain(`event.key === "${key}"`);
});
