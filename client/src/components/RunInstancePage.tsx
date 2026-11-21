import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { FlowTypeBadge } from "./FlowTypeBadge";
import { Button } from "./ui/button";
import "./run-instance-page.css";

export function useRunInstanceReturn(runId: string | null, scopeId: string | null, viewAllowed: boolean) {
  const list = useRef<HTMLElement>(null);
  const previousRun = useRef(runId);
  const source = useRef<{ scopeId: string | null; buttonId: string; top: number } | null>(null);

  useEffect(() => {
    if (!viewAllowed) return;
    const previous = previousRun.current;
    previousRun.current = runId;
    if (runId || !previous) return;
    const frame = window.requestAnimationFrame(() => {
      const position = source.current;
      const button = position?.scopeId === scopeId ? document.getElementById(position.buttonId) : null;
      if (button && position) {
        window.scrollTo({ top: position.top, behavior: "auto" });
        button.focus({ preventScroll: true });
      } else {
        list.current?.focus({ preventScroll: true });
        list.current?.scrollIntoView({ block: "start", behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [runId, viewAllowed, scopeId]);

  return {
    list,
    rememberOpener(button: HTMLElement) {
      source.current = { scopeId, buttonId: button.id, top: window.scrollY };
    },
  };
}

export function RunInstancePage({
  runId,
  workflowName,
  flowType,
  onBack,
  backLabel = "返回运行监控",
  actions,
  summary,
  children,
}: {
  runId: string;
  workflowName?: string | null;
  flowType?: string | null;
  onBack: () => void;
  backLabel?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    heading.current?.focus({ preventScroll: true });
  }, [runId]);

  return (
    <section data-run-instance-page="" data-run-detail-panel="" aria-labelledby="run-instance-title">
      <header data-run-instance-header="">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
            </Button>
            <div className="min-w-0">
              <h1 ref={heading} id="run-instance-title" data-aiflow-page-title="" tabIndex={-1} className="aiflow-type-page-title w-fit font-semibold">实例画布</h1>
              <div className="aiflow-type-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                {workflowName && <span className="break-words">{workflowName}</span>}
                {flowType && <FlowTypeBadge type={flowType} />}
                <code title={runId}>RUN {runId.slice(0, 8)}</code>
              </div>
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {summary}
      </header>
      <div data-run-instance-body="">{children}</div>
    </section>
  );
}
