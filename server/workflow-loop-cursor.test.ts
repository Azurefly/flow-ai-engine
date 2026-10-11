import { describe, expect, it } from "vitest";
import {
  advanceWorkflowLoopCursor,
  emptyWorkflowLoopCursor,
  restoreWorkflowLoopCursor,
  validateWorkflowLoopCursor,
} from "./workflow-loop-cursor";
import {
  workflowTaskExecutionKey,
  workflowWaitExecutionKey,
} from "./workflow-wait-execution-key";
import {
  restoreParallelCheckpoint,
  resumeParallelCheckpoint,
} from "./workflow-parallel-checkpoint";
import { forkParallelState } from "./workflow-parallel-state";
import { prepareParallelJoin } from "./workflow-parallel-join";
import { completeCurrentHumanCheckpoint } from "./workflow-human-checkpoint";

const returning = { id: "return", loop: { maxIterations: 2 } };
const initial = emptyWorkflowLoopCursor();
const first = advanceWorkflowLoopCursor(initial, returning);
const second = advanceWorkflowLoopCursor(first, returning);
const versions = { durableTaskVersion: 2, durableWaitVersion: 2 };
const key = (cursor: unknown, tokens: any[] = []) =>
  workflowTaskExecutionKey(
    { ...versions, executionLoopCursor: cursor },
    tokens
  );

