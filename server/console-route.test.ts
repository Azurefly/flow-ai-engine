import { describe, expect, it } from "vitest";
import {
  formatConsoleRoute,
  parseConsoleRoute,
  type ConsoleRoute,
} from "../shared/console-route";

describe("console hash routes", () => {
  const routes: ConsoleRoute[] = [
    { section: "overview" },
    { section: "flows", view: "center" },
    { section: "flows", view: "workspace", projectId: "project_1234" },
    { section: "flows", view: "detail", workflowId: "workflow_1234" },
    { section: "flows", view: "editor", workflowId: "workflow_1234" },
    { section: "runs", view: "workbench" },
    { section: "runs", view: "monitor", workflowId: "workflow_1234" },
    {
      section: "runs",
      view: "monitor",
      workflowId: "workflow_1234",
      runId: "run_12345678",
    },
    { section: "warehouse" },
    { section: "system", view: "config" },
    { section: "system", view: "identity" },
    { section: "system", view: "organization" },
  ];

  it.each(routes)("round-trips $section route", route => {
    expect(parseConsoleRoute(formatConsoleRoute(route))).toEqual(route);
  });

  it("accepts legacy top-level hashes and emits canonical child hashes", () => {
    expect(parseConsoleRoute("#/overview?source=header")).toEqual({
      section: "overview",
    });
    expect(formatConsoleRoute({ section: "overview" })).toBe("#/overview");
    expect(parseConsoleRoute("#/runs")).toEqual({
      section: "runs",
      view: "workbench",
    });
    expect(parseConsoleRoute("#/system")).toEqual({
      section: "system",
      view: "config",
    });
    expect(formatConsoleRoute(parseConsoleRoute("#/runs"))).toBe(
      "#/runs/workbench"
    );
  });

  it.each([
    "",
    "#/unknown",
    "#/overview/extra",
    "#/flows/project/short",
    "#/flows/workflow/workflow_1234/delete",
    "#/flows/workflow/bad%2Fid/editor",
    "#/runs/monitor/workflow_1234/bad%2Frun",
    "#/system/identity/extra",
    "#/system/organization/extra",
  ])("falls back for malformed or unsupported route %s", hash => {
    expect(parseConsoleRoute(hash)).toEqual({
      section: "flows",
      view: "center",
    });
  });
});
