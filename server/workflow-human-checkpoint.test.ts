import { expect, it } from "vitest";
import {
  completeCurrentHumanCheckpoint,
  restoreHumanCreationRuntime,
} from "./workflow-human-checkpoint";
import { workflowTaskExecutionKey } from "./workflow-wait-execution-key";
import { forkParallelState } from "./workflow-parallel-state";
import { restoreParallelCheckpoint } from "./workflow-parallel-checkpoint";

it("创建时人员与逻辑角色可恢复，最新执行队列不被旧快照覆盖", () => {
  const context: any = {
    runtime: {
      executionQueue: ["latest"],
      participantUserIds: [3],
      roleKeysByUser: { "2": ["current"] },
    },
  };
  restoreHumanCreationRuntime(context, {
    context: {
      runtime: {
        executionQueue: ["stale"],
        participantUserIds: [1, 2],
        roleKeysByUser: { "2": ["receiver"], "1": ["sender"] },
      },
    },
  });
  expect(context.runtime.executionQueue).toEqual(["latest"]);
  expect(context.runtime.participantUserIds).toEqual([3, 1, 2]);
  expect(context.runtime.roleKeysByUser["2"]).toEqual(["current", "receiver"]);
});
it("人工决策移除同一分支尚未保存检查点的当前节点", () => {
  const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
  const runtime: any = {
    atomicHumanTaskVersion: 1,
    durableTaskVersion: 1,
    executionCurrentNodeId: "review",
    executionQueue: ["review", "other"],
    parallelCheckpoint: {
      frames: fork.state,
      queue: [
        { nodeId: "review", tokens: fork.tokens[0] },
        { nodeId: "other", tokens: fork.tokens[1] },
      ],
    },
  };
  completeCurrentHumanCheckpoint(
    runtime,
    "review",
    workflowTaskExecutionKey(runtime, fork.tokens[0])
  );
  expect(runtime.executionQueue).toEqual(["other"]);
  expect(runtime.executionCurrentNodeId).toBeNull();
  expect(
    restoreParallelCheckpoint(
      runtime.parallelCheckpoint,
      runtime.executionQueue
    ).queue[0].tokens
  ).toEqual(fork.tokens[1]);
});
it("共享节点的另一分支和旧版本运行不被移除", () => {
  const fork = forkParallelState({}, "f", "router", "join", ["a", "b"], []);
  const runtime: any = {
    atomicHumanTaskVersion: 1,
    durableTaskVersion: 1,
    executionCurrentNodeId: "review",
    executionQueue: ["review"],
    parallelCheckpoint: {
      frames: fork.state,
      queue: [{ nodeId: "review", tokens: fork.tokens[1] }],
    },
  };
  completeCurrentHumanCheckpoint(
    runtime,
    "review",
    workflowTaskExecutionKey(runtime, fork.tokens[0])
  );
  expect(runtime.executionQueue).toEqual(["review"]);
  delete runtime.atomicHumanTaskVersion;
  completeCurrentHumanCheckpoint(
    runtime,
    "review",
    workflowTaskExecutionKey(runtime, fork.tokens[1])
  );
  expect(runtime.executionQueue).toEqual(["review"]);
});
it("前一决策已清空当前标记时仍可移除已登记的同身份节点", () => {
  const runtime: any = {
    atomicHumanTaskVersion: 1,
    durableTaskVersion: 1,
    executionCurrentNodeId: null,
    executionQueue: ["review", "after"],
  };
  completeCurrentHumanCheckpoint(runtime, "review", "root");
  expect(runtime.executionQueue).toEqual(["after"]);
});
