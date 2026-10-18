import { useState } from "react";

/** Counts come from the displayed authorization snapshot; each branch locates its evidence. */
export function AccessRelationshipOverview({
  identity,
  label,
  nodes,
  onSelect,
}: {
  identity: string | number;
  label: string;
  nodes: { label: string; count: number }[];
  onSelect: (index: number) => void;
}) {
  const [selection, setSelection] = useState<{
    identity: string | number;
    index: number;
  } | null>(null);
  const active = selection?.identity === identity ? selection.index : -1;
  return (
    <div
      data-access-relationship=""
      className="rounded-2xl border border-border bg-muted/40 p-4"
    >
      <p className="aiflow-type-meta mb-3 text-muted-foreground">
        权限关系 · 选择分支查看明细
      </p>
      <div className="mx-auto w-fit max-w-full rounded-full border border-aiflow-special-border bg-card px-4 py-2 text-center shadow-sm">
        <span className="aiflow-type-control block break-words font-semibold">
          {label}
        </span>
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 600 64"
        preserveAspectRatio="none"
        className="h-12 w-full overflow-visible"
      >
        {nodes.map((node, index) => {
          const x = (index + 0.5) * (600 / nodes.length);
          return (
            <path
              key={`${identity}-${index}-${active === index}`}
              data-selected={active === index}
              d={`M300 0 C300 36 ${x} 24 ${x} 64`}
              pathLength="1"
              fill="none"
              stroke="currentColor"
              strokeWidth={active === index ? 2.5 : 1.25}
              className={
                active === index
                  ? "aiflow-access-trace text-aiflow-info"
                  : "text-border"
              }
            />
          );
        })}
      </svg>
      <div className="grid grid-cols-3 gap-2">
        {nodes.map((node, index) => (
          <button
            key={node.label}
            type="button"
            aria-label={`定位${node.label}（${node.count}）`}
            aria-pressed={active === index}
            onClick={() => {
              setSelection({ identity, index });
              onSelect(index);
            }}
            className={`grid min-h-20 min-w-0 content-center gap-1 rounded-xl border px-1 py-2 text-center transition-colors ${active === index ? "border-aiflow-info-border bg-aiflow-info-surface text-aiflow-info" : "border-border bg-card text-foreground hover:border-aiflow-info-border"}`}
          >
            <span className="aiflow-access-count font-semibold tabular-nums">
              {node.count}
            </span>
            <span className="aiflow-type-meta break-words text-muted-foreground">
              {node.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function focusAccessGroup(element: HTMLDivElement | null | undefined) {
  if (!element) return;
  element.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
    block: "nearest",
  });
  element.focus({ preventScroll: true });
}
