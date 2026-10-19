import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  consoleNavigationEvent,
  type ConsoleNavigationEvent,
} from "@/lib/console-navigation-guard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "./ui/alert-dialog";

const DraftContext = createContext(
  (_id: string, _dirty: boolean, _pending: boolean) => {}
);

export function useResourceDraft(id: string, dirty: boolean, pending: boolean) {
  const register = useContext(DraftContext);
  useLayoutEffect(() => {
    register(id, dirty, pending);
  }, [register, id, dirty, pending]);
  useLayoutEffect(() => () => register(id, false, false), [register, id]);
}

export function ResourceDraftGuard({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<
    Record<string, { dirty: boolean; pending: boolean }>
  >({});
  const [leave, setLeave] = useState<{ proceed: () => void } | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const register = useCallback(
    (id: string, dirty: boolean, pending: boolean) => {
      setDrafts(current =>
        current[id]?.dirty === dirty && current[id]?.pending === pending
          ? current
          : { ...current, [id]: { dirty, pending } }
      );
    },
    []
  );
  const pending = Object.values(drafts).some(item => item.pending);
  const count = Object.values(drafts).filter(item => item.dirty).length;
  useLayoutEffect(() => {
    if (!count && !pending) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: Event) => {
      event.preventDefault();
      if (pending) return;
      origin.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setLeave({ proceed: (event as ConsoleNavigationEvent).detail.proceed });
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(consoleNavigationEvent, navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(consoleNavigationEvent, navigate);
    };
  }, [count, pending]);
  return (
    <DraftContext.Provider value={register}>
      {count > 0 && (
        <p
          role="status"
          data-resource-draft-summary=""
          className="aiflow-type-body mb-4 rounded-lg border border-aiflow-info-border bg-accent px-4 py-3 text-foreground"
        >
          有 {count}{" "}
          类资源尚未保存。切换资源类别会保留填写；离开当前业务前需要确认。
        </p>
      )}
      {children}
      <AlertDialog
        open={Boolean(leave)}
        onOpenChange={open => {
          if (!open) setLeave(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (origin.current?.isConnected)
              origin.current.focus({ preventScroll: true });
          }}
        >
          <AlertDialogTitle>离开前保留资源填写</AlertDialogTitle>
          <AlertDialogDescription>
            资源尚未保存。继续编辑可保留当前填写；确认离开会放弃这些内容。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                const action = leave;
                setLeave(null);
                action?.proceed();
              }}
            >
              放弃填写并离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DraftContext.Provider>
  );
}
