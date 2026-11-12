import { useEffect, useState } from "react";
import type { NodeConfig } from "@shared/workflow-node-contract";
import { NodeNumberInput } from "./NodeNumberInput";

const control =
  "min-h-11 w-full min-w-0 rounded-md border border-border bg-card px-2.5 py-2 text-sm text-foreground";
const field = "grid min-w-0 gap-1.5 text-xs font-medium text-foreground";

export function LlmGovernanceEditor({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const config: NodeConfig =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as NodeConfig)
      : {};
  const set = (key: string, next: unknown) => {
    const updated = { ...config };
    if (next === undefined) delete updated[key];
    else updated[key] = next;
    onChange(updated);
  };
  const sensitiveText = Array.isArray(config.allowSensitiveFields)
    ? config.allowSensitiveFields.join("\n")
    : "";
  const [sensitiveDraft, setSensitiveDraft] = useState(sensitiveText);
  useEffect(() => setSensitiveDraft(sensitiveText), [sensitiveText]);
  const classification = String(config.dataClassification ?? "internal");
  return (
    <div className="grid min-w-0 gap-4" aria-label="数据与成本控制表单">
      <p className="text-xs text-muted-foreground">
        使用系统配置中的模型服务；缓存当前关闭。每次调用都会检查数据分类、费用和输出规则。
      </p>
      {config.providerRef && config.providerRef !== "runtime-default" ? (
        <p role="alert">
          此流程使用了不支持的模型服务，请改用系统模型服务。
          <button
            type="button"
            disabled={disabled}
            className="ml-1 underline"
            onClick={() => set("providerRef", "runtime-default")}
          >
            使用系统模型服务
          </button>
        </p>
      ) : null}
      {config.cachePolicy && config.cachePolicy !== "none" ? (
        <p role="alert">
          此流程的缓存策略尚不支持。
          <button
            type="button"
            disabled={disabled}
            className="ml-1 underline"
            onClick={() => set("cachePolicy", "none")}
          >
            关闭缓存
          </button>
        </p>
      ) : null}
      <label className={field}>
        数据分类
        <select
          aria-label="数据分类"
          className={control}
          disabled={disabled}
          value={classification}
          onChange={e => set("dataClassification", e.target.value)}
        >
          {!["public", "internal", "confidential"].includes(classification) && (
            <option value={classification}>待修正：{classification}</option>
          )}
          <option value="public">公开数据</option>
          <option value="internal">内部数据</option>
          <option value="confidential">机密数据</option>
        </select>
        <span className="font-normal text-muted-foreground">
          公开数据不能放行敏感字段；机密数据受模型服务的额外限制。
        </span>
      </label>
      <div className={field}>
        <span>单次调用费用上限（微货币单位）</span>
        <NodeNumberInput
          field={{
            label: "单次调用费用上限",
            min: 1,
            max: 1_000_000_000_000,
            step: 1,
            emptyHint: "留空不设置节点费用上限",
          }}
          value={config.maxCostMicros}
          disabled={disabled}
          className={control}
          onChange={next =>
            set("maxCostMicros", next === "" ? undefined : next)
          }
        />
        <p className="font-normal text-muted-foreground">
          1,000,000 微单位等于模型定价目录中的 1
          货币单位。配置上限前，部署管理员需提供可信模型价格。
        </p>
      </div>
      <label className={field}>
        允许传给模型的敏感字段
        <textarea
          aria-label="允许传给模型的敏感字段"
          className={control + " min-h-24"}
          disabled={disabled}
          placeholder={"每行一项，例如 input.customer.email"}
          value={sensitiveDraft}
          onChange={e => {
            const raw = e.target.value;
            setSensitiveDraft(raw);
            set(
              "allowSensitiveFields",
              raw
                .split(/\r?\n/)
                .map(s => s.trim())
                .filter(Boolean)
            );
          }}
        />
        <span className="font-normal text-muted-foreground">
          只填写确实允许发送的字段，以 input、vars 或 nodes
          开头；留空不额外放行。
        </span>
      </label>
      {classification === "public" && sensitiveText && (
        <p role="alert" className="text-xs text-destructive">
          公开数据不能配置敏感字段白名单，请清空白名单或选择匹配的数据分类。
        </p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          disabled={disabled}
          checked={config.humanReviewRequired === true}
          onChange={e => set("humanReviewRequired", e.target.checked)}
        />
        要求人工复核模型输出
      </label>
      <p className="text-xs text-muted-foreground">
        启用后需在模型成功分支连接人工审核节点，再执行后续动作。
      </p>
      <details className="min-w-0 rounded border border-border p-2 text-xs">
        <summary className="cursor-pointer">高级输出校验</summary>
        <p className="my-2 text-muted-foreground">
          可选确定性校验：使用 schema 定义输出结构，allowedValues
          限制字段的可选值。已有规则会保留。
        </p>
        <JsonRuleEditor
          value={config.deterministicValidation}
          disabled={disabled}
          onChange={next => set("deterministicValidation", next)}
        />
      </details>
    </div>
  );
}

function JsonRuleEditor({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const serialized = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(serialized),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(serialized);
    setError("");
  }, [serialized]);
  return (
    <>
      <textarea
        aria-label="高级输出校验 JSON"
        className={control + " min-h-28 font-mono"}
        disabled={disabled}
        value={draft}
        onChange={e => {
          setDraft(e.target.value);
          setError("");
        }}
      />
      <button
        type="button"
        disabled={disabled}
        className="mt-2 min-h-9 underline"
        onClick={() => {
          try {
            const parsed = draft.trim() ? JSON.parse(draft) : undefined;
            if (
              parsed !== undefined &&
              (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            )
              throw new Error();
            onChange(parsed);
            setError("");
          } catch {
            setError("请填写 JSON 对象，或留空后应用以移除校验。");
          }
        }}
      >
        应用输出校验
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
