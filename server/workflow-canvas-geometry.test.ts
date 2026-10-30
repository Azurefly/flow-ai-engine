import { describe, expect, it } from "vitest";
import { canvasBounds, canvasConnectionPoints, canvasContextIds, canvasEdgeLabelAnchor, canvasHasCrowding, canvasHasDiscreteMove, canvasNodeRects, readableCanvasLayout, roundedCanvasPath } from "../client/src/components/workflow-canvas-geometry";

const node = (id: string, x = 0, y = 0, height = 88) => ({ id, position: { x, y }, measured: { width: 208, height }, data: { kind: "router", config: { original: true } } });
const overlaps = (a: ReturnType<typeof canvasNodeRects>[number], b: ReturnType<typeof canvasNodeRects>[number]) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
// Independent segment/body oracle, without routing's clearance margin.
function crossesBody(points: { x: number; y: number }[], r: ReturnType<typeof canvasNodeRects>[number]) {
  return points.slice(1).some((p, i) => {
    const q = points[i];
    return p.x === q.x ? p.x > r.x && p.x < r.x + r.width && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.height : p.y > r.y && p.y < r.y + r.height && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.width;
  });
}
describe("画布阅读布局与连线可见性", () => {
  it("短分支标签留在两节点之间，回退标签沿外侧长通道显示", () => {
    const rects = canvasNodeRects([node("a", 40, 40), node("b", 376, 40)]);
    const points = canvasConnectionPoints({ x: 252, y: 70 }, { x: 372, y: 84 }, rects, "a", "b");
    const label = canvasEdgeLabelAnchor(points, 0.87), halfWidth = 64 / 0.87 / 2;
    expect(label.x - halfWidth).toBeGreaterThan(rects[0].x + rects[0].width);
    expect(label.x + halfWidth).toBeLessThan(rects[1].x);
    const back = canvasConnectionPoints({ x: 588, y: 84 }, { x: 36, y: 84 }, rects, "b", "a");
    expect(canvasEdgeLabelAnchor(back, 0.87).y).toBeLessThan(Math.min(...rects.map(r => r.y)));
  });
  it("键盘移动生成一次显式编辑，尺寸、选择、未移动及鼠标手势不重复记历史", () => {
    const nodes = [node("a", 40, 40), node("b", 376, 40)];
    const changes = [{ id: "a", type: "position", position: { x: 45, y: 40 }, dragging: false }, { id: "b", type: "position", position: { x: 381, y: 40 }, dragging: false }];
    expect(canvasHasDiscreteMove(nodes, changes)).toBe(true);
    expect(canvasHasDiscreteMove(nodes, changes, true)).toBe(false);
    expect(canvasHasDiscreteMove(nodes, [{ ...changes[0], dragging: true }])).toBe(false);
    expect(canvasHasDiscreteMove(nodes, [{ id: "a", type: "dimensions" }, { id: "a", type: "select" }, { ...changes[0], position: { x: 40, y: 40 } }])).toBe(false);
    expect(nodes[0].position).toEqual({ x: 40, y: 40 });
  });
  it("旧流程150/200间距的7个节点不再遮线，也不改写原始定义", () => {
    const nodes = [0, 150, 300, 500, 700, 900, 1100].map((x, i) => node(String(i), x));
    const edges = nodes.slice(1).map((n, i) => ({ source: String(i), target: n.id }));
    const snapshot = JSON.stringify({ nodes, edges });
    expect(canvasHasCrowding(nodes)).toBe(true);
    const projected = readableCanvasLayout(nodes, edges), rects = canvasNodeRects(projected);
    expect(canvasHasCrowding(projected)).toBe(false);
    for (let i = 1; i < rects.length; i++) expect(rects[i].x - rects[i - 1].x - rects[i - 1].width).toBeGreaterThanOrEqual(96);
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
    expect(projected.map(n => n.data)).toEqual(nodes.map(n => n.data));
  });
  it("分叉、合流、长边、回退及自环均绕开节点实体，尺寸与导出边界包含外侧通道", () => {
    const nodes = [node("start"), node("a", 0, 0, 200), node("b"), node("join"), node("end"), node("isolated")];
    const edges = [{ source: "start", target: "a" }, { source: "start", target: "b" }, { source: "a", target: "join" }, { source: "b", target: "join" }, { source: "join", target: "end" }, { source: "start", target: "end" }, { source: "join", target: "a", data: { loop: { maxIterations: 2 } } }, { source: "b", target: "b", data: { loop: {} } }];
    const rects = canvasNodeRects(readableCanvasLayout(nodes, edges));
    rects.forEach((r, i) => rects.slice(i + 1).forEach(s => expect(overlaps(r, s)).toBe(false)));
    const routes = edges.map((e, i) => {
      const s = rects.find(n => n.id === e.source)!, t = rects.find(n => n.id === e.target)!;
      const from = { x: s.x + s.width + 4, y: s.y + s.height / 2 }, to = { x: t.x - 4, y: t.y + t.height / 2 };
      const points = canvasConnectionPoints(from, to, rects, e.source, e.target, i);
      expect(points[0]).toEqual(from); expect(points.at(-1)).toEqual(to);
      for (const r of rects) expect(crossesBody(points, r), `${e.source}->${e.target} crosses ${r.id}`).toBe(false);
      expect(roundedCanvasPath(points)).not.toMatch(/NaN|Infinity/);
      return points;
    });
    const bounds = canvasBounds(rects, routes.flat());
    for (const p of routes.flat()) {
      expect(p.x).toBeGreaterThan(bounds.x); expect(p.x).toBeLessThan(bounds.x + bounds.width);
      expect(p.y).toBeGreaterThan(bounds.y); expect(p.y).toBeLessThan(bounds.y + bounds.height);
    }
  });
  it("未标注循环的历史图、重复边及缺失端点不会破坏排版", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const edges = [{ source: "a", target: "b" }, { source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "a" }, { source: "missing", target: "a" }];
    const result = readableCanvasLayout(nodes, edges);
    expect(canvasHasCrowding(result)).toBe(false);
    expect(result.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true);
    expect(edges).toHaveLength(5);
  });
  it("配置视图包含直接上下游，总览包含全部；空画布也有有效范围", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "c", target: "d" }];
    expect([...canvasContextIds(nodes, edges, "b")]).toEqual(["b", "a", "c"]);
    expect(canvasContextIds(nodes, edges).size).toBe(4);
    expect(canvasBounds([])).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(readableCanvasLayout([], edges)).toEqual([]);
  });
});
