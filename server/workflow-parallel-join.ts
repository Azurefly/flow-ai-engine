import type { ParallelCheckpoint } from "./workflow-parallel-checkpoint";
import { reachParallelJoin } from "./workflow-parallel-state";

// Release and its pending node must be persisted together. A retry executes the
// pending join without registering the last branch arrival a second time.
export function prepareParallelJoin(checkpoint: ParallelCheckpoint) {
  const entry = checkpoint.queue[0];
  if (!entry) throw new Error("汇聚执行队列为空。");
  if (entry.releasedJoinFrameId) return { checkpoint, ready: true };
  const frameId = entry.tokens[entry.tokens.length - 1]?.frameId;
  const arrival = reachParallelJoin(
    checkpoint.frames,
    entry.nodeId,
    entry.tokens
  );
  const ready = arrival.disposition === "release";
  return {
    ready,
    checkpoint: {
      frames: arrival.state,
      queue: ready
        ? [
            {
              nodeId: entry.nodeId,
              tokens: arrival.tokens,
              releasedJoinFrameId: frameId,
            },
            ...checkpoint.queue.slice(1),
          ]
        : checkpoint.queue.slice(1),
    },
  };
}
