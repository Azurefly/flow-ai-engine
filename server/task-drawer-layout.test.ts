import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(
  new URL("../client/src/components/ProcessWorkbench.tsx", import.meta.url),
  "utf8"
);
const drawer = source.slice(source.indexOf("function TaskDrawer({"));
const css = readFileSync(
  new URL("../client/src/components/task-drawer.css", import.meta.url),
  "utf8"
);

it("表单先于次要任务操作，底部提交动作仍只允许办理人使用", () => {
  expect(drawer.indexOf("data-task-form")).toBeLessThan(
    drawer.indexOf("data-task-assignment")
  );
  expect(drawer.indexOf("</fieldset>")).toBeLessThan(
    drawer.indexOf("data-task-actions")
  );
  expect(drawer).toMatch(/\{canManage && \(\s*<footer data-task-actions/);
  expect(drawer).toContain("open={canReassign || undefined}");
  expect(drawer).toContain(
    'variant={decision === "rejected" ? "destructive" : "default"}'
  );
});

it("标题和提交栏不随表单滚动，窄屏表单保持单列", () => {
  expect(css).toContain("height: 100dvh");
  expect(css).toMatch(
    /\.task-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/s
  );
  expect(css).toMatch(
    /\.task-header,\s*\.task-actions\s*\{[^}]*flex-shrink: 0/s
  );
  expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(css).toContain("env(safe-area-inset-bottom)");
});

it("补充字段不再重复显示配置字段，冲突会阻止提交并保留原行", () => {
  expect(drawer).toContain("resultRows.slice(formFields.length).map");
  expect(drawer).toContain("formFields.length + index");
  expect(drawer).toContain("Boolean(additionalError)");
  expect(drawer).toContain("toast.error(additionalError.message)");
  expect(drawer).toMatch(
    /aria-describedby=\{\s*additionalError\?\.index === index\s*\? "task-extra-error"\s*: undefined/
  );
});

it("错误入口定位原控件，并关联可读的字段错误", () => {
  expect(drawer).toContain("setTouchedFormFields(new Set(invalidKeys))");
  expect(drawer).toContain("errorId={`task-field-error-${index}`}");
  expect(drawer).toContain("id={`task-field-error-${index}`}");
  expect(drawer).toContain("[additionalError.index]?.focus()");
  expect(drawer).toContain("aria-pressed={outcome === item.code}");
});
