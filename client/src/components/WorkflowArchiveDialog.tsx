import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import type { WorkflowOperationTarget } from "@shared/workflow-creation-form";
import {
  workflowCreationCategory,
  workflowCreationScope,
} from "@shared/workflow-creation-form";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";
import {
  useResourceDraftPending,
  useResourceDraftReset,
  useResourceDraftState,
} from "./ResourceDraftSession";

type Target = Extract<WorkflowOperationTarget, { kind: "archive" }>;
export default function WorkflowArchiveDialog({
  target,
  onClose,
  onArchived,
  onTargetChange,
}: {
  target: Target;
  onClose: () => void;
  onArchived: (id: string) => void;
  onTargetChange: (target: WorkflowOperationTarget) => void;
}) {
  const utils = trpc.useUtils();
  const scope = workflowCreationScope(target),
    category = workflowCreationCategory(target);
  const [error, setError] = useResourceDraftState(
    scope,
    category,
    "error",
    "",
    false
  );
  const [discardConfirmed, setDiscardConfirmed] = useResourceDraftState(
    scope,
    category,
    "discardConfirmed",
    false,
    false
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const begin = useResourceDraftPending(scope, category),
    reset = useResourceDraftReset(scope, category);
  const access = trpc.workflow.operationAccess.useQuery(
    { workflowId: target.source.id },
    authorizationQueryPolicy(true)
  );
  const latest =
    access.isSuccess && !access.isError ? access.data.source : null;
  const alreadyArchived = Boolean(latest?.archivedAt && access.data?.canView);
  const changed =
    latest &&
    !alreadyArchived &&
    latest.configurationToken !== target.source.configurationToken;
  const valid =
    !access.isFetching &&
    !access.isError &&
    access.isSuccess &&
    (alreadyArchived || (access.data.canArchive && !changed)) &&
    (!target.unsavedChanges || discardConfirmed);
  function close() {
    if (!lock.current) {
      reset();
      onClose();
    }
  }
  async function submit() {
    if (lock.current || !valid) return;
    if (alreadyArchived) {
      close();
      onArchived(target.source.id);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const end = begin();
    try {
      await utils.client.workflow.delete.mutate({
        id: target.source.id,
        expectedDefinitionVersion: target.source.definitionVersion,
        expectedConfigurationToken: target.source.configurationToken,
      });
      reset();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "暂时无法确认归档结果，请重新读取核对。"
      );
      return;
    } finally {
      lock.current = false;
      setBusy(false);
      end();
    }
    onClose();
    onArchived(target.source.id);
  }
  return (
    <CreationDialog
      open
      title="归档流程"
      destructive
      description="归档后可从流程仓库恢复，版本、运行、任务、授权与审计记录会保留。"
      submitLabel={alreadyArchived ? "已核对，完成归档" : "确认归档"}
      pending={busy}
      submitDisabled={!valid}
      errorMessage={error}
      onOpenChange={open => {
        if (!open) close();
      }}
      onSubmit={submit}
    >
      {access.data?.canView && !access.isError && (
        <p className="break-words text-sm font-medium">
          归档对象：{target.source.name} · v{target.source.definitionVersion}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={busy || access.isFetching}
        onClick={() => void access.refetch()}
      >
        重新读取权限与归档结果
      </Button>
      {alreadyArchived ? (
        <p role="status" className="text-sm">
          该流程已归档。请核对后结束本次操作，不会重复写入。
        </p>
      ) : access.isError || !access.data?.canArchive ? (
        <p role="alert" className="text-sm text-aiflow-warning">
          暂时无法确认归档权限，已暂停提交。请重新读取后核对。
        </p>
      ) : null}
      {changed && (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-aiflow-warning-border p-3 text-sm"
        >
          <p>
            目标流程已变化：{latest.name} · v{latest.definitionVersion}
            。请重新确认归档对象。
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy || access.isFetching}
            onClick={() => {
              onTargetChange({ ...target, source: latest });
              setError("");
            }}
          >
            确认当前流程配置
          </Button>
        </div>
      )}
      {target.unsavedChanges && (
        <label className="flex items-start gap-2 text-sm text-aiflow-warning">
          <input
            type="checkbox"
            className="mt-1"
            checked={discardConfirmed}
            onChange={event => setDiscardConfirmed(event.target.checked)}
          />
          画布有未保存修改。已确认本次归档不会保存这些修改，仍要继续。
        </label>
      )}
    </CreationDialog>
  );
}
