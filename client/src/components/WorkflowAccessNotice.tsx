import { useEffect, useRef } from "react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResourceDraftRecoveryNotice } from "./ResourceDraftSession";
import type { WorkflowViewState } from "@shared/workflow-view-access";

export default function WorkflowAccessNotice({
  state,
  workflowId,
  retainedDraft,
  refreshing,
  onRetry,
  onBack,
}: {
  state: WorkflowViewState;
  workflowId: string | null;
  retainedDraft: boolean;
  refreshing: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (
      state !== "checking" &&
      !document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
      )
    )
      heading.current?.focus();
  }, [state, workflowId]);
  return (
    <section
      data-workflow-access-boundary=""
      role={state === "checking" ? "status" : "alert"}
      className="m-3 grid min-w-0 gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:m-5 sm:p-6"
    >
      <div className="flex min-w-0 items-start gap-3">
        {state === "checking" ? (
          <Loader2
            size={22}
            className="mt-1 shrink-0 animate-spin text-aiflow-info"
            aria-hidden="true"
          />
        ) : (
          <LockKeyhole
            size={22}
            className="mt-1 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0">
          <h2
            ref={heading}
            tabIndex={-1}
            className="aiflow-type-section-title break-words font-semibold focus-visible:outline-none"
          >
            {state === "denied"
              ? "当前账号无权查看此流程"
              : state === "unavailable"
                ? "暂时无法确认流程访问权限"
                : "正在确认流程访问权限…"}
          </h2>
          <p className="aiflow-type-body mt-2 break-words text-muted-foreground">
            {state === "denied"
              ? "查看权限已变化，或流程已不存在。配置、历史内容及缓存信息已隐藏；请联系管理员确认授权。"
              : state === "unavailable"
                ? "权限读取失败，流程内容暂时隐藏。可以重新检查权限；当前填写不会因此被清空。"
                : "确认当前流程的查看权限后再显示内容。"}
          </p>
          {retainedDraft && (
            <p className="aiflow-type-body mt-2 text-aiflow-info">
              本次会话中的未保存修改已保留。恢复查看权限后可继续编辑。
            </p>
          )}
        </div>
      </div>
      {state !== "checking" && <ResourceDraftRecoveryNotice />}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 max-w-full whitespace-normal"
          disabled={refreshing}
          onClick={onRetry}
        >
          {refreshing ? "正在重新检查…" : "重新检查流程权限"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 max-w-full whitespace-normal"
          onClick={onBack}
        >
          返回业务中心
        </Button>
      </div>
    </section>
  );
}
