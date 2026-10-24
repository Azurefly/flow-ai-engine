import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
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
  useResourceDraftState,
  useResourceDraftPending,
  useResourceDraftReset,
} from "./ResourceDraftSession";

export type WorkflowInfoTarget = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  infoConfigToken: string;
};

export default function WorkflowInfoDialog({
  target,
  onClose,
  onSaved,
}: {
  target: WorkflowInfoTarget;
  onClose: () => void;
  onSaved: (target: WorkflowInfoTarget) => void;
}) {
  const initial = useRef({
    name: target.name,
    description: target.description || "",
    token: target.infoConfigToken,
  });
  const category = `workflow-info:${target.id}`;
  const [fields, setFields] = useResourceDraftState(
    target.projectId,
    category,
    "fields",
    initial.current
  );
  const [uncertain, setUncertain] = useResourceDraftState(
    target.projectId,
    category,
    "uncertain",
    false,
    false
  );
  const [error, setError] = useResourceDraftState(
    target.projectId,
    category,
    "error",
    "",
    false
  );
  const [busy, setBusy] = useState(false),
    [leaving, setLeaving] = useState(false);
  const lock = useRef(false),
    origin = useRef<HTMLElement | null>(null);
  const reset = useResourceDraftReset(target.projectId, category),
    begin = useResourceDraftPending(target.projectId, category);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const utils = trpc.useUtils();
  const workflow = trpc.workflow.get.useQuery(
    { id: target.id },
    authorizationQueryPolicy(true)
  );
  const access = trpc.project.access.useQuery(
    { projectId: target.projectId },
    authorizationQueryPolicy(true)
  );
  const mutation = trpc.project.updateWorkflowInfo.useMutation();
  const latest = workflow.isSuccess && !workflow.isError ? workflow.data : null;
  const allowed = Boolean(
    latest &&
      !latest.archivedAt &&
      latest.projectId === target.projectId &&
      access.isSuccess &&
      !access.isError &&
      access.data.permissions.has("project:workflow:edit")
  );
  const ready = allowed && !workflow.isFetching && !access.isFetching;
  const changed = latest?.infoConfigToken !== fields.token;
  const dirty =
    fields.name !== initial.current.name ||
    fields.description !== initial.current.description ||
    uncertain;
  const finish = () => {
    reset();
    onClose();
  };
  const saved = () => {
    if (mounted.current) {
      reset();
      onSaved(target);
    }
  };
  function close() {
    if (lock.current) return;
    if (!dirty) return finish();
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLeaving(true);
  }
  async function read() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const [result, permission] = await Promise.all([
        workflow.refetch(),
        access.refetch(),
      ]);
      if (!mounted.current) return;
      if (result.error) throw result.error;
      if (permission.error) throw permission.error;
      if (
        !result.data ||
        result.data.projectId !== target.projectId ||
        result.data.archivedAt ||
        !permission.data?.permissions.has("project:workflow:edit")
      )
        throw new Error("当前无法编辑此流程；填写仍保留，请核对业务与权限。");
      if (
        uncertain &&
        result.data.name === fields.name.trim() &&
        (result.data.description || "") === fields.description.trim()
      ) {
        saved();
        return;
      }
      setError(
        uncertain
          ? "当前保存值与本次填写不同，请核对下方内容，再确认是否继续提交。"
          : ""
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "读取失败，填写仍保留。"
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit() {
    if (lock.current || !ready || changed || uncertain || !fields.name.trim())
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const end = begin();
    try {
      await mutation.mutateAsync({
        projectId: target.projectId,
        workflowId: target.id,
        name: fields.name,
        description: fields.description || null,
        expectedConfigToken: fields.token,
      });
      saved();
    } catch (cause) {
      const code = (cause as { data?: { code?: string } }).data?.code;
      setUncertain(
        ![
          "BAD_REQUEST",
          "CONFLICT",
          "FORBIDDEN",
          "NOT_FOUND",
          "PRECONDITION_FAILED",
          "UNAUTHORIZED",
        ].includes(code || "")
      );
      setError(
        cause instanceof Error
          ? cause.message
          : "保存结果尚未确认，请重新读取核对。"
      );
      void Promise.allSettled([workflow.refetch(), access.refetch()]);
    } finally {
      end();
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <CreationDialog
        open
        title="编辑流程基本信息"
        description="修改流程名称和说明。保存前会核对当前权限与已读取的基本信息，冲突时保留填写。"
        submitLabel="保存基本信息"
        pending={busy}
        submitDisabled={
          !ready || changed || uncertain || !fields.name.trim() || !dirty
        }
        errorMessage={error}
        errorHint={
          uncertain
            ? "请先读取并核对保存结果，避免重复提交。"
            : "填写已保留；重新读取不会替换当前填写。"
        }
        onOpenChange={open => {
          if (!open) close();
        }}
        onSubmit={submit}
      >
        <p className="auth-meta">
          不会修改流程定义、审核状态、发布状态或运行记录。
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => void read()}
        >
          读取并核对当前信息
        </Button>
        {(!ready || changed || uncertain) && (
          <section
            className="workflow-info-status"
            aria-label="当前基本信息与保存状态"
          >
            <p role="status">
              {!allowed
                ? "当前编辑权限或流程信息尚未确认。"
                : uncertain
                  ? "需要核对上次保存结果。"
                  : changed
                    ? "基本信息已变化，需要重新确认。"
                    : "正在读取当前信息…"}
            </p>
            {allowed && latest && (
              <dl className="workflow-info-values">
                <dt>当前名称</dt>
                <dd>{latest.name}</dd>
                <dt>当前说明</dt>
                <dd>{latest.description || "未填写"}</dd>
              </dl>
            )}

            {ready && (changed || uncertain) && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setFields(old => ({
                    ...old,
                    token: latest!.infoConfigToken,
                  }));
                  setUncertain(false);
                  setError("");
                }}
              >
                已核对，保留填写并以当前信息为准
              </Button>
            )}
          </section>
        )}
        <label className="auth-label">
          流程名称
          <Input
            value={fields.name}
            maxLength={160}
            required
            disabled={uncertain}
            onChange={event => {
              if (!lock.current)
                setFields(old => ({ ...old, name: event.target.value }));
            }}
          />
        </label>
        <label className="auth-label">
          流程说明
          <Textarea
            value={fields.description}
            maxLength={1200}
            rows={4}
            disabled={uncertain}
            onChange={event => {
              if (!lock.current)
                setFields(old => ({ ...old, description: event.target.value }));
            }}
          />
        </label>
      </CreationDialog>
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (origin.current?.isConnected) origin.current.focus();
          }}
        >
          <AlertDialogTitle>保留基本信息填写？</AlertDialogTitle>
          <AlertDialogDescription>
            暂存只在当前账号页面会话中保留。放弃不会撤销可能已保存的修改；结果不确定时请先核对。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续填写</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLeaving(false);
                onClose();
              }}
            >
              暂存并关闭
            </Button>
            <Button type="button" variant="destructive" onClick={finish}>
              放弃填写
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
