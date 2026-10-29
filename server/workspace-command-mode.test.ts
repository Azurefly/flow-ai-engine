import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ projects: vi.fn(), workflows: vi.fn() }));
vi.mock("../client/src/lib/trpc", () => ({ trpc: {
  project: { page: { useQuery: mocks.projects } },
  workflow: { search: { useQuery: mocks.workflows } },
} }));
vi.mock("../client/src/components/ui/dialog", async () => {
  const React = await import("react");
  const box = ({ children }: any) => React.createElement("div", null, children);
  return { Dialog: box, DialogContent: box, DialogTitle: box, DialogDescription: box };
});
vi.mock("../client/src/components/ui/command", async () => {
  const React = await import("react");
  const box = ({ children }: any) => React.createElement("div", null, children);
  return {
    Command: box, CommandGroup: ({ heading, children }: any) => React.createElement("div", null, heading, children),
    CommandItem: box, CommandList: box,
    CommandInput: (props: any) => React.createElement("input", { "aria-label": props["aria-label"], value: props.value, readOnly: true }),
  };
});
import WorkspaceCommandDialog from "../client/src/components/WorkspaceCommandDialog";
beforeEach(() => {
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { activeElement: null });
  mocks.projects.mockReset().mockReturnValue({ data: { items: [] }, isFetching: false, isError: false });
  mocks.workflows.mockReset().mockReturnValue({ data: [], isFetching: false, isError: false });
});
afterEach(() => vi.unstubAllGlobals());
const props = { canManageIdentity: true, isAdmin: true, onClose: vi.fn(), onNavigate: vi.fn() };
it("default lookup retains page commands and the original global search label", () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceCommandDialog, props));
  expect(html).toContain("快捷查找");
  expect(html).toContain("前往页面");
  expect(html).toContain("业务中心");
  expect(html).toContain('aria-label="搜索业务、流程或页面"');
  expect(mocks.projects).toHaveBeenCalledWith({ search: "", limit: 5 }, expect.objectContaining({ enabled: false }));
});
it("monitor lookup has a clear empty instruction and no unrelated page commands", () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceCommandDialog, { ...props, target: "monitor" }));
  expect(html).toContain("选择监控流程");
  expect(html).toContain("请输入流程名称查找。");
  expect(html).toContain('aria-label="搜索监控流程"');
  expect(html).not.toContain("前往页面");
  expect(mocks.workflows).toHaveBeenCalledWith({ search: "" }, expect.objectContaining({ enabled: false }));
});
