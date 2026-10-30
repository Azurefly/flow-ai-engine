export type CanvasRect = { id: string; x: number; y: number; width: number; height: number };
type LayoutNode = { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: { kind?: string } };
type LayoutEdge = { source: string; target: string; data?: Record<string, unknown> };
export type CanvasPoint = { x: number; y: number };

/** Keyboard position batches need one history entry; pointer gestures own their history. */
export function canvasHasDiscreteMove(nodes: readonly LayoutNode[], changes: readonly { type: string; id?: string; position?: CanvasPoint; dragging?: boolean }[], pointerDragging = false) {
  return !pointerDragging && changes.some(change => {
    if (change.type !== "position" || !change.position || change.dragging) return false;
    const node = nodes.find(n => n.id === change.id);
    return node && (node.position.x !== change.position.x || node.position.y !== change.position.y);
  });
}

export function canvasNodeRects(nodes: readonly LayoutNode[]): CanvasRect[] {
  return nodes.map(n => ({ id: n.id, ...n.position, width: n.measured?.width || 208, height: n.measured?.height || 88 }));
}

export function canvasHasCrowding(nodes: readonly LayoutNode[]) {
  const rects = canvasNodeRects(nodes);
  return rects.some((a, i) => rects.slice(i + 1).some(b =>
    a.x < b.x + b.width + 96 && a.x + a.width + 96 > b.x &&
    a.y < b.y + b.height + 64 && a.y + a.height + 64 > b.y));
}

/** Reading projection only. Callers keep canonical positions for serialization and history. */
export function readableCanvasLayout<T extends LayoutNode>(nodes: T[], edges: readonly LayoutEdge[]): T[] {
  if (nodes.length < 2) return nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map(nodes.map(n => [n.id, [] as string[]]));
  for (const edge of edges) if (byId.has(edge.source) && byId.has(edge.target) && !edge.data?.loop)
    outgoing.get(edge.source)!.push(edge.target);
  const color = new Map<string, number>(), forward = new Map(nodes.map(n => [n.id, [] as string[]]));
  // Iterative DFS removes only display back-edges; all logical edges remain in the model.
  for (const root of nodes) {
    if (color.has(root.id)) continue;
    const stack = [{ id: root.id, index: 0 }]; color.set(root.id, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1], children = outgoing.get(frame.id)!;
      if (frame.index === children.length) { color.set(frame.id, 2); stack.pop(); continue; }
      const target = children[frame.index++];
      if (color.get(target) === 1) continue;
      forward.get(frame.id)!.push(target);
      if (!color.has(target)) { color.set(target, 1); stack.push({ id: target, index: 0 }); }
    }
  }
  const incoming = new Map(nodes.map(n => [n.id, [] as string[]]));
  for (const [source, targets] of Array.from(forward)) for (const target of targets) incoming.get(target)!.push(source);
  const remaining = new Map(nodes.map(n => [n.id, incoming.get(n.id)!.length]));
  const rank = new Map(nodes.map(n => [n.id, 0]));
  const queue = nodes.filter(n => !remaining.get(n.id)).map(n => n.id);
  for (let i = 0; i < queue.length; i++) for (const target of forward.get(queue[i])!) {
    rank.set(target, Math.max(rank.get(target)!, rank.get(queue[i])! + 1));
    remaining.set(target, remaining.get(target)! - 1);
    if (!remaining.get(target)) queue.push(target);
  }
  const buckets = new Map<number, T[]>();
  for (const node of nodes) { const r = rank.get(node.id)!; const bucket = buckets.get(r) ?? []; bucket.push(node); buckets.set(r, bucket); }
  const columns = Array.from(buckets).sort((a, b) => a[0] - b[0]);
  const sizes = new Map(canvasNodeRects(nodes).map(n => [n.id, n]));
  const heights = columns.map(([, column]) => column.reduce((sum, n) => sum + sizes.get(n.id)!.height, 0) + (column.length - 1) * 64);
  const height = Math.max(...heights), positions = new Map<string, CanvasPoint>();
  let x = 40;
  columns.forEach(([, column], index) => {
    const center = (n: T) => { const parents = incoming.get(n.id)!; return parents.length ? parents.reduce((sum, id) => sum + (positions.get(id)?.y ?? 0), 0) / parents.length : 0; };
    column.sort((a, b) => center(a) - center(b));
    let y = 40 + (height - heights[index]) / 2;
    for (const node of column) { positions.set(node.id, { x, y }); y += sizes.get(node.id)!.height + 64; }
    x += Math.max(...column.map(n => sizes.get(n.id)!.width)) + 128;
  });
  return nodes.map(node => ({ ...node, position: positions.get(node.id)! }));
}

