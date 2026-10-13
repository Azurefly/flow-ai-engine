import type { ParallelCheckpoint } from "./workflow-parallel-checkpoint";
import { reachParallelJoin } from "./workflow-parallel-state";
import { mergeWorkflowLoopCursors, restoreWorkflowLoopCursor } from "./workflow-loop-cursor";

// Release and its pending node must be persisted together. A retry executes the
// pending join without registering the last branch arrival a second time.
export function prepareParallelJoin(checkpoint: ParallelCheckpoint) {
  const entry = checkpoint.queue[0];
  if (!entry) throw new Error("汇聚执行队列为空。");
  if (entry.releasedJoinFrameId) return { checkpoint, ready: true };
  const frameId = entry.tokens[entry.tokens.length - 1]?.frameId;
  let frames = checkpoint.frames;
  if (entry.loopCursor !== undefined) {
    const token = entry.tokens[entry.tokens.length - 1];
    if (!token || !frames[token.frameId]) throw new Error("循环汇聚缺少分支身份。");
    frames = { ...frames, [token.frameId]: { ...frames[token.frameId], loopCursors: {
      ...frames[token.frameId].loopCursors, [token.branchId]: restoreWorkflowLoopCursor(entry.loopCursor),
    } } };
  }
  const arrival = reachParallelJoin(
    frames,
    entry.nodeId,
    entry.tokens
  );
  const ready = arrival.disposition === "release";
  const cursors = frameId ? arrival.state[frameId]?.loopCursors : undefined;
  if (ready && cursors && arrival.state[frameId!].barrier.expected.some(branch => !Object.hasOwn(cursors, branch)))
    throw new Error("循环汇聚缺少已完成分支的迭代检查点。");
  return {
    ready,
    checkpoint: {
      ...checkpoint,
      frames: arrival.state,
      queue: ready
        ? [
            {
              ...entry,
              tokens: arrival.tokens,
              releasedJoinFrameId: frameId,
              ...(cursors ? { loopCursor: mergeWorkflowLoopCursors(Object.values(cursors)) } : {}),
            },
            ...checkpoint.queue.slice(1),
          ]
        : checkpoint.queue.slice(1),
    },
  };
}
