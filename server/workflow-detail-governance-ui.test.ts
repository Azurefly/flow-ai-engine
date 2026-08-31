import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");

const warehouseSource = source("../client/src/components/WorkflowWarehouse.tsx");
const detailSource = source("../client/src/components/WorkflowDetailPage.tsx");
const governanceSource = source("../client/src/components/WorkflowGovernance.tsx");

describe("流程详情与治理 UI 状态契约", () => {
  it("仓库只读预览沿用真实的状态、控制或数据流程 profile", () => {
    expect(warehouseSource).toContain(
      'flowType={workflowDetail.data.flowType ?? "state"}'
    );
    expect(warehouseSource).toContain("definition={workflowDetail.data.definition}");
    expect(warehouseSource).toContain("readOnly");
  });

  it("详情页区分加载、空数据和错误，并提供返回与重试", () => {
    expect(detailSource).toContain("loading?: boolean");
    expect(detailSource).toContain("error?: string | null");
    expect(detailSource).toContain("onRetry?: () => void");
    expect(detailSource).toContain('data-aiflow-detail-state="loading"');
    expect(detailSource).toContain('data-aiflow-detail-state="empty"');
    expect(detailSource).toContain('data-aiflow-detail-state="error"');
    expect(detailSource).toContain("流程详情加载失败");
    expect(detailSource).toContain("暂无可访问的流程详情");
    expect(detailSource).toContain("重试");
  });

  it("版本、运行和结构化差异失败时显示可恢复错误态，而不是空状态", () => {
    expect(governanceSource).toContain("versions.isError");
    expect(governanceSource).toContain("runs.isError");
    expect(governanceSource).toContain("diff.isError");
    expect(governanceSource).toContain("versions.refetch()");
    expect(governanceSource).toContain("runs.refetch()");
    expect(governanceSource).toContain("diff.refetch()");
    expect(governanceSource).toContain("QueryErrorState");
    expect(governanceSource).toContain("!versions.isError && !items.length");
    expect(governanceSource).toContain("!runs.isError && !visibleRuns.length");
  });
});
