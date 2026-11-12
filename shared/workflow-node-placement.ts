type PlacedNode = {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};
/** Find space near the visible canvas center without moving existing nodes. */
export function nextWorkflowNodePosition(
  nodes: PlacedNode[],
  center: { x: number; y: number }
) {
  const width = 240,
    height = 160,
    gap = 32;
  const origin = { x: center.x - width / 2, y: center.y - height / 2 };
  const free = (x: number, y: number) =>
    nodes.every(
      node =>
        x + width + gap <= node.position.x ||
        x >= node.position.x + (node.measured?.width ?? width) + gap ||
        y + height + gap <= node.position.y ||
        y >= node.position.y + (node.measured?.height ?? height) + gap
    );
  for (let ring = 0; ring <= nodes.length + 1; ring++) {
    for (let row = -ring; row <= ring; row++)
      for (let col = -ring; col <= ring; col++) {
        if (Math.max(Math.abs(row), Math.abs(col)) !== ring) continue;
        const x = origin.x + col * (width + gap),
          y = origin.y + row * (height + gap);
        if (free(x, y)) return { x, y };
      }
  }
  return {
    x:
      Math.max(
        origin.x,
        ...nodes.map(n => n.position.x + (n.measured?.width ?? width))
      ) + gap,
    y: origin.y,
  };
}
