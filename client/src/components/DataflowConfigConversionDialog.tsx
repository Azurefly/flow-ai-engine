import { useMemo, useRef, useState } from "react";
import type { Definition } from "../../../server/workflow-service";
import { inspectDataflowConfigConversion } from "@shared/dataflow-config-conversion";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";

export default function DataflowConfigConversionDialog({
  target,
  canApply,
  onClose,
  onApply,
}: {
  target: { id: string; name: string; version: number; definition: Definition };
  canApply: boolean;
  onClose: () => void;
  onApply: (definition: Definition) => void;
}) {
  const plan = useMemo(
    () => inspectDataflowConfigConversion(target.definition),
    [target.definition]
  );
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const applying = useRef(false);
  function exportCheck() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 1,
              workflowId: target.id,
              definitionVersion: target.version,
              source: "current-editor-input",
              changes: plan.changes,
              issues: plan.issues,
              changesApplied: false,
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
    link.download = "dataflow-config-check.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <CreationDialog
      open
      title="检查存量数据配置"
      description="检查旧聚合字段和关联输入。预览不会保存、发布或执行流程。"
      submitLabel="确认转换到当前填写"
      pending={false}
      submitDisabled={!canApply || !confirmed || !plan.candidate}
      errorMessage={error}
      onOpenChange={open => {
        if (!open) onClose();
      }}
      onSubmit={() => {
        if (applying.current || !canApply || !confirmed || !plan.candidate)
          return;
        applying.current = true;
        try {
          onApply(plan.candidate);
        } catch (failure) {
          setError(
            failure instanceof Error
              ? failure.message
              : "转换未应用，请重新检查。"
          );
          applying.current = false;
        }
      }}
    >
      <p className="break-words text-sm font-medium">
        检查对象：{target.name} · v{target.version}
      </p>
      <p
        role="alert"
        className="rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 text-sm leading-6 text-aiflow-warning"
      >
        旧 as/op
        字段此前未被当前计算规则识别。转换会明确使用输出名称与计算方式，不等于恢复历史运行结果；发布前请用样例试运行核对数值。
      </p>
      {!canApply && (
        <p role="alert" className="text-sm text-aiflow-warning">
          当前没有编辑权限，或流程版本、填写已变化，暂不可转换。请关闭后重新检查，当前填写会保留。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          {plan.changes.length} 个节点有转换建议 · {plan.issues.length}{" "}
          项需手工核对
        </span>
        <Button type="button" variant="outline" onClick={exportCheck}>
          导出检查结果
        </Button>
      </div>
      {plan.issues.length > 0 && (
        <section
          role="alert"
          className="grid gap-2 rounded-lg border border-aiflow-danger-border p-3 text-sm"
        >
          <h3 className="font-semibold">先处理以下配置，本次不会部分应用</h3>
          {plan.issues.map((issue, index) => (
            <p key={issue.nodeId + index}>
              {issue.nodeName}（{issue.nodeId}）：{issue.message}
            </p>
          ))}
        </section>
      )}
      {plan.changes.length === 0 && !plan.issues.length && (
        <p className="text-sm text-muted-foreground">
          未发现可转换的旧聚合字段或未绑定关联输入。此检查不代表全流程预检通过。
        </p>
      )}
      <ol className="grid min-w-0 gap-3">
        {plan.changes.map(change => (
          <li
            key={change.nodeId}
            className="grid min-w-0 gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <h3 className="break-words font-semibold">
              {change.nodeName}（{change.nodeId}） ·{" "}
              {change.kind === "join" ? "关联输入" : "聚合指标"}
            </h3>
            {change.details.map((detail, index) => (
              <p key={index} className="break-words leading-6">
                {detail}
              </p>
            ))}
          </li>
        ))}
      </ol>
      <label className="flex min-h-11 items-start gap-2 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          disabled={!canApply || !plan.candidate}
          checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}
        />
        已核对输出名称、计算方式和左右数据源；确认只转换本页填写，随后按预检与审核提示保存或发布新版本。
      </label>
    </CreationDialog>
  );
}
