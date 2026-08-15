import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url), "utf8");

describe("流程设计器界面回归约束", () => {
  it("新建流程按钮提交表单，控制台壳层可在窄屏纵向收敛", () => {
    expect(homeSource).toContain('<Button type="submit" size="sm" className="h-8"');
    expect(homeSource).toContain('flex min-h-[calc(100vh-56px)] flex-col md:flex-row');
    expect(homeSource).toContain('sidebarOpen ? "w-full md:w-72"');
  });

  it("画布与节点检查器在窄屏纵向堆叠，并在大屏恢复双列", () => {
    expect(canvasSource).toContain('grid-cols-1');
    expect(canvasSource).toContain('lg:grid-cols-[minmax(0,1fr)_320px]');
    expect(canvasSource).toContain('border-t border-slate-200 bg-white p-4 lg:border-l lg:border-t-0');
  });
});
