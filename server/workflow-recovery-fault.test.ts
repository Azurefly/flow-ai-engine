import { afterEach, expect, it } from "vitest";
import { injectWorkflowExecutionFault } from "./workflow-engine";

const prior = { mode: process.env.NODE_ENV, point: process.env.WORKFLOW_WORKER_FAULT_POINT, step: process.env.WORKFLOW_WORKER_FAULT_MIN_STEP };
afterEach(() => {
  for (const [key, value] of Object.entries({ NODE_ENV: prior.mode, WORKFLOW_WORKER_FAULT_POINT: prior.point, WORKFLOW_WORKER_FAULT_MIN_STEP: prior.step })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
it("故障只作用于测试进程，正式应用即使存在注入变量也不终止", () => {
  process.env.NODE_ENV = "production";
  process.env.WORKFLOW_WORKER_FAULT_POINT = "after_state_commit_before_checkpoint";
  expect(() => injectWorkflowExecutionFault("after_state_commit_before_checkpoint", { executionStepCount: 4 })).not.toThrow();
});
it("可在后续循环访问的提交边界终止，不在首轮提前终止", () => {
  process.env.NODE_ENV = "test";
  process.env.WORKFLOW_WORKER_FAULT_POINT = "after_state_commit_before_checkpoint";
  process.env.WORKFLOW_WORKER_FAULT_MIN_STEP = "4";
  expect(() => injectWorkflowExecutionFault("after_state_commit_before_checkpoint", { executionStepCount: 2 })).not.toThrow();
  expect(() => injectWorkflowExecutionFault("after_state_commit_before_checkpoint", { executionStepCount: 4 })).toThrow("Injected workflow execution crash");
});
