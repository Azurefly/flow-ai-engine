export type ParallelBarrier = {
  expected: string[];
  arrived: string[];
  released: boolean;
};
export function createParallelBarrier(tokens: string[]): ParallelBarrier {
  if (
    !tokens.length ||
    tokens.some(token => !token.trim()) ||
    new Set(tokens).size !== tokens.length
  )
    throw new Error("并行分支令牌必须非空且不能重复。");
  return { expected: [...tokens], arrived: [], released: false };
}
export function arriveParallelBarrier(
  state: ParallelBarrier,
  token: string
): {
  state: ParallelBarrier;
  disposition: "waiting" | "release" | "duplicate";
} {
  state = restoreParallelBarrier(state);
  if (!state.expected.includes(token))
    throw new Error("未知并行分支令牌，不能完成汇聚。");
  if (state.arrived.includes(token)) return { state, disposition: "duplicate" };
  if (state.released) throw new Error("并行汇聚已经释放，状态不一致。");
  const arrived = [...state.arrived, token];
  const released = state.expected.every(id => arrived.includes(id));
  return {
    state: { ...state, arrived, released },
    disposition: released ? "release" : "waiting",
  };
}

export function restoreParallelBarrier(value: unknown): ParallelBarrier {
  const state = value as Partial<ParallelBarrier> | null;
  const validTokens = (tokens: unknown): tokens is string[] =>
    Array.isArray(tokens) &&
    tokens.every(
      token => typeof token === "string" && token.trim().length > 0
    ) &&
    new Set(tokens).size === tokens.length;
  if (
    !state ||
    !validTokens(state.expected) ||
    !state.expected.length ||
    !validTokens(state.arrived) ||
    typeof state.released !== "boolean" ||
    state.arrived.some(token => !state.expected!.includes(token)) ||
    state.released !== (state.arrived.length === state.expected.length)
  )
    throw new Error("并行汇聚检查点无效，无法安全恢复。");
  return {
    expected: [...state.expected],
    arrived: [...state.arrived],
    released: state.released,
  };
}
