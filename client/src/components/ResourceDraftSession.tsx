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
  const store = useStore();
  return {
    ...(store?.stats(projectId) ?? { count: 0, pending: 0 }),
    uncertain: store?.hasUncertainCreation(projectId) ?? false,
    authorization: store?.hasAuthorizationDraft(projectId) ?? false,
    systemAuthorization:
      store?.hasDraftCategory("system-authorization", projectId) ?? false,
    organization:
      store?.hasDraftCategory("organization-configuration", projectId) ?? false,
  };
}
export function useResourceCreation<
  TInput extends { projectId: string; requestKey?: string },
  TResult,
>(
  projectId: string,
  category: string,
  mutation: {
    mutateAsync: (input: TInput) => Promise<TResult>;
    isPending: boolean;
    error?: { message: string } | null;
  }
) {
  const session = useContext(SessionContext);
  const [fallback] = useState(() => new ResourceDraftStore());
  const store = session ?? fallback;
  useSyncExternalStore(store.subscribe, store.snapshot, noSnapshot);
  const mutateAsync = useCallback(
    async (input: TInput) => {
      if (input.projectId !== projectId)
        throw new Error("保存业务已变化，请重新打开表单。");
      const previous = store.creation(projectId, category);
      const attempt = store.prepareCreation(
        projectId,
        category,
        previous?.uncertain ? previous.payload : input
      );
      try {
        const result = await mutation.mutateAsync({
          ...attempt.payload,
          requestKey: attempt.key,
        } as TInput);
        store.completeCreation(projectId, category, attempt.key);
        return result;
      } catch (error) {
        store.failCreation(projectId, category, attempt.key, error);
        throw error;
      }
    },
    [store, projectId, category, mutation.mutateAsync]
  );
  return {
    mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    uncertain: Boolean(store.creation(projectId, category)?.uncertain),
  };
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
          <AlertDialogTitle>
            {store.hasAuthorizationDraft()
              ? "离开前保留授权填写"
              : "离开前保留资源填写"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {store.hasAuthorizationDraft()
              ? "授权填写尚未保存。继续编辑可保留填写；确认离开只会放弃填写，不会撤销可能已经提交的授权，请先核对列表。"
              : "资源尚未保存。继续编辑可保留当前填写；确认离开会放弃这些内容。"}
            {store.hasUncertainCreation() &&
              " 部分保存结果尚未确认；离开不会撤销可能已经完成的创建，请先核对。"}
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
export function ResourceDraftRecoveryNotice({
  onRetry,
}: { onRetry?: () => void } = {}) {
  const store = useStore();
  const summary = store?.stats();
  if (!store || (!summary?.count && !summary?.pending)) return null;
  return (
    <div
      data-resource-draft-recovery=""
      className="aiflow-type-body grid gap-3 rounded-lg border border-border bg-card p-4 text-foreground"
    >
      <p>
        {summary.count ? (
          <>
            有 {summary.count}{" "}
            {store.hasAuthorizationDraft()
              ? "类填写仍保留在当前账号会话中。重新读取对应页面后请先核对授权列表，再继续填写；也可先导出。请勿关闭页面。"
              : "类资源的填写仍保留在当前账号会话中。重新读取业务后可继续编辑；也可先导出填写。请勿关闭页面。"}
          </>
        ) : (
          "正在等待保存结果，请勿重复提交。"
        )}
      </p>
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          className="w-fit min-h-11"
          disabled={Boolean(summary.pending)}
          onClick={onRetry}
        >
          重新读取当前权限
        </Button>
      )}
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
          link.download = store.hasAuthorizationDraft()
            ? "authorization-drafts.json"
            : "resource-drafts.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        {store.hasAuthorizationDraft() ? "导出未保存填写" : "导出资源填写"}
      </Button>
    </div>
  );
}
