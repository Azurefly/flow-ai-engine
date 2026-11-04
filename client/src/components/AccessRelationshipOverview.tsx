import { useState } from "react";
import "./identity-workbench.css";

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
    >
      <p>
        权限关系 · 选择分支查看明细
      </p>
      <div data-access-counts="">
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
          >
            <span className="aiflow-access-count font-semibold tabular-nums">
              {node.count}
            </span>
            <span>
              {node.label}
            </span>
          </button>
        ))}
      </div>
      {/* UX：概览始终可用，身份与关系连线按需展开，不挤占实际授权明细。 */}
      <details key={identity}>
        <summary>查看权限关系图</summary>
        <div data-access-identity="">{label}</div>
        <svg aria-hidden="true" viewBox="0 0 600 64" preserveAspectRatio="none">
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
                className={active === index ? "aiflow-access-trace text-aiflow-info" : "text-border"}
              />
            );
          })}
        </svg>
        <div data-access-branches="">
          {nodes.map(node => <span key={node.label}>{node.label} · {node.count}</span>)}
        </div>
      </details>
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
