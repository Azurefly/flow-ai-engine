import { describe, it, expect } from "vitest";
import {
  projectRunGraph,
  resolveRunGraphFocus,
  resolveRunGraphRecord,
} from "../shared/run-execution-graph";
const definition = {
  nodes: [
    { id: "start", name: "开始", type: "start" },
    {
      id: "review",
      name: "审核",
      type: "operate",
      config: {
        outcomeMode: "explicit",
        outcomes: [
          { code: "confirmed", label: "通过", sourceHandle: "pass" },
          { code: "returned", label: "退回", sourceHandle: "back" },
        ],
      },
    },
    { id: "done", name: "完成", type: "end" },
  ],
  edges: [
    { id: "first", sourceNodeId: "start", targetNodeId: "review" },
    {
      id: "pass",
      sourceNodeId: "review",
      targetNodeId: "done",
      sourceHandle: "pass",
    },
    {
      id: "return",
      sourceNodeId: "review",
      targetNodeId: "start",
      sourceHandle: "back",
    },
  ],
};
const run = (extra: Record<string, unknown> = {}) => ({
  id: "run-1",
  status: "waiting",
  definitionSnapshotJson: definition,
  nodeRuns: [],
  ...extra,
});
describe("实例执行画布投影", () => {
  it("查看其他节点后返回来源节点保留任务批次，明确选择可以覆盖来源", () => {
    const data = run({
      status: "success",
      taskActivities: [{ id: "task-a", nodeId: "review", nodeRunId: "a" }],
      nodeRuns: [
        { id: "a", nodeId: "review", status: "success", sequenceNo: 2, outputJson: { branch: "A" } },
        { id: "b", nodeId: "review", status: "success", sequenceNo: 5, outputJson: { branch: "B" } },
        { id: "end", nodeId: "done", status: "success", sequenceNo: 6 },
      ],
    });
    const { nodes } = projectRunGraph(data);
    const focus = resolveRunGraphFocus(data, nodes, "task-a");
    const review = nodes.find(node => node.id === "review");
    expect(resolveRunGraphRecord(review, focus, "")?.outputJson.branch).toBe("A");
    expect(resolveRunGraphRecord(nodes.find(node => node.id === "done"), focus, "")?.id).toBe("end");
    expect(resolveRunGraphRecord(review, focus, "")?.id).toBe("a");
    expect(resolveRunGraphRecord(review, focus, "b")?.outputJson.branch).toBe("B");
    expect(resolveRunGraphRecord(review, focus, "missing-batch")).toBeUndefined();
  });
  it("旧任务缺少批次映射时，切换节点不会把最新一批当作其办理结果", () => {
    const data = run({
      taskActivities: [{ id: "legacy", nodeId: "review" }],
      nodeRuns: [
        { id: "a", nodeId: "review", status: "waiting", sequenceNo: 2 },
        { id: "b", nodeId: "review", status: "success", sequenceNo: 5 },
      ],
    });
    const { nodes } = projectRunGraph(data);
    const node = nodes.find(node => node.id === "review");
    const focus = resolveRunGraphFocus(data, nodes, "legacy");
    expect(focus.warning).toBeTruthy();
    expect(resolveRunGraphRecord(node, focus, "")).toBeUndefined();
    expect(resolveRunGraphRecord(node, focus, "b")?.id).toBe("b");
    expect(resolveRunGraphRecord(node, {}, "")?.id).toBe("a");
  });
  it("来源任务精确选择并行共享节点的各自批次，不被最新批次覆盖", () => {
    const data = run({
      status: "success",
      taskActivities: [
        { id: "task-a", nodeId: "review", nodeRunId: "a" },
        { id: "task-b", nodeId: "review", nodeRunId: "b" },
      ],
      nodeRuns: [
        { id: "a", nodeId: "review", status: "success", sequenceNo: 2 },
        { id: "b", nodeId: "review", status: "success", sequenceNo: 5 },
      ],
    });
    const { nodes } = projectRunGraph(data);
    expect(resolveRunGraphFocus(data, nodes, "task-a")).toEqual({
      nodeId: "review",
      recordId: "a",
    });
    expect(resolveRunGraphFocus(data, nodes, "task-b")).toEqual({
      nodeId: "review",
      recordId: "b",
    });
    data.taskActivities[0].nodeRunId = undefined;
    expect(resolveRunGraphFocus(data, nodes, "task-a")).toMatchObject({
      nodeId: "review",
      warning: expect.any(String),
    });
    expect(
      resolveRunGraphFocus(data, nodes, "task-a").recordId
    ).toBeUndefined();
    expect(
      resolveRunGraphFocus(data, nodes, "foreign-task").nodeId
    ).toBeUndefined();
  });
  it("已完成实例按实际执行顺序定位，定义末尾的开始节点不会抢占焦点", () => {
    const data = run({
      status: "success",
      definitionSnapshotJson: {
        ...definition,
        nodes: [...definition.nodes].reverse(),
      },
      nodeRuns: [
        { id: "first", nodeId: "start", sequenceNo: 1, status: "success" },
        { id: "final", nodeId: "done", sequenceNo: 6, status: "success" },
      ],
    });
    expect(resolveRunGraphFocus(data, projectRunGraph(data).nodes)).toEqual({
      nodeId: "done",
      recordId: "final",
    });
    data.nodeRuns.push({ id: "retry", nodeId: "review", sequenceNo: 2, status: "failed" });
    expect(resolveRunGraphFocus(data, projectRunGraph(data).nodes).recordId).toBe("final");
  });
  it("运行中定位等待批次，失败实例优先定位错误", () => {
    const data = run({
      nodeRuns: [
        { id: "wait", nodeId: "review", sequenceNo: 2, status: "waiting" },
        { id: "later", nodeId: "done", sequenceNo: 5, status: "success" },
      ],
    });
    expect(
      resolveRunGraphFocus(data, projectRunGraph(data).nodes).recordId
    ).toBe("wait");
    data.status = "failed";
    data.nodeRuns[0].status = "failed";
    expect(
      resolveRunGraphFocus(data, projectRunGraph(data).nodes).recordId
    ).toBe("wait");
  });
  it("以运行快照展示完整流程，未执行节点不伪装完成", () => {
    const graph = projectRunGraph(
      run({
        nodeRuns: [
          { id: "r1", nodeId: "review", status: "waiting", sequenceNo: 2 },
        ],
      })
    );
    expect(graph.nodes.map(n => [n.id, n.status])).toEqual([
      ["start", "idle"],
      ["review", "waiting"],
      ["done", "idle"],
    ]);
    expect(graph.edges).toHaveLength(3);
  });
  it("同节点多次执行保持独立记录，按执行序号排序", () => {
    const original = [
      { id: "r2", nodeId: "review", status: "success", sequenceNo: 9 },
      { id: "r1", nodeId: "review", status: "failed", sequenceNo: 2 },
    ];
    const graph = projectRunGraph(run({ nodeRuns: original }));
    expect(graph.nodes.find(n => n.id === "review")).toMatchObject({
      status: "success",
      records: [{ id: "r1" }, { id: "r2" }],
    });
    expect(original[0].id).toBe("r2");
  });
  it("并行重复节点尚有等待时不能仅取最新完成记录", () => {
    const graph = projectRunGraph(
      run({
        nodeRuns: [
          { id: "a", nodeId: "review", status: "waiting", sequenceNo: 1 },
          { id: "b", nodeId: "review", status: "success", sequenceNo: 2 },
        ],
      })
    );
    expect(graph.nodes.find(n => n.id === "review")).toMatchObject({
      status: "waiting",
      activeCount: 1,
    });
  });
  it.each(["cancelled", "terminated", "failed", "success"])(
    "实例%s后不把残留等待显示为仍可办理",
    status => {
      const graph = projectRunGraph(
        run({
          status,
          nodeRuns: [{ id: "a", nodeId: "review", status: "waiting" }],
        })
      );
      expect(graph.nodes.find(n => n.id === "review")).toMatchObject({
        status: "stopped",
        activeCount: 0,
      });
    }
  );
  it("仅根据人工实际业务结果标记对应出口", () => {
    const graph = projectRunGraph(
      run({
        nodeRuns: [
          {
            id: "a",
            nodeId: "review",
            status: "success",
            outputJson: JSON.stringify({ outcome: "returned" }),
          },
          { id: "b", nodeId: "done", status: "success" },
        ],
      })
    );
    expect(graph.edges.find(e => e.id === "return")?.confirmed).toBe(1);
    expect(graph.edges.find(e => e.id === "pass")?.confirmed).toBe(0);
    expect(graph.edges.find(e => e.id === "first")?.confirmed).toBe(0);
  });
  it("反复经过不同出口分别计数，不从时间相邻猜路径", () => {
    const graph = projectRunGraph(
      run({
        nodeRuns: [
          {
            nodeId: "review",
            status: "success",
            outputJson: { outcome: "returned" },
            sequenceNo: 1,
          },
          {
            nodeId: "review",
            status: "success",
            outputJson: { outcome: "confirmed" },
            sequenceNo: 5,
          },
        ],
      })
    );
    expect(graph.edges.filter(e => e.confirmed).map(e => e.confirmed)).toEqual([
      1, 1,
    ]);
  });
  it("条件和路由选择来自实际输出", () => {
    const def = {
      nodes: [
        {
          id: "c",
          type: "condition",
          config: { trueHandle: "yes", falseHandle: "no" },
        },
        { id: "router", type: "router" },
        { id: "end", type: "end" },
      ],
      edges: [
        {
          id: "yes",
          sourceNodeId: "c",
          targetNodeId: "end",
          sourceHandle: "yes",
        },
        {
          id: "no",
          sourceNodeId: "c",
          targetNodeId: "router",
          sourceHandle: "no",
        },
        {
          id: "chosen",
          sourceNodeId: "router",
          targetNodeId: "end",
          sourceHandle: "picked",
        },
      ],
    };
    const graph = projectRunGraph(
      run({
        definitionSnapshotJson: def,
        nodeRuns: [
          { nodeId: "c", status: "success", outputJson: { matched: false } },
          {
            nodeId: "router",
            status: "success",
            outputJson: {
              selectedBranches: [{ handle: "picked", targetNodeId: "end" }],
            },
          },
        ],
      })
    );
    expect(graph.edges.map(e => [e.id, e.confirmed])).toEqual([
      ["yes", 0],
      ["no", 1],
      ["chosen", 1],
    ]);
  });
  it("循环保留连线且自动布局有限、无重叠、不改快照", () => {
    const before = JSON.stringify(definition);
    const graph = projectRunGraph(run());
    expect(graph.edges.some(e => e.returning)).toBe(true);
    expect(new Set(graph.nodes.map(n => JSON.stringify(n.layout))).size).toBe(
      3
    );
    expect(Math.max(...graph.nodes.map(n => n.layout.x))).toBeLessThanOrEqual(
      3 * 310
    );
    expect(JSON.stringify(definition)).toBe(before);
  });
  it("历史缺快照只显示实际记录，不编造连线", () => {
    const graph = projectRunGraph(
      run({
        definitionSnapshotJson: "bad json",
        nodeRuns: [{ nodeId: "old", nodeName: "历史办理", status: "success" }],
      })
    );
    expect(graph.nodes[0].name).toBe("历史办理");
    expect(graph.edges).toEqual([]);
    expect(graph.warning).toContain("缺少流程快照");
  });
  it("异常快照跳过重复和缺失端点并清楚提示", () => {
    const graph = projectRunGraph(
      run({
        definitionSnapshotJson: {
          nodes: [{ id: "a" }, { id: "a" }],
          edges: [{ id: "e", sourceNodeId: "a", targetNodeId: "unknown" }],
        },
      })
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.warning).toContain("不完整");
  });
  it("未知状态与原型名称不会被当成有效运行状态", () => {
    expect(
      projectRunGraph(
        run({ nodeRuns: [{ nodeId: "review", status: "constructor" }] })
      ).nodes.find(n => n.id === "review")?.status
    ).toBe("idle");
  });
  it("长链使用迭代布局，避免递归调用栈溢出", () => {
    const nodes = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
    const edges = nodes.slice(1).map((_, i) => ({
      id: "e" + i,
      sourceNodeId: String(i),
      targetNodeId: String(i + 1),
    }));
    const graph = projectRunGraph(
      run({ definitionSnapshotJson: { nodes, edges } })
    );
    expect(graph.nodes).toHaveLength(2000);
    expect(graph.nodes.at(-1)?.layout.x).toBe(1999 * 310);
  });
});
