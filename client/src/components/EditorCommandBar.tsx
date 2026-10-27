import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";

export function EditorCommandBar({
  backLabel,
  onBack,
  title,
  context,
  navigation,
  children,
}: {
  backLabel: string;
  onBack: () => void;
  title: ReactNode;
  context: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const header = ref.current,
      parent = header?.closest<HTMLElement>("[data-aiflow-designer]");
    if (!header || !parent) return;
    const measure = () =>
      parent.style.setProperty(
        "--aiflow-command-height",
        `${Math.ceil(header.getBoundingClientRect().height)}px`
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => {
      observer.disconnect();
      parent.style.removeProperty("--aiflow-command-height");
    };
  }, []);
  return (
    <header
      ref={ref}
      data-aiflow-context-header=""
      data-editor-command-bar=""
      className="editor-command-bar"
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          title={backLabel}
          aria-label={backLabel}
          onClick={onBack}
          className="editor-back"
        >
          <ChevronLeft size={18} />
        </button>
        {navigation}
        <div className="min-w-0 flex-1">
          {title}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {context}
          </div>
        </div>
      </div>
      <div data-editor-primary-actions="" className="editor-primary-actions">
        {children}
      </div>
    </header>
  );
}

export function EditorNotice({
  label,
  summary,
  children,
  ...props
}: ComponentProps<"details"> & { label: string; summary: ReactNode }) {
  return (
    <details {...props} className="editor-notice">
      <summary>
        <span>{label}</span>
        <span title={typeof summary === "string" ? summary : undefined}>
          {summary}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div>{children}</div>
    </details>
  );
}