export function canvasContextIds(nodes: readonly { id: string }[], edges: readonly LayoutEdge[], selected?: string | null) {
  const ids = new Set(selected ? [selected] : nodes.map(n => n.id));
  if (selected) for (const edge of edges) {
    if (edge.source === selected) ids.add(edge.target);
    if (edge.target === selected) ids.add(edge.source);
  }
  return ids;
}

export function canvasPathCrosses(points: CanvasPoint[], rect: CanvasRect) {
  return points.slice(1).some((b, i) => {
    const a = points[i];
    return a.x === b.x
      ? a.x > rect.x - 12 && a.x < rect.x + rect.width + 12 && Math.max(a.y, b.y) > rect.y - 12 && Math.min(a.y, b.y) < rect.y + rect.height + 12
      : a.y > rect.y - 12 && a.y < rect.y + rect.height + 12 && Math.max(a.x, b.x) > rect.x - 12 && Math.min(a.x, b.x) < rect.x + rect.width + 12;
  });
}

/** The column envelopes leave vertical channels clear even for unequal node widths. */
export function canvasConnectionPoints(source: CanvasPoint, target: CanvasPoint, rects: CanvasRect[], sourceId: string, targetId: string, lane = 0): CanvasPoint[] {
  const a = rects.find(n => n.id === sourceId), b = rects.find(n => n.id === targetId);
  const obstacles = rects.filter(n => n.id !== sourceId && n.id !== targetId);
  const sx = Math.max(source.x, ...rects.filter(n => a && n.x < a.x + a.width && n.x + n.width > a.x).map(n => n.x + n.width)) + 32;
  const tx = Math.min(target.x, ...rects.filter(n => b && n.x < b.x + b.width && n.x + n.width > b.x).map(n => n.x)) - 32;
  const mid = (sx + tx) / 2;
  let points = [source, { x: mid, y: source.y }, { x: mid, y: target.y }, target];
  if (target.x - source.x < 64 || obstacles.some(n => canvasPathCrosses(points, n))) {
    const y = Math.min(source.y, target.y, ...rects.map(n => n.y)) - 48 - lane * 24;
    points = [source, { x: sx, y: source.y }, { x: sx, y }, { x: tx, y }, { x: tx, y: target.y }, target];
  }
  return points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

export function roundedCanvasPath(points: CanvasPoint[]) {
  if (!points.length) return "";
  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1];
    const before = Math.hypot(p.x - a.x, p.y - a.y), after = Math.hypot(b.x - p.x, b.y - p.y);
    const r = Math.min(12, before / 2, after / 2);
    if (!before || !after) continue;
    path += ` L${p.x - (p.x - a.x) * r / before},${p.y - (p.y - a.y) * r / before} Q${p.x},${p.y} ${p.x + (b.x - p.x) * r / after},${p.y + (b.y - p.y) * r / after}`;
  }
  const last = points[points.length - 1];
  return path + ` L${last.x},${last.y}`;
}

export function canvasBounds(rects: CanvasRect[], points: CanvasPoint[] = []) {
  if (!rects.length) return { x: 0, y: 0, width: 400, height: 200 };
  const left = Math.min(...rects.map(n => n.x), ...points.map(p => p.x)), top = Math.min(...rects.map(n => n.y), ...points.map(p => p.y));
  return { x: left - 24, y: top - 32, width: Math.max(...rects.map(n => n.x + n.width), ...points.map(p => p.x)) - left + 48, height: Math.max(...rects.map(n => n.y + n.height), ...points.map(p => p.y)) - top + 64 };
}
