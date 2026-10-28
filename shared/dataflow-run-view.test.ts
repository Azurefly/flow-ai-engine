import { describe, expect, it } from "vitest";
import { dataflowGraphRun, dataflowRunSnapshot } from "./dataflow-run-view";
import { projectRunGraph, resolveRunGraphFocus } from "./run-execution-graph";

const definition = {
  nodes: [
    {
      id: "source",
      name: "历史数据源",
      type: "source",
      position: { x: 10, y: 20 },
      config: { password: "private", rows: [{ personal: "data" }] },
    },
    { id: "join", name: "历史关联", type: "join" },
    { id: "output", name: "历史输出", type: "output" },
  ],
  edges: [
    {
      id: "a",
      sourceNodeId: "source",
      targetNodeId: "join",
      config: { token: "private" },
    },
    { id: "b", sourceNodeId: "join", targetNodeId: "output" },
  ],
  resources: { secret: "private" },
};
describe("数据实例的不可变关系与执行事实", () => {
  it("快照仅投影节点身份、名称、类型、坐标与依赖，不返回资源配置", () => {
    const snapshot = dataflowRunSnapshot(JSON.stringify({ definition }));
    expect(snapshot.nodes[0]).toEqual({
      id: "source",
      name: "历史数据源",
      type: "source",
      position: { x: 10, y: 20 },
    });
    expect(snapshot.edges[0]).toEqual({
      id: "a",
      sourceNodeId: "source",
      targetNodeId: "join",
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /password|private|personal|resources|config/
    );
    expect(definition.nodes[0].config).toHaveProperty("password", "private");
  });
  it("接受旧图边格式，损坏快照仍显式降级，不从执行顺序虚构连线", () => {
    expect(
      dataflowRunSnapshot({ nodes: [], edges: [{ source: "x", target: "y" }] })
        .edges[0]
    ).toMatchObject({ sourceNodeId: "x", targetNodeId: "y" });
    const run = dataflowGraphRun({
      id: "legacy",
      status: "success",
      definitionSnapshot: dataflowRunSnapshot("broken"),
      output: {
        nodes: [{ nodeId: "x", output: { rows: [] } }, { nodeId: "y" }],
      },
    });
    const graph = projectRunGraph(run);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([]);
    expect(graph.warning).toContain("缺少流程快照");
  });
  it("失败记录优先定位，未执行下游仍未执行，灰线不冒充实际血缘", () => {
    const run = dataflowGraphRun({
      id: "failed",
      status: "failed",
      definitionSnapshot: dataflowRunSnapshot(definition),
      nodeRuns: [
        {
          id: "nr1",
          nodeId: "source",
          status: "success",
          sequenceNo: 1,
          rowCount: 0,
          output: { rows: [] },
        },
        {
          id: "nr2",
          nodeId: "join",
          status: "failed",
          sequenceNo: 2,
          attempt: 3,
          error: { message: "左右输入不匹配" },
        },
      ],
    });
    const graph = projectRunGraph(run);
    expect(resolveRunGraphFocus(run, graph.nodes)).toEqual({
      nodeId: "join",
      recordId: "nr2",
    });
    expect(graph.nodes.map(n => [n.name, n.status])).toEqual([
      ["历史数据源", "success"],
      ["历史关联", "failed"],
      ["历史输出", "idle"],
    ]);
    expect(graph.nodes[0].records[0]).toMatchObject({
      rowCount: 0,
      outputJson: { rows: [] },
    });
    expect(graph.nodes[1].records[0]).toMatchObject({
      attempt: 3,
      errorJson: { message: "左右输入不匹配" },
    });
    expect(graph.edges.map(e => e.confirmed)).toEqual([0, 0]);
  });
  it("持久化执行记录优先于旧输出摘要，不重复计数或伪装成功", () => {
    const run = dataflowGraphRun({
      id: "live",
      status: "running",
      nodeRuns: [
        { id: "actual", nodeId: "join", status: "running", attempt: 2 },
      ],
      output: { nodes: [{ nodeId: "join", status: "success" }] },
    });
    expect(run.nodeRuns).toHaveLength(1);
    expect(run.nodeRuns[0]).toMatchObject({
      id: "actual",
      status: "running",
      attempt: 2,
    });
    expect(projectRunGraph(run).nodes[0].status).toBe("running");
  });
  it("没有节点记录的排队实例展示快照，取消后遗留运行节点显示已停止", () => {
    const queued = projectRunGraph(
      dataflowGraphRun({
        id: "queued",
        status: "queued",
        definitionSnapshot: dataflowRunSnapshot(definition),
        nodeRuns: [],
      })
    );
    expect(queued.nodes.every(node => node.status === "idle")).toBe(true);
    const cancelled = projectRunGraph(
      dataflowGraphRun({
        id: "cancelled",
        status: "cancelled",
        definitionSnapshot: dataflowRunSnapshot(definition),
        nodeRuns: [{ id: "actual", nodeId: "source", status: "running" }],
      })
    );
    expect(cancelled.nodes[0]).toMatchObject({
      status: "stopped",
      activeCount: 0,
    });
  });
});