describe("循环迭代检查点", () => {
  it("只在经过实际选中的返回边时计数，同一前驱重放产生相同结果", () => {
    expect(initial.traversals).toEqual([]);
    expect(first.traversals).toEqual([{ edgeId: "return", count: 1 }]);
    expect(second.traversals).toEqual([{ edgeId: "return", count: 2 }]);
    expect(advanceWorkflowLoopCursor(first, returning)).toEqual(second);
    const forward = advanceWorkflowLoopCursor(first, { id: "forward" });
    expect(forward).toEqual(first);
    forward.traversals[0].count = 2;
    expect(first.traversals[0].count).toBe(1);
    expect(() => advanceWorkflowLoopCursor(second, returning)).toThrow(
      "2 次上限"
    );
    expect(second.traversals[0].count).toBe(2);
  });

  it("内外循环计数独立，序列化恢复后的顺序不影响身份", () => {
    const outer = { id: "outer", loop: { maxIterations: 3 } };
    const nested = advanceWorkflowLoopCursor(first, outer);
    const restored = restoreWorkflowLoopCursor(
      JSON.parse(
        JSON.stringify({
          ...nested,
          traversals: [...nested.traversals].reverse(),
        })
      )
    );
    expect(restored).toEqual(nested);
    expect(key(restored)).toBe(key(nested));
    expect(key(nested)).not.toBe(key(first));
    restored.traversals[0].count++;
    expect(nested.traversals[0].count).toBe(1);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { schemaVersion: 2, traversals: [] },
    { schemaVersion: 1, traversals: {} },
    { schemaVersion: 1, traversals: [null] },
    { schemaVersion: 1, traversals: Array(1) },
    ...[0, -1, 1001, 1.5, "1", NaN, Infinity].map(count => ({
      schemaVersion: 1,
      traversals: [{ edgeId: "return", count }],
    })),
    { schemaVersion: 1, traversals: [{ edgeId: " ", count: 1 }] },
    { schemaVersion: 1, traversals: [{ edgeId: 1, count: 1 }] },
    {
      schemaVersion: 1,
      traversals: [
        { edgeId: "return", count: 1 },
        { edgeId: "return", count: 2 },
      ],
    },
  ])("损坏的检查点不得静默重置：%j", value => {
    expect(() => restoreWorkflowLoopCursor(value)).toThrow("检查点无效");
    expect(() => key(value)).toThrow("检查点无效");
  });

  it.each([0, -1, 1001, 1.5, "2", NaN])("拒绝无效次数上限：%j", limit => {
    const edge = { id: "return", loop: { maxIterations: limit as number } };
    expect(() => advanceWorkflowLoopCursor(initial, edge)).toThrow("策略无效");
    expect(() => validateWorkflowLoopCursor(initial, [edge])).toThrow(
      "策略无效"
    );
  });

  it("恢复时核对运行定义，不接受未知返回边、重复策略或越界次数", () => {
    expect(validateWorkflowLoopCursor(second, [returning])).toEqual(second);
    expect(() => validateWorkflowLoopCursor(first, [])).toThrow(
      "运行定义不一致"
    );
    expect(() =>
      validateWorkflowLoopCursor(second, [
        { id: "return", loop: { maxIterations: 1 } },
      ])
    ).toThrow("运行定义不一致");
    expect(() =>
      validateWorkflowLoopCursor(first, [returning, returning])
    ).toThrow("策略无效");
    const boundary = { id: "__proto__", loop: { maxIterations: 1000 } };
    expect(advanceWorkflowLoopCursor(initial, boundary).traversals).toEqual([
      { edgeId: "__proto__", count: 1 },
    ]);
  });

  it("人工和等待身份同时区分轮次与并行路径，长度适配现有数据库字段", () => {
    const tokens = [{ frameId: "frame", branchId: "a" }];
    const keys = [
      key(initial),
      key(first),
      key(second),
      key(first, tokens),
      key(first, [{ frameId: "frame", branchId: "b" }]),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const value of keys) {
      expect(value).toMatch(/^visit:[a-f0-9]{64}$/);
      expect(value.length).toBeLessThanOrEqual(80);
    }
    expect(
      workflowWaitExecutionKey(
        { ...versions, executionLoopCursor: first },
        tokens
      )
    ).toBe(key(first, tokens));
    expect(
      workflowTaskExecutionKey(
        { durableTaskVersion: 1, executionLoopCursor: first },
        []
      )
    ).toBe("root");
    expect(workflowWaitExecutionKey({ executionLoopCursor: second }, [])).toBe(
      "legacy"
    );
    expect(
      workflowTaskExecutionKey(
        { durableTaskVersion: 1, executionLoopCursor: null },
        tokens
      )
    ).toBe(workflowTaskExecutionKey({ durableTaskVersion: 1 }, tokens));
  });

  it("两个异步分支按自己的轮次续跑，保留已有队列且没有共享可变计数", () => {
    const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
    const a = resumeParallelCheckpoint(
      { frames: fork.state, queue: [] },
      [],
      ["review"],
      fork.tokens[0],
      [11],
      first
    );
    const b = resumeParallelCheckpoint(
      JSON.parse(JSON.stringify(a)),
      ["review"],
      ["review"],
      fork.tokens[1],
      [22],
      second
    );
    const restored = restoreParallelCheckpoint(JSON.parse(JSON.stringify(b)), [
      "review",
      "review",
    ]);
    expect(restored.queue.map(entry => entry.loopCursor)).toEqual([
      first,
      second,
    ]);
    restored.queue[1].loopCursor!.traversals[0].count = 1;
    expect(b.queue[1].loopCursor).toEqual(second);
    expect(a.queue).toHaveLength(1);
    expect(() =>
      resumeParallelCheckpoint(
        a,
        ["review"],
        ["review"],
        fork.tokens[1],
        [],
        null
      )
    ).toThrow("检查点无效");
  });

  it("错误轮次的人工决策不能移除当前节点，以队列身份而不是另一分支的当前身份核对", () => {
    const runtime: any = {
      ...versions,
      atomicHumanTaskVersion: 1,
      executionCurrentNodeId: "review",
      executionQueue: ["review", "next"],
      executionLoopCursor: second,
      parallelCheckpoint: {
        frames: {},
        queue: [
          { nodeId: "review", tokens: [], loopCursor: first },
          { nodeId: "next", tokens: [], loopCursor: second },
        ],
      },
    };
    completeCurrentHumanCheckpoint(runtime, "review", key(second));
    expect(runtime.executionQueue).toEqual(["review", "next"]);
    completeCurrentHumanCheckpoint(runtime, "review", key(first));
    expect(runtime.executionQueue).toEqual(["next"]);
    expect(runtime.parallelCheckpoint.queue[0].loopCursor).toEqual(second);
  });

  it("第二版人工身份没有队列轮次时拒绝恢复，不猜测其他分支的计数", () => {
    const runtime: any = {
      ...versions,
      atomicHumanTaskVersion: 1,
      executionQueue: ["review"],
      executionLoopCursor: first,
      parallelCheckpoint: {
        frames: {},
        queue: [{ nodeId: "review", tokens: [] }],
      },
    };
    expect(() =>
      completeCurrentHumanCheckpoint(runtime, "review", key(first))
    ).toThrow("检查点无效");
    expect(runtime.executionQueue).toEqual(["review"]);
  });

  it("汇聚释放和释放后的重放保留当前条目的迭代身份", () => {
    const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
    const checkpoint = restoreParallelCheckpoint(
      {
        frames: fork.state,
        queue: [
          { nodeId: "join", tokens: fork.tokens[0], loopCursor: first },
          { nodeId: "join", tokens: fork.tokens[1], loopCursor: first },
        ],
      },
      ["join", "join"]
    );
    const waiting = prepareParallelJoin(checkpoint);
    expect(waiting.ready).toBe(false);
    const released = prepareParallelJoin(waiting.checkpoint);
    expect(released.ready).toBe(true);
    expect(released.checkpoint.queue[0].loopCursor).toEqual(first);
    expect(
      prepareParallelJoin(JSON.parse(JSON.stringify(released.checkpoint)))
        .checkpoint
    ).toEqual(released.checkpoint);
  });
});
