import type { ConsoleRoute, ConsoleSection } from "./console-route";

/** Route targets are shared by native links and guarded in-page navigation. */
export function primaryWorkspaceRoute(
  section: ConsoleSection | "identity",
  systemView: "config" | "identity" = "config"
): ConsoleRoute {
  if (section === "identity") return { section: "system", view: "identity" };
  if (section === "flows") return { section, view: "center" };
  if (section === "runs") return { section, view: "workbench" };
  if (section === "warehouse") return { section };
  return { section: "system", view: systemView };
}

export function shouldHandlePrimaryNavigationClick(event: {
  button: number;
  defaultPrevented: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
