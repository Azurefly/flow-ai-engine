import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";
import { useResourceDraftPending } from "./ResourceDraftSession";

export type WorkflowVersionRestoreTarget = {
  workflowId: string;
  currentVersion: number;
  currentStatus: string;
  version: number;
  name: string;
  status: string;
};

export default function WorkflowVersionRestoreDialog({
  target,
  canPublish,
  canEdit,
  onClose,
  onSaved,
  onRead,
}: {
  target: WorkflowVersionRestoreTarget;
  canPublish: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
  onRead: () => void;
}) {
  const utils = trpc.useUtils();
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const begin = useResourceDraftPending(
    target.workflowId,
    "workflow-lifecycle"
  );
  const unavailable =
    !canEdit || (!canPublish && target.currentStatus === "published");
  async function submit() {
    if (lock.current || unavailable) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const end = begin();
    try {
      await utils.client.workflow.rollbackVersion.mutate({
        workflowId: target.workflowId,
        targetVersion: target.version,
        expectedDefinitionVersion: target.currentVersion,
        restoreAsDraft: !publish,
      });
      onClose();
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "恢复失败，请重新读取后核对。"
      );
    } finally {
      lock.current = false;
      setBusy(false);
      end();
    }
  }
  return (
    <CreationDialog
      open
      title="恢复流程版本"
      description="从历史快照生成新版本，现有运行和历史记录继续保留。"
      submitLabel={publish ? "恢复并发布" : "恢复为草稿"}
      pending={busy}
      submitDisabled={unavailable}
      errorMessage={error}
      errorHint="选择仍保留。若版本或权限已变化，请关闭窗口并读取最新版本后重新确认。"
      onOpenChange={open => {
        if (!open && !lock.current) onClose();
      }}
      onSubmit={submit}
    >
      {error && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            onClose();
            onRead();
          }}
        >
          关闭并读取最新版本
        </Button>
      )}
      <dl className="grid gap-2 rounded-lg border border-border p-3 text-sm">
        <div>
          <dt className="text-muted-foreground">当前版本</dt>
          <dd>
            v{target.currentVersion} ·{" "}
            {target.currentStatus === "published" ? "已发布" : "草稿"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">恢复来源</dt>
          <dd className="break-words">
            v{target.version} · {target.name}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        默认恢复为草稿，便于核对、编辑和重新审核。
      </p>
      {target.currentStatus === "published" && (
        <p role="alert" className="text-sm text-aiflow-warning">
          当前流程已发布，恢复为草稿会取消当前发布状态，需要发布权限。
        </p>
      )}
      {target.status === "published" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={publish}
            disabled={!canPublish}
            onChange={event => setPublish(event.target.checked)}
          />
          同时恢复历史发布状态（仍需满足当前审批规则）
        </label>
      )}
      {unavailable && (
        <p role="alert" className="text-sm text-destructive">
          当前版本恢复权限不可用，请关闭窗口并重新读取流程或联系管理员。
        </p>
      )}
    </CreationDialog>
  );
}
