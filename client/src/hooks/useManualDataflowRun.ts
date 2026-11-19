import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { newResourceRequestKey } from "@shared/resource-creation";

type RunInput = {
  projectId: string;
  workflowId: string;
  mode?: "formal" | "test";
  data?: Record<string, unknown>;
  expectedDefinitionVersion?: number;
  expectedExecutionPlanHash?: string;
};
type Result = { runId: string; status: string; recovered?: boolean };

export function showDataflowRunResult(result: Result) {
  const states: Record<string, string> = {
    queued: "已进入持久化执行队列",
    running: "正在执行",
    success: "执行成功",
    failed: "执行失败",
    cancelled: "已取消",
    terminated: "已终止",
  };
  const message =
    (result.recovered ? "已核对上次运行" : "数据流") +
    " · " +
    (states[result.status] ?? result.status) +
    " · " +
    result.runId.slice(0, 8);
  if (result.status === "failed") toast.error(message);
  else toast.success(message);
}
const inMemory = new Map<string, string>();

export function useManualDataflowRun(callbacks: {
  onSuccess: (result: Result, input: RunInput) => void;
  onError: (error: Error) => void;
}) {
  const utils = trpc.useUtils();
  return useMutation<Result, Error, RunInput>({
    ...callbacks,
    retry: false,
    mutationFn: async input => {
      const actor = utils.auth.me.getData();
      if (!actor) throw new Error("请重新登录后发起运行。");
      const scope = [
        "flow:manual-run",
        actor.id,
        input.projectId,
        input.workflowId,
        input.mode ?? "formal",
      ].join("/");
      let key = inMemory.get(scope);
      try {
        key ??= sessionStorage.getItem(scope) || undefined;
      } catch {
        /* An in-memory receipt still supports same-page retries. */
      }
      const reused = Boolean(key);
      key ??= newResourceRequestKey();
      inMemory.set(scope, key);
      try {
        sessionStorage.setItem(scope, key);
      } catch {
        /* Storage may be disabled. */
      }
      const receipt = {
        projectId: input.projectId,
        workflowId: input.workflowId,
        mode: input.mode,
        idempotencyKey: key,
      };
      function clear() {
        if (inMemory.get(scope) === key) inMemory.delete(scope);
        try {
          if (sessionStorage.getItem(scope) === key)
            sessionStorage.removeItem(scope);
        } catch {
          /* Optional browser storage. */
        }
      }
      try {
        const prior = reused
          ? await utils.client.data.runReceipt.query(receipt)
          : null;
        const result = prior
          ? { ...prior, recovered: true }
          : await utils.client.data.run.mutate({
              ...input,
              idempotencyKey: key,
            });
        clear();
        return result;
      } catch (e) {
        const error = e as Error & { data?: { code?: string } };
        if (
          [
            "BAD_REQUEST",
            "FORBIDDEN",
            "UNAUTHORIZED",
            "NOT_FOUND",
            "PRECONDITION_FAILED",
          ].includes(error.data?.code ?? "")
        ) {
          clear();
          throw e;
        }
        if (error.data?.code === "CONFLICT") {
          const original = await utils.client.data.runReceipt.query(receipt);
          if (original) {
            clear();
            return { ...original, recovered: true };
          }
          clear();
          throw e;
        }
        throw new Error("运行结果待核对。再次点击运行将核对上次请求。");
      }
    },
  });
}
