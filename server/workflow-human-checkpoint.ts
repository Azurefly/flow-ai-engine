import { workflowTaskExecutionKey } from "./workflow-wait-execution-key";
import type { ParallelCheckpoint } from "./workflow-parallel-checkpoint";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const ids = (value: unknown) =>
  Array.isArray(value)
    ? value.map(Number).filter(id => Number.isInteger(id) && id > 0)
    : [];

/** Recover creation-time logical roles without replacing a newer execution queue. */
export function restoreHumanCreationRuntime(
  context: RecordValue,
  payload: unknown
) {
  const snapshot = record(record(record(payload).context).runtime);
  const runtime = record(context.runtime);
  runtime.participantUserIds = Array.from(
    new Set([
      ...ids(runtime.participantUserIds),
      ...ids(snapshot.participantUserIds),
    ])
  );
  const roles = record(runtime.roleKeysByUser);
  for (const [userId, keys] of Object.entries(
    record(snapshot.roleKeysByUser)
  )) {
    if (
      !Number.isInteger(Number(userId)) ||
      Number(userId) <= 0 ||
      !Array.isArray(keys)
    )
      continue;
    roles[userId] = Array.from(
      new Set([
        ...(Array.isArray(roles[userId]) ? roles[userId] : []),
        ...keys.map(String),
      ])
    );
  }
  runtime.roleKeysByUser = roles;
  context.runtime = runtime;
}

/** A decision may arrive after artifact commit but before the creator's checkpoint. */
export function completeCurrentHumanCheckpoint(
  runtime: RecordValue,
  nodeId: string,
  executionKey: unknown
) {
  if (
    runtime.atomicHumanTaskVersion !== 1 ||
    (runtime.executionCurrentNodeId != null &&
      runtime.executionCurrentNodeId !== nodeId) ||
    !Array.isArray(runtime.executionQueue) ||
    runtime.executionQueue[0] !== nodeId ||
    typeof executionKey !== "string"
  )
    return;
  const parallel = runtime.parallelCheckpoint as ParallelCheckpoint | undefined;
  const entry = parallel?.queue[0];
  if (parallel && (!entry || entry.nodeId !== nodeId)) return;
  const identityRuntime =
    parallel && runtime.durableTaskVersion === 2
      ? { ...runtime, executionLoopCursor: entry?.loopCursor }
      : runtime;
  if (
    workflowTaskExecutionKey(identityRuntime, entry?.tokens ?? []) !==
    executionKey
  )
    return;
  runtime.executionQueue = runtime.executionQueue.slice(1);
  parallel?.queue.shift();
  runtime.executionCurrentNodeId = null;
}
