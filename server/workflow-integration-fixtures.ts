import type { Definition } from "./workflow-service";

/** Keep each scenario's actions and assertions while giving state flows an
 * explicit initial business state and terminal business state. Test use only. */
export function executableStateFixture(definition: Definition): Definition {
  const initialId = "fixture-initial";
  const terminalId = "fixture-terminal";
  const nodes = definition.nodes.filter(
    node => ![initialId, terminalId].includes(node.id)
  );
  const start = nodes.find(node => node.type === "start");
  const end = nodes.find(node => node.type === "end");
  if (!start || !end)
    throw new Error("State fixture requires start and end nodes");
  const originalEdges = definition.edges.filter(
    edge => !["fixture-start", "fixture-end"].includes(edge.id)
  );
  const edges = originalEdges.filter(
    edge => edge.sourceNodeId !== start.id && edge.targetNodeId !== end.id
  );
  const actions = originalEdges
    .filter(
      edge => edge.sourceNodeId === start.id || edge.targetNodeId === end.id
    )
    .map(edge => ({
      ...edge,
      sourceNodeId:
        edge.sourceNodeId === start.id ? initialId : edge.sourceNodeId,
      targetNodeId:
        edge.targetNodeId === end.id ? terminalId : edge.targetNodeId,
    }));
  return {
    ...definition,
    nodes: [
      ...nodes,
      {
        id: initialId,
        type: "state",
        name: "已开始",
        position: { x: 100, y: -100 },
        config: {
          stateCode: "STARTED",
          displayName: "已开始",
          stateType: "business",
        },
      },
      {
        id: terminalId,
        type: "state",
        name: "已完成",
        position: { x: 400, y: -100 },
        config: {
          stateCode: "COMPLETED",
          displayName: "已完成",
          stateType: "business",
        },
      },
    ],
    edges: [
      ...edges,
      ...actions,
      { id: "fixture-start", sourceNodeId: start.id, targetNodeId: initialId },
      { id: "fixture-end", sourceNodeId: terminalId, targetNodeId: end.id },
    ],
  };
}

export function minimalStateFixture(): Definition {
  return executableStateFixture({
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: [
      {
        id: "start",
        type: "start",
        name: "开始",
        position: { x: 0, y: 0 },
        config: { initialVariables: {} },
      },
      {
        id: "end",
        type: "end",
        name: "结束",
        position: { x: 600, y: 0 },
        config: { resultTemplate: "{{vars}}" },
      },
    ],
    edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
  });
}
