import { expect, it } from "vitest";
import { subflowRuntimeContext } from "./subflow-runtime-context";
it("旧运行保持子流程上下文，新运行继承必要身份并隔离队列", () => {
  expect(subflowRuntimeContext({}, "child")).toBeUndefined();
  expect(
    subflowRuntimeContext({ httpIdempotencyVersion: 2 }, "child")
  ).toBeUndefined();
  const parent = {
    httpIdempotencyVersion: 3,
    executionRunId: "run",
    executionNodeId: "caller",
    httpInvocationPath: ["caller"],
    currentNodeParticipantUserIds: [11],
    roleKeysByUser: { "11": ["employee"] },
    parallelActiveTokens: [{ frameId: "frame", branchId: "a" }],
    parallelCheckpoint: { queue: ["parent-secret"] },
    executionQueue: ["other-node"],
    nodeParticipantUserIds: { collided: [99] },
  };
  const child = subflowRuntimeContext(parent, "child")!;
  expect(child.invocationBase).toEqual(["caller", "$subflow", "child"]);
  expect(child.runtime.executionRunId).toBe("run");
  expect(child.runtime.currentNodeParticipantUserIds).toEqual([11]);
  expect(child.runtime.roleKeysByUser).toEqual({ "11": ["employee"] });
  expect(child.runtime).not.toHaveProperty("parallelCheckpoint");
  expect(child.runtime).not.toHaveProperty("executionQueue");
  expect(child.runtime.nodeParticipantUserIds).toEqual({});
  (child.runtime.currentNodeParticipantUserIds as number[]).push(22);
  (child.runtime.roleKeysByUser as Record<string, string[]>)["11"].push(
    "changed"
  );
  expect(parent.currentNodeParticipantUserIds).toEqual([11]);
  expect(parent.roleKeysByUser["11"]).toEqual(["employee"]);
});
it("缺少父身份、错误调用路径或未知策略拒绝新子流程执行", () => {
  for (const runtime of [
    { httpIdempotencyVersion: 4 },
    { httpIdempotencyVersion: 3 },
    {
      httpIdempotencyVersion: 3,
      executionRunId: "run",
      executionNodeId: "caller",
      httpInvocationPath: [],
    },
    {
      httpIdempotencyVersion: 3,
      executionRunId: "run",
      executionNodeId: "caller",
      httpInvocationPath: ["wrong"],
    },
  ])
    expect(() => subflowRuntimeContext(runtime, "child")).toThrow();
});
