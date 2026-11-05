import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  cancellationNeedsReadback,
  cancellationReadback,
} from "@shared/dataflow-cancellation";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import "./dataflow-cancel-control.css";

type CancelRun = {
  id: string;
  projectId: string;
  workflowName?: string;
  status: string;
  canCancel?: boolean;
};

/** UX：保持原实例与原因；响应不确定时先回读，绝不重新发起流程。 */
export function DataflowCancelControl({ run }: { run: CancelRun }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [reading, setReading] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const refresh = () =>
    Promise.all([
      utils.data.runDetail.invalidate({
        projectId: run.projectId,
        runId: run.id,
      }),
      utils.data.runPage.invalidate({ projectId: run.projectId }),
      utils.data.runs.invalidate({ projectId: run.projectId }),
    ]);
  const finish = async (cancelled: boolean) => {
    setOpen(false);
    toast.success(
      cancelled
        ? "本次运行已取消，已完成节点结果保留。"
        : "运行已结束，保留实际结果。"
    );
    await refresh();
  };
  const mutation = trpc.data.cancelRun.useMutation({
    retry: false,
    onSuccess: result => {
      void finish(result.status === "cancelled");
    },
    onError: failure => {
      setError(failure.message);
      setUncertain(cancellationNeedsReadback(failure.data?.code));
      setBlocked(
        ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
          String(failure.data?.code)
        )
      );
    },
  });
  const readBack = async () => {
    setReading(true);
    try {
      const result = await utils.client.data.runDetail.query({
        projectId: run.projectId,
        runId: run.id,
      });
      const outcome = cancellationReadback(result, run.id);
      if (outcome === "cancelled" || outcome === "finished")
        await finish(outcome === "cancelled");
      else if (outcome === "retry") {
        setUncertain(false);
        setBlocked(false);
        setError("已核对：当前仍可取消，请确认后再次提交。原因已保留。");
        await refresh();
      } else {
        setBlocked(true);
        setError("当前无法控制此运行，请重新核对账号和业务权限。");
      }
    } catch {
      setError("运行状态读取失败，取消结果仍待确认。请稍后刷新并核对。");
      setUncertain(true);
    } finally {
      setReading(false);
    }
  };
  const busy = mutation.isPending || reading;
  return (
    <>
      {run.canCancel && (
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          size="sm"
          data-cancel-trigger=""
          aria-label={`取消本次运行：${run.id}`}
          onClick={() => {
            setOpen(true);
            if (!uncertain && !blocked) setError("");
          }}
        >
          取消本次运行
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          data-cancel-dialog=""
          showCloseButton={!busy}
          onEscapeKeyDown={event => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={event => {
            if (busy) event.preventDefault();
          }}
          onCloseAutoFocus={event => {
            if (trigger.current?.isConnected) {
              event.preventDefault();
              trigger.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>取消本次数据运行</DialogTitle>
            <DialogDescription>
              后续步骤停止，已完成节点结果保留。后续调度不受影响；当前外部查询可能要返回后才能释放连接。
            </DialogDescription>
          </DialogHeader>
          <div data-cancel-body="">
            <dl>
              <dt>流程</dt>
              <dd>{run.workflowName || "数据流程"}</dd>
              <dt>实例</dt>
              <dd>{run.id}</dd>
              <dt>当前状态</dt>
              <dd>
                {(
                  {
                    queued: "排队中",
                    running: "运行中",
                    cancelled: "已取消",
                    success: "成功",
                    failed: "失败",
                  } as Record<string, string>
                )[run.status] || run.status}
              </dd>
            </dl>
            <label>
              取消原因
              <textarea
                aria-label="取消原因"
                maxLength={500}
                rows={4}
                value={reason}
                disabled={busy}
                onChange={event => setReason(event.target.value)}
              />
            </label>
            <p data-cancel-counter="">{reason.length}/500</p>
            {error && (
              <p role="alert">
                {uncertain && "结果待确认："}
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              返回
            </Button>
            {uncertain || blocked ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void readBack()}
              >
                {reading ? "正在核对…" : "刷新并核对"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !reason.trim() || !run.canCancel}
                onClick={() =>
                  mutation.mutate({
                    projectId: run.projectId,
                    runId: run.id,
                    reason: reason.trim(),
                  })
                }
              >
                {mutation.isPending ? "正在取消…" : "确认取消本次运行"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DataflowCancellationInfo({
  cancellation,
}: {
  cancellation?: {
    actorLabel: string;
    cancelledAt: string;
    reason: string;
  } | null;
}) {
  if (!cancellation) return null;
  return (
    <section data-cancellation-info="" role="status">
      <p>
        已取消 · {cancellation.actorLabel} ·{" "}
        {new Date(cancellation.cancelledAt).toLocaleString("zh-CN")}
      </p>
      <p>{cancellation.reason}</p>
    </section>
  );
}
