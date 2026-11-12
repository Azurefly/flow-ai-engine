import { expect, it } from "vitest";
import { nextWorkflowNodePosition } from "./workflow-node-placement";
it("连续添加节点时避开已有大小不同的节点，保持已有坐标", () => {
  const original = {
    position: { x: 100, y: 100 },
    measured: { width: 450, height: 300 },
  };
  const nodes = [original];
  for (let i = 0; i < 30; i++) {
    const position = nextWorkflowNodePosition(nodes, { x: 300, y: 200 });
    expect(
      nodes.every(
        n =>
          position.x + 240 <= n.position.x ||
          position.x >= n.position.x + n.measured.width ||
          position.y + 160 <= n.position.y ||
          position.y >= n.position.y + n.measured.height
      )
    ).toBe(true);
    nodes.push({ position, measured: { width: 240, height: 160 } });
  }
  expect(original.position).toEqual({ x: 100, y: 100 });
});
