import { PARTICIPANT_STATE_MODEL } from "./participant-state";
import { readOperateOutcomes } from "./workflow-node-contract";
import type { parseRunValue, RunGraphNode, RunRecord } from "./run-execution-graph";

/** Participant visits are stored once per node and command, with a list of the
 * people who passed through. Task creation order is independent of that path. */
export function participantRunRoute(run: RunRecord, nodes: RunGraphNode[], edges: RunRecord[], parse: typeof parseRunValue) {
  const byNode = new Map(nodes.map(node => [node.id, node]));
  const records = (run.nodeRuns ?? []) as RunRecord[];
  const byRecord = new Map(records.map(record => [record.id, record]));
  const tasks = new Map<string, RunRecord>((run.taskActivities ?? []).map((task: RunRecord) => [task.id, task]));
  const outgoing = new Map<string, RunRecord[]>();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    outgoing.get(edge.source)!.push(edge);
  }
  const visits = new Map<number, Map<string, Map<string, RunRecord>>>();
  for (const record of records) {
    if (record.status !== "success" || parse(record.inputJson)?.model !== PARTICIPANT_STATE_MODEL) continue;
    const output = parse(record.outputJson);
    if (!Number.isSafeInteger(output?.stateVersion) || !Array.isArray(output.userIds)) continue;
    if (!visits.has(output.stateVersion)) visits.set(output.stateVersion, new Map());
    const group = visits.get(output.stateVersion)!;
    for (const id of output.userIds) {
      const user = String(id);
      if (!group.has(user)) group.set(user, new Map());
      group.get(user)!.set(record.nodeId, record);
    }
  }
  const routes = new Map<string, { records: Set<string>; shared: boolean }>();
  const mark = (connections: RunRecord[], from?: RunRecord, to?: RunRecord) => {
    if (!connections.length) return;
    // Duplicate endpoints prove the node-to-node hop, but the old record may
    // lack the rule necessary to distinguish its parallel connectors.
    const id = connections[0].id;
    const fact = routes.get(id) ?? { records: new Set<string>(), shared: false };
    if (connections.length > 1) fact.shared = true;
    if (from?.id) fact.records.add(from.id);
    if (to?.id) fact.records.add(to.id);
    routes.set(id, fact);
  };
  for (const change of run.stateTransitions ?? []) {
    const payload = parse(change.payloadJson);
    const group = visits.get(change.sequenceNo);
    if (payload?.model !== PARTICIPANT_STATE_MODEL || !group || !Array.isArray(payload.changes)) continue;
    const task = tasks.get(change.taskId);
    const actor = payload.changes.find((item: RunRecord) => String(item?.userId) === String(change.actorUserId));
    const action = task?.status === "completed" ? byRecord.get(task.nodeRunId) : undefined;
    const source = action?.status === "success" ? byNode.get(action.nodeId) :
      change.transitionCode === "initialize" ? nodes.find(node => node.type === "start") : undefined;
    if (!source) continue;
    const code = parse(action?.outputJson)?.outcome;
    const outcome = action && readOperateOutcomes(source.config ?? {}).find(item => item.code === code);
    const dispatches = (outgoing.get(source.id) ?? []).filter(edge => !action ||
      (outcome && outcome.sourceHandle === String(edge.sourceHandle ?? "default")));
    if (dispatches.length !== 1) continue;
    const dispatch = dispatches[0];
    if (action) {
      const origin = actor?.before?.stateNodeId;
      const before = visits.get(actor?.before?.version)?.get(String(change.actorUserId));
      if (origin) mark((outgoing.get(origin) ?? []).filter(edge => edge.target === source.id), before?.get(origin), action);
    }
    for (const person of payload.changes) {
      const passed = group.get(String(person?.userId));
      const destination = person?.after?.stateNodeId;
      if (!passed?.has(dispatch.target) || !passed.has(destination)) continue;
      const remaining = new Set(passed.keys());
      const hops: { edges: RunRecord[]; from: string; to: string }[] = [];
      let cursor = dispatch.target;
      remaining.delete(cursor);
      while (cursor !== destination && byNode.get(cursor)?.type === "router") {
        const candidates = (outgoing.get(cursor) ?? []).filter(edge => remaining.has(edge.target));
        if (!candidates.length || candidates.some(edge => edge.target !== candidates[0].target)) break;
        const next = candidates[0].target;
        hops.push({ edges: candidates, from: cursor, to: next });
        cursor = next;
        remaining.delete(cursor);
      }
      if (cursor !== destination || remaining.size) continue;
      mark(dispatches, action ?? source.records[0], passed.get(dispatch.target));
      for (const hop of hops) mark(hop.edges, passed.get(hop.from), passed.get(hop.to));
    }
  }
  for (const end of nodes.filter(node => node.type === "end")) {
    const visit = end.records.find(record => record.status === "success");
    const cards = parse(visit?.outputJson)?.cards as Record<string, RunRecord> | undefined;
    for (const origin of Array.from(new Set(Object.values(cards ?? {}).map(card => card?.stateNodeId)))) {
      const state = byNode.get(origin);
      if (!state?.records.length) continue;
      mark((outgoing.get(origin) ?? []).filter(edge => edge.target === end.id), state.records.at(-1), visit);
    }
  }
  return routes;
}
