import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  workflowReviewSnapshot,
  type WorkflowReviewSnapshot,
} from "@shared/workflow-review-snapshot";

const statusLabel = { init: "待审核", approved: "已通过", rejected: "已驳回" };

export default function WorkflowReviewDialog({
  projectId,
  initial,
  decision,
  onClose,
  onViewDefinition,
}: {
  projectId: string;
  initial: WorkflowReviewSnapshot;
  decision: "approved" | "rejected";
  onClose: () => void;
  onViewDefinition: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  // Background list refreshes must never silently replace the decision baseline.
  const [snapshot, setSnapshot] = useState(() => structuredClone(initial));
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [allowed, setAllowed] = useState(initial.actions?.canReview === true);
  const submitting = useRef(false);
  const mutation = trpc.project.auditWorkflow.useMutation({
    onSuccess: () => {
      void utils.project.workflows.invalidate({ projectId });
      void utils.project.workflowAudit.invalidate({
        projectId,
        workflowId: snapshot.id,
      });
      void utils.workflow.get.invalidate({ id: snapshot.id });
      void utils.workflow.access.invalidate({ id: snapshot.id });
      toast.success(
        `v${snapshot.definitionVersion} 的审核${decision === "approved" ? "通过" : "驳回"}结果已确认。`
      );
      onClose();
    },
    onError: error => {
      if (error.data?.code === "FORBIDDEN") {
        setAllowed(false);
        void utils.project.access.invalidate({ projectId });
      }
    },
  });
  const busy = reading || mutation.isPending;
  const needsReload = Boolean(
    mutation.error &&
      ["CONFLICT", "PRECONDITION_FAILED", "BAD_REQUEST"].includes(
        mutation.error.data?.code ?? ""
      )
  );
  const uncertain = Boolean(
    mutation.error &&
      (!mutation.error.data?.code ||
        mutation.error.data.code === "INTERNAL_SERVER_ERROR")
  );
  const reload = async () => {
    if (busy || submitting.current) return;
    setReading(true);
    setReadError("");
    try {
      const rows = await utils.project.workflows.fetch({ projectId });
      const latestRow = rows.find((row: any) => row.id === snapshot.id);
      if (!latestRow)
        throw new Error("此流程已不在当前业务中，请关闭后重新查看。");
      const latest = workflowReviewSnapshot(latestRow as any);
      setSnapshot(latest);
      setAllowed(latest.actions?.canReview === true);
      mutation.reset();
    } catch (error) {
      setReadError(
        error instanceof Error ? error.message : "读取失败，原审核版本仍保留。"
      );
    } finally {
      setReading(false);
    }
  };
  const submit = async () => {
    if (
      busy ||
      submitting.current ||
      !allowed ||
      needsReload ||
      snapshot.status !== "draft"
    )
      return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({
        projectId,
        workflowId: snapshot.id,
        auditStatus: decision,
        expectedDefinitionVersion: Number(snapshot.definitionVersion),
        expectedAuditStatus: snapshot.auditStatus,
      });
    } catch {
      /* Keep the frozen decision and its inline error. */
    } finally {
      submitting.current = false;
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-xl p-4 sm:max-w-xl sm:p-5"
        showCloseButton={!busy}
        onEscapeKeyDown={event => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="aiflow-type-section-title">
            {decision === "approved" ? "确认审核通过" : "确认审核驳回"}
          </DialogTitle>
          <DialogDescription className="aiflow-type-body">
            本次决定仅适用于下方版本。定义或审核状态变化时，需要重新读取并复核。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <section
            className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/50 p-4"
            aria-label="本次审核版本"
          >
            <h2 className="aiflow-type-section-title break-words font-semibold">
              {snapshot.name}
            </h2>
            <dl className="aiflow-type-body grid grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="text-muted-foreground">流程类型</dt>
                <dd>
                  {(
                    {
                      state: "状态流程",
                      control: "控制流程",
                      data: "数据流程",
                    } as Record<string, string>
                  )[snapshot.flowType] ?? snapshot.flowType}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">定义版本</dt>
                <dd className="font-semibold">v{snapshot.definitionVersion}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">当前审核状态</dt>
                <dd>{statusLabel[snapshot.auditStatus]}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">流程规模</dt>
                <dd>
                  {snapshot.nodeCount} 个节点 · {snapshot.edgeCount} 条连线
                </dd>
              </div>
            </dl>
            {snapshot.description && (
              <p className="aiflow-type-body break-words text-muted-foreground">
                {snapshot.description}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-fit"
              disabled={busy}
              onClick={() => {
                onClose();
                onViewDefinition(snapshot.id);
              }}
            >
              查看完整流程
            </Button>
          </section>
          <p className="aiflow-type-body text-muted-foreground">
            {decision === "approved"
              ? "审核通过后，具备发布权限的人员可按审批规则发布此版本；不会自动发布。"
              : "驳回后，此草稿不能在需要审批的规则下发布；修改定义后需重新审核。"}
          </p>
          {(!allowed || snapshot.status !== "draft") && (
            <p
              role="alert"
              className="aiflow-type-body rounded-lg border border-border bg-muted p-3"
            >
              {snapshot.actions?.reviewBlockedReason ||
                "当前版本已处理、已发布或当前账号无审核权限。请重新读取后确认。"}
            </p>
          )}
          {(mutation.error || readError) && (
            <div
              role="alert"
              className="aiflow-type-body space-y-2 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-3 text-aiflow-danger"
            >
              <p className="break-words">
                {readError ||
                  (uncertain
                    ? "上次审核结果尚未确认。核对将沿用原版本与决定，已完成的审核不会重复记录。"
                    : mutation.error?.message)}
              </p>
              <p>原审核版本仍保留。重新读取后请复核变化，再确认决定。</p>
              {uncertain && (
                <p>关闭窗口不会撤销可能已完成的审核，也可在审核记录中核对。</p>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => void reload()}
          >
            {reading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            {reading ? "正在读取…" : "重新读取审核版本"}
          </Button>
        </div>
        <DialogFooter className="mt-5 shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="button"
            variant={decision === "rejected" ? "destructive" : "default"}
            className="min-h-11"
            disabled={
              busy || !allowed || needsReload || snapshot.status !== "draft"
            }
            onClick={() => void submit()}
          >
            {mutation.isPending && (
              <Loader2 size={15} className="animate-spin" />
            )}
            {mutation.isPending
              ? "正在确认…"
              : uncertain
                ? "核对审核结果"
                : decision === "approved"
                  ? "确认通过"
                  : "确认驳回"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
