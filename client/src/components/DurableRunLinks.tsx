import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { formatConsoleRoute } from "@shared/console-route";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";

type Link =
  inferRouterOutputs<AppRouter>["workflow"]["runDetail"]["childLinks"][number];
const states: Record<string, string> = {
  waiting: "等待子实例",
  resumed: "父节点已续跑",
  failed: "父实例按策略失败",
  retrying: "已创建后续尝试",
  manual: "等待人工决定",
  detached: "父实例已结束",
  cancelled: "子实例随父取消",
};
const decisions = {
  retry: "再次调用固定版本",
  accept_failure: "接受失败并继续",
  fail_parent: "结束父流程",
} as const;

export function DurableRunLinks({
  links,
  runId,
}: {
  links: Link[];
  runId: string;
}) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState("");
  const action = trpc.workflow.decideChildFailure.useMutation({
    onSuccess: async result => {
      setMessage(
        result.changed ? "处理结果已保存。" : "该次调用已处理，已重新读取。"
      );
      await utils.workflow.runDetail.invalidate({ runId });
    },
    onError: error => setMessage(error.message),
  });
  return (
    <section
      aria-label="父子运行"
      className="grid gap-2 border-b border-border p-3"
    >
      <h3 className="font-semibold">父子运行</h3>
      {links.map(link => (
        <article key={link.id} className="grid gap-1 text-sm">
          <a
            className="break-all underline"
            href={formatConsoleRoute({
              section: "runs",
              view: "monitor",
              workflowId: link.workflowId,
              runId: link.runId,
            })}
          >
            {link.direction === "child" ? "打开子实例" : "打开父实例"} ·{" "}
            {link.runId}
          </a>
          <p>
            节点 {link.nodeId} · 子版本 v{link.version} · 第 {link.attempt} 次 ·{" "}
            {states[link.state] ?? link.state}
          </p>
          <p className="break-all text-muted-foreground">
            执行摘要 {link.planHash}
          </p>
          {link.canDecide && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(decisions) as (keyof typeof decisions)[]).map(
                decision => (
                  <Button
                    type="button"
                    key={decision}
                    variant="outline"
                    disabled={
                      action.isPending ||
                      (decision === "retry" && link.attempt >= 3)
                    }
                    onClick={() => action.mutate({ linkId: link.id, decision })}
                  >
                    {decisions[decision]}
                  </Button>
                )
              )}
            </div>
          )}
        </article>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
