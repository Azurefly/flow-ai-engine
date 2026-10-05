import { expect, it } from "vitest";
import { forkParallelState } from "./workflow-parallel-state";
import { restoreParallelCheckpoint } from "./workflow-parallel-checkpoint";
import { prepareParallelJoin } from "./workflow-parallel-join";

it("汇聚释放后崩溃恢复仍保留待执行汇聚节点", () => {
  const fork = forkParallelState({}, "f", "r", "j", ["a", "b"], []);
  const first = prepareParallelJoin({
    frames: fork.state,
    queue: fork.tokens.map(tokens => ({ nodeId: "j", tokens })),
  });
  expect(first.ready).toBe(false);
  const last = prepareParallelJoin(first.checkpoint);
  expect(last.ready).toBe(true);
  const restored = restoreParallelCheckpoint(
    JSON.parse(JSON.stringify(last.checkpoint)),
    ["j"]
  );
  expect(prepareParallelJoin(restored)).toEqual({
    checkpoint: restored,
    ready: true,
  });
  expect(restored.queue[0]).toEqual({
    nodeId: "j",
    tokens: [],
    releasedJoinFrameId: "f",
  });
});

it("未释放或错误节点的汇聚执行标记拒绝恢复", () => {
  const fork = forkParallelState({}, "f", "r", "j", ["a", "b"], []);
  expect(() =>
    restoreParallelCheckpoint(
      {
        frames: fork.state,
        queue: [{ nodeId: "j", tokens: [], releasedJoinFrameId: "f" }],
      },
      ["j"]
    )
  ).toThrow();
  expect(() =>
    restoreParallelCheckpoint(
      {
        frames: fork.state,
        queue: [{ nodeId: "j", tokens: [], releasedJoinFrameId: "unknown" }],
      },
      ["j"]
    )
  ).toThrow();
});
