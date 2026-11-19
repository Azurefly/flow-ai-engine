import { useState } from "react";
import { trpc } from "@/lib/trpc";

export default function AssistantOperations() {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const utils = trpc.useUtils();
  const queue = trpc.assistant.operations.useQuery(undefined, {
    enabled: open,
    retry: false,
    refetchInterval: open ? 10_000 : false,
  });
  const review = trpc.assistant.reviewJob.useMutation({
    onSuccess: () => {
      void utils.assistant.operations.invalidate();
      void utils.assistant.job.invalidate();
    },
  });
  const data = queue.data;
  return (
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>助手后台作业</summary>
      {queue.isLoading && <p role="status">正在读取作业状态…</p>}
      {queue.error && (
        <p role="alert">
          {queue.error.message}{" "}
          <button type="button" onClick={() => void queue.refetch()}>
            重新读取
          </button>
        </p>
      )}
      {data && (
        <>
          <p>
            排队 {data.queued}，执行中 {data.leased}，租约过期 {data.expired}
            ，待核对 {data.needsReview}。最早排队 {data.oldestQueuedSeconds}{" "}
            秒。
          </p>
          <p>
            本实例助手事务占用连接 {data.connections.active} 个，等待{" "}
            {data.connections.waiting} 个，启动以来峰值 {data.connections.peak}{" "}
            个。
          </p>
          {data.samples > 0 && (
            <p>
              最近 24 小时内的 {data.samples} 条终态作业（最多 1000
              条）中，失败及待核对 {data.failures} 条，重新领取 {data.retries}{" "}
              次。 总耗时 P95 / P99 为 {Math.round(data.p95Ms ?? 0)} /{" "}
              {Math.round(data.p99Ms ?? 0)} 毫秒，排队 P95 为{" "}
              {Math.round(data.p95QueueMs ?? 0)} 毫秒。
            </p>
          )}
          {data.review.map(row => (
            <fieldset key={row.id} disabled={review.isPending}>
              <legend>{row.actionName ?? "业务回执待核对"}</legend>
              <p>
                请求号 {row.requestId} · 操作号 {row.actionKey ?? "未记录"} · 目标 {row.targetRef ?? "未登记"} ·
                接单时间 {row.queuedAt}
              </p>
              <label>
                业务回执或审计记录编号{" "}
                <input
                  maxLength={160}
                  value={evidence[row.id] ?? ""}
                  onChange={event =>
                    setEvidence(previous => ({
                      ...previous,
                      [row.id]: event.target.value,
                    }))
                  }
                />
              </label>
              {[true, false].map(applied => (
                <button
                  type="button"
                  key={String(applied)}
                  disabled={(evidence[row.id]?.trim().length ?? 0) < 3}
                  onClick={() =>
                    review.mutate({
                      jobId: row.id,
                      applied,
                      evidence: evidence[row.id].trim(),
                    })
                  }
                >
                  {applied ? "登记核对结论为已生效" : "登记核对结论为未生效"}
                </button>
              ))}
            </fieldset>
          ))}
          {review.error && <p role="alert">{review.error.message}</p>}
        </>
      )}
    </details>
  );
}
