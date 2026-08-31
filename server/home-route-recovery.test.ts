import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");

const homeSource = source("../client/src/pages/Home.tsx");
const overviewSource = source(
  "../client/src/components/SystemOverviewPage.tsx"
);
const consoleRouteSource = source("../shared/console-route.ts");

describe("深链恢复与系统全景入口", () => {
  it("只在加载或抓取期间显示 routeRestoring", () => {
    const restoringBlock =
      homeSource.match(/const routeRestoring = Boolean\((.*?)\);/)?.[1] ?? "";
    expect(restoringBlock).toContain("!routeDataError");
    expect(homeSource).toContain(
      "const workflowsRestoring = workflows.isLoading || workflows.isFetching"
    );
    expect(homeSource).toContain(
      "const projectsRestoring = projects.isLoading || projects.isFetching"
    );
    expect(homeSource).toContain(
      "selectedWorkflowQuery.isLoading || selectedWorkflowQuery.isFetching"
    );
    expect(restoringBlock).toContain("workflowsRestoring");
    expect(restoringBlock).toContain("projectsRestoring");
    expect(restoringBlock).toContain("selectedWorkflowRestoring");
    expect(homeSource).toContain(
      "workflows.isLoading || workflows.isFetching"
    );
    expect(homeSource).toContain(
      "projects.isLoading || projects.isFetching"
    );
    expect(restoringBlock).not.toContain("!workflows.isSuccess");
    expect(restoringBlock).not.toContain("!projects.isSuccess");
  });

  it("在查询错误时提供可恢复的主内容错误态", () => {
    expect(homeSource).toContain("const routeNeedsProjectQuery =");
    expect(homeSource).toContain('requestedRoute.route.section === "warehouse"');
    expect(homeSource).toContain('requestedRoute.route.view === "center"');
    expect(homeSource).toContain('requestedRoute.route.view === "workspace"');
    expect(homeSource).toContain("const routeNeedsWorkflowQuery =");
    expect(homeSource).toContain('requestedRoute.route.view === "monitor"');
    expect(homeSource).toContain("const routeNeedsSelectedWorkflowQuery =");
    expect(homeSource).toContain("const routeDataError =");
    expect(homeSource).toContain("projects.isError");
    expect(homeSource).toContain("workflows.isError");
    expect(homeSource).toContain("data-aiflow-route-data-error");
    expect(homeSource).toContain('role="alert"');
    expect(homeSource).toContain("重试加载");
    expect(homeSource).toContain("返回系统全景");
    expect(homeSource).toContain("projects.refetch()");
    expect(homeSource).toContain("workflows.refetch()");
    expect(homeSource).toContain("if (routeNeedsProjectQuery)");
    expect(homeSource).toContain("if (routeNeedsWorkflowQuery)");
    expect(homeSource).not.toContain(
      'const routeNeedsProjectData = requestedRoute.route.section !== "system"'
    );
    expect(homeSource).not.toContain("#/map");
  });

  it("不因无关查询错误遮挡 overview 或 workbench", () => {
    const routeErrorBlock =
      homeSource.match(/const routeDataError = (.*?); const routeDataErrorMessage/)?.[1] ??
      "";
    expect(routeErrorBlock).toContain("routeNeedsProjectQuery");
    expect(routeErrorBlock).toContain("routeNeedsWorkflowQuery");
    expect(routeErrorBlock).not.toContain("requestedRoute.route.section !==");
    expect(homeSource).toContain(
      'route.section === "runs" && route.view === "monitor"'
    );
    expect(homeSource).toContain('route.section === "warehouse"');
  });

  it("将 overview 作为唯一系统全景 hash 入口", () => {
    expect(consoleRouteSource).toContain('section: "overview"');
    expect(consoleRouteSource).toContain('return "#/overview"');
    expect(homeSource).toContain('section === "overview"');
    expect(overviewSource).toContain('data-aiflow-system-overview=""');
    expect(consoleRouteSource).not.toContain("#/map");
    expect(overviewSource).not.toContain("#/map");
  });
});
