import { BaseEdge, EdgeText, useStore, type EdgeProps } from "@xyflow/react";
import { useId, useMemo } from "react";
import { canvasConnectionPoints, canvasEdgeLabelAnchor, roundedCanvasPath, type CanvasRect } from "./workflow-canvas-geometry";
import "./canvas-connections.css";

/** Presentation only: original edge ids, handles, selection and connection events remain unchanged. */
export function CanvasConnectionEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, style, label }: EdgeProps) {
  const zoom = useStore(s => s.transform[2]);
  const marker = useId().replace(/:/g, "");
  const rects = (data?.canvasRects ?? []) as CanvasRect[];
  const lane = Number(data?.canvasLane ?? 0);
  const points = useMemo(() => canvasConnectionPoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, rects, source, target, lane), [sourceX, sourceY, targetX, targetY, rects, source, target, lane]);
  const path = useMemo(() => roundedCanvasPath(points), [points]);
  const located = Boolean(data?.canvasEmphasis);
  const traced = Boolean(data?.canvasTrace);
  const focused = selected || located || Boolean(data?.canvasFlow);
  const outcome = data?.canvasTone === "approve" || data?.canvasTone === "reject" ? data.canvasTone : undefined;
  const tone = focused ? "selected" : traced ? "trace" : data?.canvasTone ?? (data?.loop ? "return" : "edge");
  const color = `var(--aiflow-canvas-${tone})`;
  const arrowSize = (located ? 13 : focused || traced ? 11 : 9) / zoom;
  const title = String(label ?? "");
  const letters = Array.from(title);
  const compact = letters.length > 18 ? letters.slice(0, 17).join("") + "…" : title;
  const width = Array.from(compact).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 13 : 8), 14);
  const anchor = title && canvasEdgeLabelAnchor(points, zoom, width, rects, outcome);
  return <>
    <defs><marker id={marker} markerUnits="userSpaceOnUse" viewBox="0 0 12 12" refX="11" refY="6" markerWidth={arrowSize} markerHeight={arrowSize} orient="auto"><path d="M1 2 L11 6 L1 10 L3 6 Z" fill={color} /></marker></defs>
    {title && <title>{title}</title>}
    {located && <path className="aiflow-edge-halo" d={path} fill="none" stroke="var(--card)" strokeWidth={8} vectorEffect="non-scaling-stroke" pointerEvents="none" aria-hidden="true" />}
    <BaseEdge id={id} path={path} interactionWidth={24 / zoom} markerEnd={`url(#${marker})`}
      style={{ ...style, stroke: color, strokeWidth: (located ? 4 : focused ? 3.3 : traced ? 2.6 : 1.7) / zoom, strokeDasharray: "none", strokeLinecap: "round", strokeLinejoin: "round" }} />
    {data?.canvasFlow ? <path key={String(data.canvasFlow)} className="run-edge-flow" d={path} pathLength={100} fill="none" aria-hidden="true" /> : null}
    {anchor && (
      <g className="aiflow-edge-caption" data-caption-muted={(data?.quietLabels || zoom < (outcome ? .28 : .36)) && !focused ? "" : undefined}
        transform={`translate(${anchor.x} ${anchor.y}) scale(${1 / zoom})`}>
        <path d={`M0 0 L${(anchor.line.x - anchor.x) * zoom} ${(anchor.line.y - anchor.y) * zoom}`} stroke={color} strokeOpacity={.58} />
        <EdgeText x={0} y={0} label={compact}
          labelStyle={{ fill: "var(--aiflow-caption-ink, var(--foreground, #243349))", fontSize: 13, fontWeight: 550, textRendering: "geometricPrecision" }}
          labelBgPadding={[6, 3]} labelBgBorderRadius={5}
          labelBgStyle={{ fill: "var(--card, #fff)", stroke: `color-mix(in srgb, ${color} 28%, var(--border, #d8e0ee))`, strokeWidth: .8 }} />
      </g>
    )}
  </>;
}
