import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MessageSquare, Settings2, X } from "lucide-react";
import type { ConsoleRoute } from "@shared/console-route";

const AssistantChat = lazy(() => import("./AssistantChat"));

export type AssistantContext = { projectId?: string; workflowId?: string };
export type AssistantNavigation = (route: ConsoleRoute) => void;

export function AssistantLauncher({
  isAdmin,
  userId,
  context,
  onNavigate,
}: {
  isAdmin: boolean;
  userId: number;
  context: AssistantContext;
  onNavigate: AssistantNavigation;
}) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="打开流程助手"
        aria-expanded={open}
        aria-controls={visited ? "flow-assistant-panel" : undefined}
        style={{ display: open ? "none" : undefined }}
        className="fixed right-4 bottom-4 z-30 inline-flex min-h-11 items-center gap-2 rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg"
        onClick={() => {
          setVisited(true);
          setOpen(true);
        }}
      >
        <MessageSquare size={18} />
        <span className="hidden sm:inline">流程助手</span>
      </button>
      {visited && (
        <section
          id="flow-assistant-panel"
          aria-labelledby="flow-assistant-heading"
          hidden={!open}
          className="fixed right-2 bottom-2 z-40 flex h-[min(39rem,calc(100dvh-1rem))] w-[min(25rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl sm:right-4 sm:bottom-4"
          style={{ display: open ? undefined : "none" }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="flex items-center gap-2 border-b px-4 py-2">
            <MessageSquare size={18} className="text-primary" />
            <h2
              ref={heading}
              tabIndex={-1}
              id="flow-assistant-heading"
              className="mr-auto font-semibold"
            >
              流程助手
            </h2>
            {isAdmin && (
              <button
                type="button"
                aria-label="管理 Agent"
                title="管理 Agent"
                className="rounded-md p-2 hover:bg-muted"
                onClick={() => {
                  setOpen(false);
                  onNavigate({ section: "system", view: "agents" });
                }}
              >
                <Settings2 size={18} />
              </button>
            )}
            <button
              type="button"
              aria-label="收起助手"
              className="rounded-md p-2 hover:bg-muted"
              onClick={close}
            >
              <X size={18} />
            </button>
          </header>
          <Suspense
            fallback={
              <p role="status" className="p-4">
                正在加载对话…
              </p>
            }
          >
            <AssistantChat
              userId={userId}
              context={context}
              onNavigate={route => {
                close();
                onNavigate(route);
              }}
            />
          </Suspense>
        </section>
      )}
    </>
  );
}
