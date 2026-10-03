import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  appendAggregateMetric,
  updateAggregateMetric,
} from "./aggregate-metric-editor-state";

const operations = [
  ["count", "计数"],
  ["sum", "求和"],
  ["min", "最小值"],
  ["max", "最大值"],
  ["avg", "平均值"],
];

export function AggregateMetricEditor({
  value,
  disabled,
  onChange,
}: {
  value: Record<string, unknown>[];
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const inputClass =
    "aiflow-type-control h-11 min-w-0 w-full rounded-md border border-border bg-card px-2.5 text-foreground outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-muted disabled:text-muted-foreground min-[1024px]:h-9";
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <legend className="aiflow-type-control mb-2 font-semibold">
        聚合指标
      </legend>
      {!value.length && (
        <p className="aiflow-type-body rounded-md border border-dashed p-3 text-muted-foreground">
          添加一个指标，例如订单数量或金额合计。
        </p>
      )}
      {value.map((metric, index) => {
        const operation = String(metric.operation ?? "count");
        const count = operation === "count";
        return (
          <div
            key={index}
            className="grid min-w-0 gap-3 rounded-lg border border-border bg-muted/20 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="aiflow-type-control font-medium">
                指标 {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`删除指标 ${index + 1}`}
                onClick={() =>
                  onChange(value.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <label className="aiflow-type-control grid gap-1.5">
              输出名称
              <input
                className={inputClass}
                aria-label={`指标 ${index + 1} 输出名称`}
                value={String(metric.name ?? "")}
                placeholder="例如 total_amount"
                onChange={event =>
                  onChange(
                    updateAggregateMetric(value, index, {
                      name: event.target.value,
                    })
                  )
                }
              />
            </label>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <label className="aiflow-type-control grid gap-1.5">
                计算方式
                <select
                  className={inputClass}
                  aria-label={`指标 ${index + 1} 计算方式`}
                  value={operation}
                  onChange={event =>
                    onChange(
                      updateAggregateMetric(value, index, {
                        operation: event.target.value,
                      })
                    )
                  }
                >
                  {!operations.some(([key]) => key === operation) && (
                    <option value={operation}>不支持：{operation}</option>
                  )}
                  {operations.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="aiflow-type-control grid gap-1.5">
                {count ? "字段（可选）" : "数值字段"}
                <input
                  className={inputClass}
                  aria-label={`指标 ${index + 1} 字段`}
                  value={String(metric.field ?? "")}
                  placeholder={count ? "留空统计总行数" : "例如 amount"}
                  onChange={event =>
                    onChange(
                      updateAggregateMetric(value, index, {
                        field: event.target.value,
                      })
                    )
                  }
                />
              </label>
            </div>
            <p className="aiflow-type-body text-muted-foreground">
              {count
                ? "不填字段统计全部记录；填写字段只统计非空值。"
                : "忽略空值；没有有效数值时返回 null，非数值会报错。"}
            </p>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange(appendAggregateMetric(value))}
      >
        <Plus size={14} />
        添加指标
      </Button>
    </fieldset>
  );
}
