import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type SetStateAction,
} from "react";
import { ResourceDraftStore } from "@shared/resource-draft-session";
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
import { Button } from "./ui/button";

const SessionContext = createContext<ResourceDraftStore | null>(null);
const noSubscribe = () => () => {};
const noSnapshot = () => 0;
function useStore() {
  const store = useContext(SessionContext);
  useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.snapshot ?? noSnapshot,
    noSnapshot
  );
  return store;
}
export function useResourceDraftState<T>(
  projectId: string,
  category: string,
  key: string,
  initial: T,
  tracked = true
): [T, (action: SetStateAction<T>) => void] {
  const store = useStore();
  const base = useRef(initial);
  const [local, setLocal] = useState(initial);
  const set = useCallback(
    (action: SetStateAction<T>) => {
      if (store)
        store.set(projectId, category, key, base.current, action, tracked);
      else setLocal(action);
    },
    [store, projectId, category, key, tracked]
  );
  return [
    store ? store.read(projectId, category, key, base.current) : local,
    set,
  ];
}
export function useResourceDraftPending(projectId: string, category: string) {
  const store = useContext(SessionContext);
  return useCallback(
    () => store?.begin(projectId, category) ?? (() => {}),
    [store, projectId, category]
  );
}
export function useResourceDraftSummary(projectId?: string) {
  return useStore()?.stats(projectId) ?? { count: 0, pending: 0 };
}
export function ResourceDraftSession({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ResourceDraftStore());
  const [leave, setLeave] = useState<{ proceed: () => void } | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  useSyncExternalStore(store.subscribe, store.snapshot, noSnapshot);
  useLayoutEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const { count, pending } = store.stats();
      if (count || pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: Event) => {
      const { count, pending } = store.stats();
      if (!count && !pending) {
        store.clear();
        return;
      }
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
  }, [store]);
  return (
    <SessionContext.Provider value={store}>
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
              disabled={Boolean(store.stats().pending)}
              onClick={() => {
                if (store.stats().pending) return;
                const action = leave;
                setLeave(null);
                store.clear();
                action?.proceed();
              }}
            >
              放弃填写并离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SessionContext.Provider>
  );
}
export function ResourceDraftRecoveryNotice() {
  const store = useStore();
  const summary = store?.stats();
  if (!store || !summary?.count) return null;
  return (
    <div
      data-resource-draft-recovery=""
      className="aiflow-type-body grid gap-3 rounded-lg border border-border bg-card p-4 text-foreground"
    >
      <p>
        有 {summary.count}{" "}
        类资源的填写仍保留在当前账号会话中。重新读取业务后可继续编辑；也可先导出填写。请勿关闭页面。
      </p>
      {summary.pending > 0 && (
        <p role="status">
          正在等待保存结果。重新读取业务后会继续确认，请勿重复保存。
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-fit"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob(
              [
                JSON.stringify(
                  { version: 1, drafts: store.exportDrafts() },
                  null,
                  2
                ) + "\n",
              ],
              { type: "application/json;charset=utf-8" }
            )
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "resource-drafts.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        导出资源填写
      </Button>
    </div>
  );
}
