import { expect, it } from "vitest";
import {
  workflowWaitExecutionKey,
  workflowTaskExecutionKey,
} from "./workflow-wait-execution-key";

it("旧运行保留单节点等待标识，新运行保存根节点标识", () => {
  const tokens = [{ frameId: "f", branchId: "a" }];
  expect(workflowWaitExecutionKey({}, tokens)).toBe("legacy");
  expect(workflowWaitExecutionKey({ durableWaitVersion: 0 }, tokens)).toBe(
    "legacy"
  );
  expect(workflowWaitExecutionKey({ durableWaitVersion: 1 }, [])).toBe("root");
});
it("分支等待标识在序列化恢复后稳定，并区分分支和嵌套路径", () => {
  const runtime = { durableWaitVersion: 1 };
  const tokens = [{ frameId: "帧", branchId: "复核" }];
  const key = workflowWaitExecutionKey(runtime, tokens);
  expect(key).toMatch(/^branch:[a-f0-9]{64}$/);
  expect(
    workflowWaitExecutionKey(runtime, JSON.parse(JSON.stringify(tokens)))
  ).toBe(key);
  expect(
    workflowWaitExecutionKey(runtime, [{ frameId: "帧", branchId: "办理" }])
  ).not.toBe(key);
  expect(
    workflowWaitExecutionKey(runtime, [
      ...tokens,
      { frameId: "嵌套", branchId: "复核" },
    ])
  ).not.toBe(key);
});
it("拒绝未知等待版本和损坏的分支路径", () => {
  expect(() => workflowWaitExecutionKey({ durableWaitVersion: 3 }, [])).toThrow(
    "版本无效"
  );
  for (const tokens of [
    null,
    Array(1),
    [{ frameId: "", branchId: "a" }],
    [
      { frameId: "f", branchId: "a" },
      { frameId: "f", branchId: "b" },
    ],
  ])
    expect(() =>
      workflowWaitExecutionKey({ durableWaitVersion: 1 }, tokens as any)
    ).toThrow();
});
it("审批任务使用独立版本快照，并区分共享节点的分支", () => {
  const tokens = [{ frameId: "f", branchId: "a" }];
  expect(workflowTaskExecutionKey({ durableWaitVersion: 1 }, tokens)).toBe(
    "legacy"
  );
  expect(workflowWaitExecutionKey({ durableTaskVersion: 1 }, tokens)).toBe(
    "legacy"
  );
  expect(workflowTaskExecutionKey({ durableTaskVersion: 1 }, [])).toBe("root");
  const key = workflowTaskExecutionKey({ durableTaskVersion: 1 }, tokens);
  expect(
    workflowTaskExecutionKey({ durableTaskVersion: 1 }, structuredClone(tokens))
  ).toBe(key);
  expect(
    workflowTaskExecutionKey({ durableTaskVersion: 1 }, [
      { frameId: "f", branchId: "b" },
    ])
  ).not.toBe(key);
  expect(() => workflowTaskExecutionKey({ durableTaskVersion: 3 }, [])).toThrow(
    "人工任务执行身份版本无效"
  );
});
