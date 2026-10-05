import { restoreParallelBarrier } from "./workflow-parallel-barrier";
import type { ParallelState, BranchToken } from "./workflow-parallel-state";
import {
  restoreParallelScopes,
  type ParallelScopes,
} from "./workflow-parallel-scope";
export type ParallelCheckpoint = {
  frames: ParallelState;
  scopes?: ParallelScopes;
  queue: {
    nodeId: string;
    tokens: BranchToken[];
    participantUserIds?: number[];
    releasedJoinFrameId?: string;
  }[];
};
export function resumeParallelCheckpoint(
  value: unknown,
  pending: string[],
  next: string[],
  tokens: unknown,
  participantUserIds?: unknown
) {
  const checkpoint = restoreParallelCheckpoint(value, pending);
  return restoreParallelCheckpoint(
    {
      ...checkpoint,
      queue: [
        ...checkpoint.queue,
        ...next.map(nodeId => ({
          nodeId,
          tokens,
          ...(participantUserIds === undefined ? {} : { participantUserIds }),
        })),
      ],
    },
    [...pending, ...next]
  );
}
export function restoreParallelCheckpoint(
  value: unknown,
  nodeQueue: string[]
): ParallelCheckpoint {
  const invalid = () => {
    throw new Error("并行分支检查点与执行队列不一致，无法安全恢复。");
  };
  if (!value || typeof value !== "object") return invalid();
  const raw = value as ParallelCheckpoint;
  if (
    !raw.frames ||
    typeof raw.frames !== "object" ||
    Array.isArray(raw.frames) ||
    !Array.isArray(raw.queue) ||
    raw.queue.length !== nodeQueue.length
  )
    return invalid();
  const frames: ParallelState = {};
  for (const [id, frame] of Object.entries(raw.frames)) {
    if (
      !id.trim() ||
      ["__proto__", "constructor", "prototype"].includes(id) ||
      !frame ||
      typeof frame.routerNodeId !== "string" ||
      !frame.routerNodeId.trim() ||
      typeof frame.joinNodeId !== "string" ||
      !frame.joinNodeId.trim()
    )
      return invalid();
    frames[id] = { ...frame, barrier: restoreParallelBarrier(frame.barrier) };
  }
  const queue = raw.queue.map((entry, index) => {
    if (
      !entry ||
      entry.nodeId !== nodeQueue[index] ||
      !Array.isArray(entry.tokens)
    )
      return invalid();
    const seen = new Set<string>();
    const tokens = entry.tokens.map(token => {
      if (
        !token ||
        typeof token.frameId !== "string" ||
        typeof token.branchId !== "string" ||
        !Object.prototype.hasOwnProperty.call(frames, token.frameId) ||
        !frames[token.frameId].barrier.expected.includes(token.branchId) ||
        seen.has(token.frameId)
      )
        return invalid();
      seen.add(token.frameId);
      return { ...token };
    });
    const releasedJoinFrameId = entry.releasedJoinFrameId;
    if (
      entry.participantUserIds !== undefined &&
      (!Array.isArray(entry.participantUserIds) ||
        entry.participantUserIds.some(id => !Number.isInteger(id) || id <= 0) ||
        new Set(entry.participantUserIds).size !==
          entry.participantUserIds.length)
    )
      return invalid();
    if (
      releasedJoinFrameId !== undefined &&
      (typeof releasedJoinFrameId !== "string" ||
        !Object.prototype.hasOwnProperty.call(frames, releasedJoinFrameId) ||
        frames[releasedJoinFrameId].joinNodeId !== entry.nodeId ||
        !frames[releasedJoinFrameId].barrier.released ||
        tokens.some(token => token.frameId === releasedJoinFrameId))
    )
      return invalid();
    return {
      nodeId: entry.nodeId,
      tokens,
      ...(entry.participantUserIds === undefined
        ? {}
        : { participantUserIds: [...entry.participantUserIds] }),
      ...(releasedJoinFrameId === undefined ? {} : { releasedJoinFrameId }),
    };
  });
  return {
    frames,
    queue,
    ...(raw.scopes === undefined
      ? {}
      : { scopes: restoreParallelScopes(raw.scopes, frames) }),
  };
}
