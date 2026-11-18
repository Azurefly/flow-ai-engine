import { BaseEdge, EdgeText, useStore, type EdgeProps } from "@xyflow/react";
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
  // Overview geometry cannot fit fixed-screen-size labels; selected routes remain readable.
  const visibleLabel = zoom >= 0.4 || emphasized ? label : undefined;
  const color = selected ? "var(--aiflow-canvas-selected)" : data?.canvasStroke ? String(data.canvasStroke) : data?.loop ? "var(--aiflow-canvas-return)" : data?.outcomeColor ? String(data.outcomeColor) : "var(--aiflow-canvas-edge)";
  const anchor = canvasEdgeLabelAnchor(points, zoom), labelX = anchor.x;
  let labelY = anchor.y;
  const width = (String(label ?? "").length * 12 + 16) / zoom;
  for (let i = 0; visibleLabel && i < 16 && rects.some(n => labelX + width / 2 > n.x && labelX - width / 2 < n.x + n.width && labelY + 10 / zoom > n.y && labelY - 10 / zoom < n.y + n.height); i++) labelY -= 24 / zoom;
  return <>
    <defs><marker id={marker} markerUnits="userSpaceOnUse" viewBox="0 0 12 12" refX="12" refY="6" markerWidth={9 / zoom} markerHeight={9 / zoom} orient="auto"><path d="M1 1 L11 6 L1 11 Z" fill={color} /></marker></defs>
    {label && <title>{String(label)}</title>}
    <BaseEdge id={id} path={path} interactionWidth={24 / zoom} markerEnd={`url(#${marker})`} style={{ ...style, stroke: color, strokeWidth: (emphasized ? 3 : 2) / zoom, strokeDasharray: data?.loop ? `${7 / zoom} ${5 / zoom}` : undefined }} />
    {/* EdgeText measures on label changes. Scale the measured text and background together. */}
    {visibleLabel && (
      <g transform={`translate(${labelX} ${labelY}) scale(${1 / zoom})`}>
        <EdgeText x={0} y={0} label={visibleLabel}
          labelStyle={{ ...labelStyle, fill: "var(--foreground)", fontSize: 12, textRendering: "geometricPrecision" }}
          labelBgPadding={[6, 4]} labelBgBorderRadius={5}
          labelBgStyle={{ fill: "var(--card)", fillOpacity: 0.98 }} />
      </g>
    )}
  </>;
}
