import { expect, it } from "vitest";
import {
  readWorkflowDraftBaseVersion,
  workflowDraftBaseVersion,
} from "./workflow-draft-base";

it("后台刷新不会把本地草稿基准替换成最新查询版本", () => {
  const snapshot = { workflowId: "own", definitionVersion: 2 };
  expect(workflowDraftBaseVersion("own", snapshot)).toBe(2);
  expect(() => workflowDraftBaseVersion("other", snapshot)).toThrow();
  expect(() => workflowDraftBaseVersion("own", null)).toThrow();
  expect(() =>
    workflowDraftBaseVersion("own", { ...snapshot, definitionVersion: NaN })
  ).toThrow();
});
it("连续切换流程时安全等待匹配的本地草稿", () => {
  const previous = { workflowId: "previous", definitionVersion: 9 };
  expect(readWorkflowDraftBaseVersion("next", previous)).toBeNull();
  expect(readWorkflowDraftBaseVersion("next", null)).toBeNull();
  expect(readWorkflowDraftBaseVersion(null, previous)).toBeNull();
  expect(
    readWorkflowDraftBaseVersion("next", {
      workflowId: "next",
      definitionVersion: 2,
    })
  ).toBe(2);
});
it("无效基准在渲染时返回待准备状态，提交时继续严格拒绝", () => {
  for (const definitionVersion of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const snapshot = { workflowId: "own", definitionVersion };
    expect(readWorkflowDraftBaseVersion("own", snapshot)).toBeNull();
    expect(() => workflowDraftBaseVersion("own", snapshot)).toThrow(
      "编辑版本尚未就绪"
    );
  }
});
