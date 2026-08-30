import { describe, expect, it } from "vitest";

import {
  createErrorReference,
  getErrorBoundaryPresentation,
} from "../client/src/lib/error-reference";
import {
  getVersionRangeDefaults,
  resetWorkflowGovernanceState,
} from "../client/src/lib/workflow-governance";

describe("前端错误边界与流程治理状态契约", () => {
  it("生产环境只返回短错误标识，不返回调试堆栈", () => {
    const error = new Error("数据库连接失败");
    error.stack = "Error: 数据库连接失败\n    at private/server/path.ts:42:7";

    const production = getErrorBoundaryPresentation(error, false);
    const development = getErrorBoundaryPresentation(error, true);

    expect(production.debugDetails).toBeNull();
    expect(production.reference).toBe(createErrorReference(error));
    expect(production.reference).toMatch(/^ERR-[A-Z0-9]{7}$/);
    expect(development.debugDetails).toContain("private/server/path.ts:42:7");
  });

  it("流程切换会清空版本范围、关键词和运行实例选择", () => {
    expect(resetWorkflowGovernanceState()).toEqual({
      fromVersion: null,
      toVersion: null,
      runKeyword: "",
      selectedRunId: null,
      selectedRunWorkflowId: null,
    });
  });

  it("从当前流程版本列表计算新的默认比较范围，并忽略无效版本", () => {
    expect(
      getVersionRangeDefaults([
        { version: "8" },
        { version: 7 },
        { version: "invalid" },
        null,
      ])
    ).toEqual({ fromVersion: 7, toVersion: 8 });
    expect(getVersionRangeDefaults([])).toEqual({
      fromVersion: null,
      toVersion: null,
    });
  });
});
