import { expect, it } from "vitest";
import { forkParallelState } from "./workflow-parallel-state";
import { restoreParallelCheckpoint } from "./workflow-parallel-checkpoint";
const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
const checkpoint = {
  frames: fork.state,
  queue: [
    { nodeId: "branch", tokens: fork.tokens[0] },
    { nodeId: "branch", tokens: fork.tokens[1] },
  ],
};
it("恢复同一节点不同分支身份，保持队列顺序", () => {
  const restored = restoreParallelCheckpoint(
    JSON.parse(JSON.stringify(checkpoint)),
    ["branch", "branch"]
  );
  expect(restored).toEqual(checkpoint);
  expect(restored.queue[0].tokens[0].branchId).toBe("a");
  expect(restored.queue[1].tokens[0].branchId).toBe("b");
});
it("队列长度和节点顺序必须匹配", () => {
  expect(() => restoreParallelCheckpoint(checkpoint, ["branch"])).toThrow();
  expect(() =>
    restoreParallelCheckpoint(checkpoint, ["other", "branch"])
  ).toThrow();
});
it("未知分支令牌及循环帧栈拒绝恢复", () => {
  for (const tokens of [
    [{ frameId: "missing", branchId: "a" }],
    [{ frameId: "f", branchId: "other" }],
    [...fork.tokens[0], ...fork.tokens[0]],
  ])
    expect(() =>
      restoreParallelCheckpoint(
        { frames: fork.state, queue: [{ nodeId: "branch", tokens }] },
        ["branch"]
      )
    ).toThrow();
});
