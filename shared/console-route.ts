export type ConsoleSection =
  | "overview"
  | "flows"
  | "runs"
  | "warehouse"
  | "system";

export type ConsoleRoute =
  | { section: "overview" }
  | { section: "flows"; view: "center" }
  | { section: "flows"; view: "workspace"; projectId: string }
  | { section: "flows"; view: "detail" | "editor"; workflowId: string }
  | { section: "runs"; view: "workbench" }
  | { section: "runs"; view: "monitor"; workflowId: string; runId?: string }
  | { section: "warehouse" }
  | { section: "system"; view: "config" | "identity" | "organization" };

export const consoleSections: ConsoleSection[] = [
  "overview",
  "flows",
  "runs",
  "warehouse",
  "system",
];

const routeIdPattern = /^[A-Za-z0-9_-]{8,128}$/;

function decodeRouteId(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return routeIdPattern.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function parseConsoleRoute(hash: string): ConsoleRoute {
  const path = hash.replace(/^#\/?/, "").split("?", 1)[0].replace(/\/+$/, "");
  const parts = path ? path.split("/") : [];

  if (parts.length === 1 && parts[0] === "overview")
    return { section: "overview" };
  if (parts.length === 1 && parts[0] === "flows")
    return { section: "flows", view: "center" };
  if (parts.length === 3 && parts[0] === "flows" && parts[1] === "project") {
    const projectId = decodeRouteId(parts[2]);
    if (projectId) return { section: "flows", view: "workspace", projectId };
  }
  if (parts.length === 4 && parts[0] === "flows" && parts[1] === "workflow") {
    const workflowId = decodeRouteId(parts[2]);
    const view = parts[3];
    if (workflowId && (view === "detail" || view === "editor"))
      return { section: "flows", view, workflowId };
  }
  if (parts[0] === "runs") {
    if (parts.length === 1 || (parts.length === 2 && parts[1] === "workbench"))
      return { section: "runs", view: "workbench" };
    if ((parts.length === 3 || parts.length === 4) && parts[1] === "monitor") {
      const workflowId = decodeRouteId(parts[2]);
      const runId = parts.length === 4 ? decodeRouteId(parts[3]) : undefined;
      if (workflowId && (parts.length === 3 || runId))
        return {
          section: "runs",
          view: "monitor",
          workflowId,
          ...(runId ? { runId } : {}),
        };
    }
  }
  if (parts.length === 1 && parts[0] === "warehouse")
    return { section: "warehouse" };
  if (parts[0] === "system") {
    if (parts.length === 1 || (parts.length === 2 && parts[1] === "config"))
      return { section: "system", view: "config" };
    if (parts.length === 2 && parts[1] === "identity")
      return { section: "system", view: "identity" };
    if (parts.length === 2 && parts[1] === "organization")
      return { section: "system", view: "organization" };
  }
  return { section: "flows", view: "center" };
}

export function formatConsoleRoute(route: ConsoleRoute): string {
  if (route.section === "overview") return "#/overview";
  if (route.section === "flows") {
    if (route.view === "center") return "#/flows";
    if (route.view === "workspace")
      return `#/flows/project/${encodeURIComponent(route.projectId)}`;
    return `#/flows/workflow/${encodeURIComponent(route.workflowId)}/${route.view}`;
  }
  if (route.section === "runs") {
    if (route.view === "workbench") return "#/runs/workbench";
    const base = `#/runs/monitor/${encodeURIComponent(route.workflowId)}`;
    return route.runId ? `${base}/${encodeURIComponent(route.runId)}` : base;
  }
  if (route.section === "warehouse") return "#/warehouse";
  if (route.view === "identity") return "#/system/identity";
  if (route.view === "organization") return "#/system/organization";
  return "#/system";
}
