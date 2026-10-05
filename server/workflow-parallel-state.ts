import {
  arriveParallelBarrier,
  createParallelBarrier,
  type ParallelBarrier,
} from "./workflow-parallel-barrier";
export type BranchToken = { frameId: string; branchId: string };
export type ParallelState = Record<
  string,
  { routerNodeId: string; joinNodeId: string; barrier: ParallelBarrier }
>;
export function forkParallelState(
  state: ParallelState,
  frameId: string,
  routerNodeId: string,
  joinNodeId: string,
  branches: string[],
  parent: BranchToken[]
) {
  if (
    !frameId ||
    !routerNodeId ||
    !joinNodeId ||
    Object.prototype.hasOwnProperty.call(state, frameId)
  )
    throw new Error("并行执行帧无效或重复。");
  const barrier = createParallelBarrier(branches);
  return {
    state: { ...state, [frameId]: { routerNodeId, joinNodeId, barrier } },
    tokens: branches.map(branchId => [...parent, { frameId, branchId }]),
  };
}
export function reachParallelJoin(
  state: ParallelState,
  joinNodeId: string,
  tokens: BranchToken[]
) {
  const token = tokens[tokens.length - 1];
  if (!token || !Object.prototype.hasOwnProperty.call(state, token.frameId))
    throw new Error("汇聚缺少并行执行帧。");
  const frame = state[token.frameId];
  if (frame.joinNodeId !== joinNodeId)
    throw new Error("分支到达了不匹配的汇聚节点。");
  const arrival = arriveParallelBarrier(frame.barrier, token.branchId);
  return {
    state: { ...state, [token.frameId]: { ...frame, barrier: arrival.state } },
    disposition: arrival.disposition,
    tokens: arrival.disposition === "release" ? tokens.slice(0, -1) : tokens,
  };
}
