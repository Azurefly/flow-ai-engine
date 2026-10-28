import { parseRunValue, type RunRecord } from "./run-execution-graph";

/** Return only historical graph geometry; resource configuration is not a view payload. */
export function dataflowRunSnapshot(value: unknown) {
  const snapshot = parseRunValue(value);
  const definition = snapshot?.definition ?? snapshot;
  return {
    nodes: (Array.isArray(definition?.nodes) ? definition.nodes : []).map(
      (node: RunRecord) => ({
        id: node?.id,
        name: node?.name,
        type: node?.type,
        position: node?.position && { x: node.position.x, y: node.position.y },
      })
    ),
    edges: (Array.isArray(definition?.edges) ? definition.edges : []).map(
      (edge: RunRecord) => ({
        id: edge?.id,
        sourceNodeId: edge?.sourceNodeId ?? edge?.source,
        targetNodeId: edge?.targetNodeId ?? edge?.target,
      })
    ),
  };
}

/** Durable records take precedence; older runs may only have completed output nodes. */
export function dataflowGraphRun(run: RunRecord) {
  const output = parseRunValue(run.output);
  const durable = Array.isArray(run.nodeRuns) && run.nodeRuns.length > 0;
  const records: RunRecord[] = durable
    ? run.nodeRuns
    : Array.isArray(output?.nodes)
      ? output.nodes
      : [];
  return {
    id: run.id,
    status: run.status,
    flowType: "data",
    definitionSnapshotJson: run.definitionSnapshot,
    nodeRuns: records.map((record, index) => ({
      ...record,
      id: record.id ?? `legacy-data-${index}`,
      sequenceNo: record.sequenceNo ?? index + 1,
      status: record.status ?? (durable ? "unknown" : "success"),
      inputJson: record.input,
      outputJson: record.output,
      errorJson: record.error,
    })),
  };
}
