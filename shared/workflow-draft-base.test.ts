import { expect, it } from "vitest";
import { workflowDraftBaseVersion } from "./workflow-draft-base";

it("后台刷新不会把本地草稿基准替换成最新查询版本", () => {
  const snapshot = { workflowId: "own", definitionVersion: 2 };
  expect(workflowDraftBaseVersion("own", snapshot)).toBe(2);
  expect(() => workflowDraftBaseVersion("other", snapshot)).toThrow();
  expect(() => workflowDraftBaseVersion("own", null)).toThrow();
  expect(() => workflowDraftBaseVersion("own", { ...snapshot, definitionVersion: NaN })).toThrow();
});
