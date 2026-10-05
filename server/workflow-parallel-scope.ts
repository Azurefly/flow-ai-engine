import type { BranchToken, ParallelState } from "./workflow-parallel-state";
type OutputScope = {
  vars: Record<string, unknown>;
  nodes: Record<string, unknown>;
};
export type ParallelScopes = Record<
  string,
  { base: OutputScope; branches: Record<string, OutputScope> }
>;
const clone = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function snapshot(context: Record<string, unknown>): OutputScope {
  return clone({
    vars: record(context.vars) ? context.vars : {},
    nodes: record(context.nodes) ? context.nodes : {},
  });
}
export function forkParallelScopes(
  scopes: ParallelScopes,
  frameId: string,
  branchIds: string[],
  context: Record<string, unknown>
): ParallelScopes {
  const base = snapshot(context);
  return {
    ...scopes,
    [frameId]: {
      base,
      branches: Object.fromEntries(branchIds.map(id => [id, clone(base)])),
    },
  };
}
export function activateParallelScope(
  scopes: ParallelScopes | undefined,
  tokens: BranchToken[],
  context: Record<string, unknown>
) {
  const token = tokens[tokens.length - 1];
  if (!scopes || !token) return;
  const branch = scopes[token.frameId]?.branches[token.branchId];
  if (!branch) throw new Error("并行分支输出快照缺失，无法安全恢复。");
  Object.assign(context, clone(branch));
}
export function saveParallelScope(
  scopes: ParallelScopes | undefined,
  tokens: BranchToken[],
  context: Record<string, unknown>
) {
  const token = tokens[tokens.length - 1];
  if (!scopes || !token) return;
  const frame = scopes[token.frameId];
  if (!frame?.branches[token.branchId])
    throw new Error("并行分支输出快照缺失。");
  frame.branches[token.branchId] = snapshot(context);
}
export function mergeParallelScope(
  scopes: ParallelScopes | undefined,
  frameId: string,
  context: Record<string, unknown>
) {
  if (!scopes) return;
  const frame = scopes[frameId];
  if (!frame) throw new Error("并行汇聚输出快照缺失。");
  const merged = clone(frame.base);
  for (const field of ["vars", "nodes"] as const) {
    const branches = Object.values(frame.branches);
    const keys = new Set(
      branches.flatMap(branch => Object.keys(branch[field]))
    );
    keys.forEach(key => {
      const changed = branches.filter(
        branch =>
          JSON.stringify(branch[field][key]) !==
          JSON.stringify(frame.base[field][key])
      );
      if (!changed.length) return;
      const values = changed.map(branch => branch[field][key]);
      const same = values.every(
        value => JSON.stringify(value) === JSON.stringify(values[0])
      );
      Object.defineProperty(merged[field], key, {
        value: clone(same ? values[0] : values),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });
  }
  Object.assign(context, merged);
}
export function restoreParallelScopes(
  value: unknown,
  frames: ParallelState
): ParallelScopes {
  if (
    !record(value) ||
    Object.keys(value).length !== Object.keys(frames).length
  )
    throw new Error("并行输出检查点与执行帧不一致。");
  for (const [id, frame] of Object.entries(frames)) {
    const scope = value[id];
    if (
      !record(scope) ||
      !record(scope.base) ||
      !record(scope.base.vars) ||
      !record(scope.base.nodes) ||
      !record(scope.branches) ||
      Object.keys(scope.branches).length !== frame.barrier.expected.length
    )
      throw new Error("并行输出检查点缺少分支快照。");
    for (const branchId of frame.barrier.expected) {
      const branch = scope.branches[branchId];
      if (
        !Object.prototype.hasOwnProperty.call(scope.branches, branchId) ||
        !record(branch) ||
        !record(branch.vars) ||
        !record(branch.nodes)
      )
        throw new Error("并行输出检查点分支身份无效。");
    }
  }
  return clone(value) as ParallelScopes;
}
