import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import {
  initialWorkflowCreationFields,
  workflowCopyName,
  workflowCreationCategory,
  workflowCreationScope,
  type WorkflowOperationTarget,
} from "@shared/workflow-creation-form";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import {
  useResourceCreation,
  useResourceDraftPending,
  useResourceDraftReset,
  useResourceDraftState,
} from "./ResourceDraftSession";

type Target = Exclude<WorkflowOperationTarget, { kind: "archive" }>;
type Payload = {
  projectId: string;
  name: string;
  requestKey?: string;
  processCode?: string;
  description?: string;
  flowType?: "state" | "control" | "data";
  dataSourceId?: string | null;
  id?: string;
  expectedDefinitionVersion?: number;
  expectedConfigurationToken?: string;
};

export default function WorkflowCreateDialog({
  target,
  onClose,
  onCreated,
  onTargetChange,
}: {
  target: Target;
  onClose: () => void;
  onCreated: (workflow: any) => void;
  onTargetChange: (target: WorkflowOperationTarget) => void;
}) {
  const utils = trpc.useUtils();
  const scope = workflowCreationScope(target),
    category = workflowCreationCategory(target);
  const initial = useRef(initialWorkflowCreationFields(target));
  const [fields, setFields] = useResourceDraftState(
    scope,
    category,
    "fields",
    initial.current
  );
  const [error, setError] = useResourceDraftState(
    scope,
    category,
    "error",
    "",
    false
  );
  const [busy, setBusy] = useState(false),
    [leaving, setLeaving] = useState(false);
  const lock = useRef(false),
    origin = useRef<HTMLElement | null>(null);
  const reset = useResourceDraftReset(scope, category),
    begin = useResourceDraftPending(scope, category);
  const copying = target.kind === "copy";
  const access = trpc.workflow.operationAccess.useQuery(
    copying
      ? { workflowId: target.source.id }
      : target.kind === "project"
        ? { projectId: target.projectId }
        : {},
    authorizationQueryPolicy(true)
  );
  const sources = trpc.data.resources.useQuery(
    { projectId: scope },
    authorizationQueryPolicy(
      target.kind === "project" &&
        fields.flowType === "data" &&
        Boolean(access.data?.canCreate)
    )
  );
  const sourceRows = (sources.isSuccess && !sources.isError
    ? sources.data.sources
    : []) as unknown as Array<{ id: string; name: string; status: string }>;
  const creation = useResourceCreation<Payload, any>(scope, category, {
    isPending: busy,
    mutateAsync: input =>
      copying
        ? utils.client.workflow.duplicate.mutate({
            id: input.id!,
            name: input.name,
            expectedDefinitionVersion: input.expectedDefinitionVersion,
            expectedConfigurationToken: input.expectedConfigurationToken,
            requestKey: input.requestKey,
          })
        : target.kind === "project"
          ? utils.client.project.createWorkflow.mutate({
              projectId: input.projectId,
              name: input.name,
              processCode: input.processCode,
              description: input.description,
              flowType: input.flowType!,
              dataSourceId: input.dataSourceId,
              creationSource: "manual",
              requestKey: input.requestKey,
            })
          : utils.client.workflow.create.mutate({
              name: input.name,
              flowType: input.flowType === "control" ? "control" : "state",
              requestKey: input.requestKey,
            }),
  });
  const recoveryAccess = trpc.workflow.operationAccess.useQuery(
    copying && target.source.projectId
      ? { projectId: target.source.projectId }
      : {},
    authorizationQueryPolicy(copying && creation.uncertain)
  );
  const permitted =
    copying && creation.uncertain
      ? recoveryAccess.isSuccess &&
        !recoveryAccess.isError &&
        recoveryAccess.data.canView &&
        recoveryAccess.data.canCreate
      : access.isSuccess &&
        !access.isError &&
        access.data.canView &&
        (copying ? access.data.canCopy : access.data.canCreate);
  const latest =
    access.isSuccess && !access.isError ? access.data.source : null;
  const changed =
    copying &&
    latest &&
    latest.configurationToken !== target.source.configurationToken;
  const scopeChanged = Boolean(
    copying && latest && latest.projectId !== target.source.projectId
  );
  const sourceMissing =
    target.kind === "project" &&
    fields.flowType === "data" &&
    fields.dataSourceId &&
    (!sources.isSuccess ||
      sources.isError ||
      !sourceRows.some(
        row => row.id === fields.dataSourceId && row.status !== "disabled"
      ));
  const valid =
    permitted &&
    !access.isFetching &&
    !(copying && creation.uncertain && recoveryAccess.isFetching) &&
    (creation.uncertain || (!changed && !sourceMissing));
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(initial.current) ||
    creation.uncertain;
  function finish() {
    reset();
    onClose();
  }
  function close() {
    if (lock.current) return;
    if (!dirty) {
      finish();
      return;
    }
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLeaving(true);
  }
  function update(value: Partial<typeof fields>) {
    if (lock.current || creation.uncertain) return;
    setFields(old => ({ ...old, ...value }));
    setError("");
  }
  function read() {
    if (!lock.current)
      void Promise.allSettled([
        access.refetch(),
        ...(copying && creation.uncertain ? [recoveryAccess.refetch()] : []),
        ...(target.kind === "project" && fields.flowType === "data"
          ? [sources.refetch()]
          : []),
      ]);
  }
  async function submit() {
    if (lock.current || !valid) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const end = begin();
    let result: any;
    try {
      result = await creation.mutateAsync({
        projectId: scope,
        name: fields.name.trim(),
        ...(copying
          ? {
              id: target.source.id,
              expectedDefinitionVersion: target.source.definitionVersion,
              expectedConfigurationToken: target.source.configurationToken,
            }
          : {
              flowType: fields.flowType,
              ...(target.kind === "project"
                ? {
                    processCode: fields.processCode.trim(),
                    description: fields.description.trim() || undefined,
                    dataSourceId:
                      fields.flowType === "data"
                        ? fields.dataSourceId || null
                        : null,
                  }
                : {}),
            }),
      });
      reset();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "创建失败，请核对列表后重试。"
      );
      return;
    } finally {
      lock.current = false;
      setBusy(false);
      end();
    }
    onClose();
    onCreated(result);
  }
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              target,
              fields,
              requestKey: creation.requestKey,
              uncertain: creation.uncertain,
            },
            null,
            2
          ),
        ],
        { type: "application/json;charset=utf-8" }
      )
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "workflow-creation-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <CreationDialog
        open
        title={
          copying
            ? "创建流程副本"
            : target.kind === "project"
              ? "新增流程"
              : "新建流程"
        }
        description={
          copying
            ? "从已保存版本创建副本，保留业务、目录及数据源，生成独立代号。未保存的编辑不会复制。"
            : target.kind === "project"
              ? "在当前业务创建流程草稿。导入已有定义请从流程仓库进入。"
              : "创建独立的状态或控制流程；数据流程请在业务内创建。"
        }
        submitLabel={
          creation.uncertain
            ? "重试并核对结果"
            : copying
              ? "创建副本"
              : "创建并设计"
        }
        pending={busy}
        submitDisabled={!valid}
        errorMessage={error}
        onOpenChange={open => {
          if (!open) close();
        }}
        onSubmit={submit}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || access.isFetching}
            onClick={read}
          >
            重新读取权限与来源
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={exportDraft}
          >
            导出填写
          </Button>
        </div>
        {(!permitted || access.isError) && (
          <p role="alert" className="text-sm text-aiflow-warning">
            暂时无法确认创建权限，已暂停提交并保留填写。请重新读取权限。
          </p>
        )}
        {creation.uncertain && (
          <p role="alert" className="text-sm text-aiflow-warning">
            上次创建结果尚未确认。填写已锁定；重试将核对同一次提交，不会重复创建。
          </p>
        )}
        {target.kind === "project" &&
          access.data?.canView &&
          !access.isError && (
            <p className="break-words text-sm">
              所属业务：{target.projectName}
            </p>
          )}
        {copying && access.data?.canView && !access.isError && (
          <p className="break-words text-sm">
            复制来源：{target.source.name} · v{target.source.definitionVersion}
          </p>
        )}
        {changed && !creation.uncertain && (
          <div
            role="alert"
            className="grid gap-2 rounded-lg border border-aiflow-warning-border p-3 text-sm"
          >
            <p>
              {scopeChanged
                ? "源流程已移至其他业务，请导出当前填写并关闭窗口，从新位置重新发起复制。"
                : "源流程已变化，请核对当前保存版本："}
              {latest.name} · v{latest.definitionVersion}。
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || access.isFetching || scopeChanged}
              onClick={() => {
                if (!copying || !latest || scopeChanged) return;
                if (fields.name === workflowCopyName(target.source.name))
                  setFields(old => ({
                    ...old,
                    name: workflowCopyName(latest.name),
                  }));
                onTargetChange({ ...target, source: latest });
                setError("");
              }}
            >
              确认使用当前保存版本
            </Button>
          </div>
        )}
        <fieldset
          hidden={access.isError || !access.data?.canView}
          disabled={busy || creation.uncertain || !permitted}
          className="grid min-w-0 gap-3"
        >
          <label className="grid gap-1.5 text-sm font-medium">
            流程名称
            <Input
              className="h-11 min-[1024px]:h-10"
              autoFocus
              required
              maxLength={160}
              value={fields.name}
              onChange={event => update({ name: event.target.value })}
            />
          </label>
          {target.kind === "project" && (
            <>
              <label className="grid gap-1.5 text-sm font-medium">
                流程代号
                <Input
                  aria-label="流程代号"
                  aria-describedby="workflow-code-help"
                  className="h-11 min-[1024px]:h-10"
                  required
                  minLength={2}
                  maxLength={64}
                  pattern="[A-Z][A-Z0-9_-]{1,63}"
                  placeholder="例如 ORDER_APPROVAL"
                  value={fields.processCode}
                  onChange={event =>
                    update({ processCode: event.target.value.toUpperCase() })
                  }
                />
                <span
                  id="workflow-code-help"
                  className="text-[13px] font-normal text-muted-foreground"
                >
                  当前业务内唯一；以大写字母开头，可使用字母、数字、下划线和短横线。
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                流程说明（可选）
                <Textarea
                  aria-label="流程说明（可选）"
                  maxLength={1200}
                  value={fields.description}
                  onChange={event =>
                    update({ description: event.target.value })
                  }
                />
              </label>
            </>
          )}
          {!copying && (
            <label className="grid gap-1.5 text-sm font-medium">
              流程类型
              <select
                aria-label="流程类型"
                className="h-11 rounded-md border border-border bg-card px-3 text-sm min-[1024px]:h-10"
                value={fields.flowType}
                onChange={event =>
                  update({
                    flowType: event.target.value as typeof fields.flowType,
                    dataSourceId:
                      event.target.value === "data" ? fields.dataSourceId : "",
                  })
                }
              >
                <option value="state">状态流程</option>
                <option value="control">控制流程</option>
                {target.kind === "project" && (
                  <option value="data">数据流程</option>
                )}
              </select>
            </label>
          )}
          {target.kind === "project" && fields.flowType === "data" && (
            <label className="grid gap-1.5 text-sm font-medium">
              关联数据源（可选）
              <select
                aria-label="关联数据源（可选）"
                className="h-11 rounded-md border border-border bg-card px-3 text-sm min-[1024px]:h-10"
                value={fields.dataSourceId}
                onChange={event => update({ dataSourceId: event.target.value })}
              >
                <option value="">不关联数据源</option>
                {sourceMissing && (
                  <option value={fields.dataSourceId} disabled>
                    原选择暂不可用，请核对
                  </option>
                )}
                {sourceRows
                  .filter(row => row.status !== "disabled")
                  .map(row => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </fieldset>
        {sources.isError &&
          target.kind === "project" &&
          fields.flowType === "data" && (
            <p role="alert" className="text-sm text-aiflow-warning">
              数据源目录读取失败，请重新读取；也可不关联数据源创建草稿。
            </p>
          )}
      </CreationDialog>
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (origin.current?.isConnected) origin.current.focus();
          }}
        >
          <AlertDialogTitle>保留创建填写？</AlertDialogTitle>
          <AlertDialogDescription>
            继续填写会保留当前内容。放弃只清理本次填写；若创建结果尚未确认，请先核对流程列表，已创建的流程不会因此删除。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续填写</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setLeaving(false);
                finish();
              }}
            >
              已核对，放弃填写
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
