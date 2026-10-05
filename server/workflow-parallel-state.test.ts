import { expect, it } from "vitest";
import {
  forkParallelState,
  reachParallelJoin,
} from "./workflow-parallel-state";
it("并行帧通过JSON检查点恢复，汇聚仅释放一次", () => {
  const fork = forkParallelState({}, "f1", "router", "join", ["a", "b"], []);
  const first = reachParallelJoin(fork.state, "join", fork.tokens[0]);
  expect(first.disposition).toBe("waiting");
  const restored = JSON.parse(JSON.stringify(first.state));
  const last = reachParallelJoin(restored, "join", fork.tokens[1]);
  expect(last.disposition).toBe("release");
  expect(last.tokens).toEqual([]);
  expect(
    reachParallelJoin(last.state, "join", fork.tokens[1]).disposition
  ).toBe("duplicate");
});
it("嵌套汇聚只弹出内层令牌，外层仍等待另一分支", () => {
  const outer = forkParallelState({}, "outer", "r1", "j1", ["a", "b"], []);
  const inner = forkParallelState(
    outer.state,
    "inner",
    "r2",
    "j2",
    ["x", "y"],
    outer.tokens[0]
  );
  const x = reachParallelJoin(inner.state, "j2", inner.tokens[0]);
  const y = reachParallelJoin(x.state, "j2", inner.tokens[1]);
  expect(y.tokens).toEqual(outer.tokens[0]);
  const a = reachParallelJoin(y.state, "j1", y.tokens);
  expect(a.disposition).toBe("waiting");
  expect(reachParallelJoin(a.state, "j1", outer.tokens[1]).disposition).toBe(
    "release"
  );
});
it("重复执行帧与错误汇聚节点拒绝执行", () => {
  const fork = forkParallelState({}, "f", "r", "j", ["a"], []);
  expect(() =>
    forkParallelState(fork.state, "f", "r", "j", ["a"], [])
  ).toThrow();
  expect(() =>
    reachParallelJoin(fork.state, "other", fork.tokens[0])
  ).toThrow();
  expect(() => reachParallelJoin(fork.state, "j", [])).toThrow();
});
