import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");

const resourceSource = source("../client/src/components/DataResourceCenter.tsx");
const warehouseSource = source("../client/src/components/WorkflowWarehouse.tsx");

describe("资源中心与流程仓库状态和可访问性契约", () => {
  it("资源中心在加载或错误时不渲染空态和创建主体，并保留重试", () => {
    expect(resourceSource).toContain("resources.isLoading");
    expect(resourceSource).toContain("resources.error");
    expect(resourceSource).toContain("resources.refetch()");
    expect(resourceSource).toContain("!tabLoading && !tabError");
    expect(resourceSource).toContain('data-resource-loading');
    expect(resourceSource).toContain('data-resource-error');
  });

  it("资源 Tab 使用可关联的 tabpanel，并明确 UDF 执行能力边界", () => {
    expect(resourceSource).toContain('aria-controls="data-resource-panel"');
    expect(resourceSource).toContain('id="data-resource-panel"');
    expect(resourceSource).toContain('role="tabpanel"');
    expect(resourceSource).toContain("aria-labelledby={`data-resource-tab-${tab}`}");
    expect(resourceSource).toContain(
      "Python/JAR/DSL 执行入口当前禁用，仅保留元数据登记。"
    );
    expect(resourceSource).toContain("SQL、JavaScript、Python、JAR 类型均可登记");
  });

  it("仓库预览独立呈现加载、错误、空状态，错误支持重试", () => {
    expect(warehouseSource).toContain(
      'data-warehouse-preview-state="loading"'
    );
    expect(warehouseSource).toContain(
      'data-warehouse-preview-state="error"'
    );
    expect(warehouseSource).toContain('data-warehouse-preview-state="empty"');
    expect(warehouseSource).toContain("workflowDetail.refetch()");
    expect(warehouseSource).toContain("流程只读预览加载失败");
    expect(warehouseSource).toContain("正在加载流程只读预览");
  });

  it("目录展开器是独立的键盘按钮，而不是嵌套点击文本", () => {
    expect(warehouseSource).toContain(
      'aria-label={`${folder.name}${expanded ? "收起" : "展开"}子目录`}'
    );
    expect(warehouseSource).toContain("aria-expanded={expanded}");
    expect(warehouseSource).toContain(
      "onClick={() => setExpanded(value => !value)}"
    );
  });
});
