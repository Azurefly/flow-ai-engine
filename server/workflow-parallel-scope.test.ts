import { expect, it } from "vitest";
import {
  forkParallelScopes,
  activateParallelScope,
  saveParallelScope,
  mergeParallelScope,
  restoreParallelScopes,
} from "./workflow-parallel-scope";
import { forkParallelState } from "./workflow-parallel-state";
it("分支不读取另一分支修改，汇聚保留不同节点结果并稳定合并冲突", () => {
  const context: any = { vars: { input: 1 }, nodes: {} };
  const scopes = forkParallelScopes({}, "f", ["a", "b"], context);
  activateParallelScope(scopes, [{ frameId: "f", branchId: "a" }], context);
  context.vars.shared = "A";
  context.nodes.a = { value: 10 };
  saveParallelScope(scopes, [{ frameId: "f", branchId: "a" }], context);
  activateParallelScope(scopes, [{ frameId: "f", branchId: "b" }], context);
  expect(context.vars.shared).toBeUndefined();
  expect(context.nodes.a).toBeUndefined();
  context.vars.shared = "B";
  context.nodes.b = { value: 20 };
  saveParallelScope(scopes, [{ frameId: "f", branchId: "b" }], context);
  mergeParallelScope(scopes, "f", context);
  expect(context.vars).toEqual({ input: 1, shared: ["A", "B"] });
  expect(context.nodes).toEqual({ a: { value: 10 }, b: { value: 20 } });
});
it("输出快照可通过JSON恢复，修改恢复值不改变原快照", () => {
  const fork = forkParallelState({}, "f", "r", "j", ["a", "b"], []);
  const scopes = forkParallelScopes({}, "f", ["a", "b"], {
    vars: { seed: 1 },
    nodes: {},
  });
  const restored = restoreParallelScopes(
    JSON.parse(JSON.stringify(scopes)),
    fork.state
  );
  restored.f.branches.a.vars.seed = 2;
  expect(scopes.f.branches.a.vars.seed).toBe(1);
  expect(() =>
    restoreParallelScopes(
      { f: { ...scopes.f, branches: { a: scopes.f.branches.a } } },
      fork.state
    )
  ).toThrow();
});
