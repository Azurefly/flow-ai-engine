import * as React from "react";
import { assertOperateOutcomes } from "@shared/workflow-node-contract";
import { Button } from "./ui/button";

type RecordValue = Record<string, unknown>;
const record = (item: unknown): RecordValue =>
  item && typeof item === "object" && !Array.isArray(item)
    ? (item as RecordValue)
    : {};
const inputClass =
  "h-9 min-w-0 w-full rounded border border-border bg-card px-2 text-sm disabled:opacity-60";

export function WorkflowOutcomeEditor({
  value,
  mode,
  disabled,
  targets,
  onChange,
  advanced,
}: {
  value: unknown;
  mode: string;
  disabled: boolean;
  targets?: Record<string, string>;
  onChange: (value: unknown) => void;
  advanced: React.ReactNode;
}) {
  const outcomes = Array.isArray(value) ? value : [];
  let error = "";
  try {
    assertOperateOutcomes({ outcomeMode: mode, outcomes: value });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const update = (index: number, patch: RecordValue) =>
    onChange(
      outcomes.map((item, at) =>
        at === index ? { ...record(item), ...patch } : item
      )
    );
  return (
    <fieldset
      disabled={disabled}
      className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
    >
      <legend className="px-1 text-sm font-semibold">处理结果与下一步</legend>
      <p className="text-xs text-muted-foreground">
        办理人选择结果后，流程沿对应出口的连线继续。修改出口代号后，请重新检查画布连线。
      </p>
      {mode !== "explicit" && (
        <p
          role="status"
          className="rounded bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          当前使用旧版路由：拒绝会取消流程。以下自定义结果暂不生效；切换为“显式结果出口”后启用。
        </p>
      )}
      {!outcomes.length && (
        <p className="rounded bg-muted p-3 text-sm text-muted-foreground">
          尚未配置处理结果，可添加“同意”“拒绝”或业务需要的其他结果。
        </p>
      )}
      {outcomes.map((item, index) => {
        const outcome = record(item);
        const handle = String(
          outcome.sourceHandle ?? outcome.code ?? ""
        ).trim();
        const destination =
          targets && Object.hasOwn(targets, handle)
            ? targets[handle]
            : undefined;
        const name = String(
          outcome.label ?? outcome.code ?? `结果 ${index + 1}`
        );
        return (
          <section
            key={index}
            className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {index + 1}. {name || "未命名结果"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600"
                aria-label={`删除结果${index + 1}`}
                onClick={() =>
                  onChange(outcomes.filter((_, at) => at !== index))
                }
              >
                删除
              </Button>
            </div>
            <label className="grid gap-1 text-xs">
              显示名称
              <input
                className={inputClass}
                value={String(outcome.label ?? "")}
                onChange={event => update(index, { label: event.target.value })}
              />
            </label>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs">
                结果代号
                <input
                  className={inputClass}
                  value={String(outcome.code ?? "")}
                  onChange={event =>
                    update(index, { code: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                出口代号
                <input
                  className={inputClass}
                  placeholder="默认使用结果代号"
                  value={String(outcome.sourceHandle ?? "")}
                  onChange={event =>
                    update(index, {
                      sourceHandle: event.target.value || undefined,
                    })
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={outcome.requireComment === true}
                onChange={event =>
                  update(index, { requireComment: event.target.checked })
                }
              />
              选择此结果时，处理意见必填
            </label>
            <p
              className={`rounded p-2 text-sm ${mode === "explicit" && !destination ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-muted text-muted-foreground"}`}
            >
              下一步：
              {mode !== "explicit"
                ? "尚未启用自定义结果"
                : destination || "未连接，请在画布上连接此出口"}
            </p>
          </section>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => {
          let index = outcomes.length + 1;
          const taken = new Set(
            outcomes.flatMap(item => {
              const entry = record(item);
              return [
                String(entry.code ?? "").trim(),
                String(entry.sourceHandle ?? entry.code ?? "").trim(),
              ];
            })
          );
          while (taken.has(`outcome_${index}`)) index++;
          onChange([
            ...outcomes,
            {
              code: `outcome_${index}`,
              label: "新处理结果",
              sourceHandle: `outcome_${index}`,
              requireComment: false,
            },
          ]);
        }}
      >
        添加处理结果
      </Button>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          高级结构编辑
        </summary>
        <div className="pt-2">{advanced}</div>
      </details>
    </fieldset>
  );
}
