import { BaseEdge, useStore, type EdgeProps } from "@xyflow/react";
import { useId, useMemo } from "react";
import { canvasConnectionPoints, canvasEdgeLabelAnchor, roundedCanvasPath, type CanvasRect } from "./workflow-canvas-geometry";

/** Presentation only: original edge ids, handles, selection and connection events remain unchanged. */
export function CanvasConnectionEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, style, label, labelStyle }: EdgeProps) {
  const zoom = useStore(s => s.transform[2]);
  const marker = useId().replace(/:/g, "");
  const rects = (data?.canvasRects ?? []) as CanvasRect[];
  const points = useMemo(() => canvasConnectionPoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, rects, source, target, Number(data?.canvasLane ?? 0)), [sourceX, sourceY, targetX, targetY, rects, source, target, data?.canvasLane]);
  const path = useMemo(() => roundedCanvasPath(points), [points]);
  const emphasized = selected || Boolean(data?.canvasEmphasis);
  const color = selected ? "var(--aiflow-canvas-selected)" : data?.canvasStroke ? String(data.canvasStroke) : data?.loop ? "var(--aiflow-canvas-return)" : data?.outcomeColor ? String(data.outcomeColor) : "var(--aiflow-canvas-edge)";
  const anchor = canvasEdgeLabelAnchor(points, zoom), labelX = anchor.x;
  let labelY = anchor.y;
  const width = (String(label ?? "").length * 12 + 16) / zoom;
  for (let i = 0; i < 16 && rects.some(n => labelX + width / 2 > n.x && labelX - width / 2 < n.x + n.width && labelY + 10 / zoom > n.y && labelY - 10 / zoom < n.y + n.height); i++) labelY -= 24 / zoom;
  return <>
    <defs><marker id={marker} markerUnits="userSpaceOnUse" viewBox="0 0 12 12" refX="12" refY="6" markerWidth={9 / zoom} markerHeight={9 / zoom} orient="auto"><path d="M1 1 L11 6 L1 11 Z" fill={color} /></marker></defs>
    <BaseEdge id={id} path={path} interactionWidth={24 / zoom} markerEnd={`url(#${marker})`} style={{ ...style, stroke: color, strokeWidth: (emphasized ? 3 : 2) / zoom, strokeDasharray: data?.loop ? `${7 / zoom} ${5 / zoom}` : undefined }} label={label} labelX={labelX} labelY={labelY} labelStyle={{ ...labelStyle, fill: "var(--foreground)", fontSize: 12 / zoom }} labelBgPadding={[6 / zoom, 4 / zoom]} labelBgBorderRadius={5 / zoom} labelBgStyle={{ fill: "var(--card)", fillOpacity: 0.98 }} />
  </>;
}
