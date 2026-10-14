import { expect, it } from "vitest";
import { resolveSelectedWorkflow } from "./workflow-selection";
it("分页中不存在当前流程时使用匹配的详情", () => {
  const detail = { id: "old-flow", status: "published" };
  expect(resolveSelectedWorkflow([{ id: "other", status: "draft" }], "old-flow", detail)).toBe(detail);
});
it("拒绝旧查询中属于其他流程的详情", () => {
  expect(resolveSelectedWorkflow([{ id: "other" }], "requested", { id: "previous" })).toBeNull();
});
it("当前列表的匹配流程优先于旧详情", () => {
  const current = { id: "own", status: "published" };
  expect(resolveSelectedWorkflow([current], "own", { id: "own", status: "draft" })).toBe(current);
});
it("详情未返回时保持等待，不退回分页首项", () => {
  expect(resolveSelectedWorkflow([{ id: "other" }], "requested", undefined)).toBeNull();
});
it("显式读取后的较新版本详情不会被旧分页缓存遮盖", () => {
  const listed = { id: "own", definitionVersion: 2, status: "draft" };
  const detail = { id: "own", definitionVersion: 3, status: "published" };
  expect(resolveSelectedWorkflow([listed], "own", detail)).toBe(detail);
  expect(resolveSelectedWorkflow([detail], "own", listed)).toBe(detail);
});
