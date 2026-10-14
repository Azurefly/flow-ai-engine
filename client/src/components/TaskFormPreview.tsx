import * as React from "react";
import { useEffect, useId, useState } from "react";
import {
  assertTaskFormSchema,
  taskFormFieldErrors,
  taskFormRowValues,
} from "@shared/task-form";
import { taskFormViewFields } from "@shared/task-form-view";
import { visibleTaskFormErrors } from "@shared/task-form-feedback";
import { TaskFormField } from "./TaskFormField";
import { Button } from "./ui/button";

export function TaskFormPreview({ schema }: { schema: unknown }) {
  const signature = JSON.stringify(schema);
  const fields = taskFormViewFields(schema);
  const initialRows = () =>
    fields.map(field => ({ key: field.key, value: field.defaultValue }));
  const [rows, setRows] = useState(initialRows);
  const [checked, setChecked] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const errorId = useId();
  const reset = () => {
    setRows(initialRows());
    setChecked(false);
    setTouched(new Set());
  };
  useEffect(reset, [signature]);
  let schemaError = "";
  try {
    assertTaskFormSchema(schema);
  } catch (cause) {
    schemaError = cause instanceof Error ? cause.message : String(cause);
  }
  const rawFields =
    schema &&
    typeof schema === "object" &&
    Array.isArray((schema as any).fields)
      ? (schema as any).fields
      : [];
  const errors = taskFormFieldErrors(
    rawFields,
    taskFormRowValues(fields, rows)
  );
  const visibleErrors = checked
    ? errors
    : visibleTaskFormErrors(errors, touched, fields);
  return (
    <details
      data-task-form-preview=""
      className="min-w-0 rounded-lg border border-blue-200 bg-blue-50/40 p-3"
    >
      <summary className="cursor-pointer text-sm font-semibold text-blue-900">
        预览办理表单
      </summary>
      <div className="mt-3 grid min-w-0 gap-3">
        <p className="text-sm text-muted-foreground">
          按办理人的视角试填；填写值仅用于本次预览。
        </p>
        {schemaError && (
          <p role="alert" className="text-sm text-destructive">
            请先修正字段配置：{schemaError}
          </p>
        )}
        {!fields.length && (
          <p className="text-sm text-muted-foreground">
            未配置表单字段，办理人只需选择处理结果。
          </p>
        )}
        {fields.map((field, index) => (
          <div
            key={field.key}
            className="grid min-w-0 gap-1 text-sm"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setTouched(current => new Set(current).add(field.key));
            }}
          >
            <p className="font-medium">
              {field.label}
              {field.required ? "（必填）" : "（可选）"}
              {field.readOnly && (
                <span className="ml-2 text-xs text-muted-foreground">只读</span>
              )}
            </p>
            <TaskFormField
              field={field}
              value={rows.find(row => row.key === field.key)?.value ?? ""}
              error={visibleErrors[field.key]}
              errorId={`${errorId}-${index}`}
              onChange={value =>
                setRows(current =>
                  current.map(row =>
                    row.key === field.key ? { ...row, value } : row
                  )
                )
              }
            />
            {visibleErrors[field.key] && (
              <p
                id={`${errorId}-${index}`}
                role="alert"
                className="text-sm text-destructive"
              >
                {visibleErrors[field.key]}
              </p>
            )}
          </div>
        ))}
        {Boolean(fields.length) && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={Boolean(schemaError)}
              onClick={() => setChecked(true)}
            >
              检查试填内容
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              恢复默认值
            </Button>
          </div>
        )}
        {checked && !schemaError && (
          <p
            role="status"
            className={`text-sm ${Object.keys(errors).length ? "text-destructive" : "text-emerald-700"}`}
          >
            {Object.keys(errors).length
              ? `还有 ${Object.keys(errors).length} 项需要修正。`
              : "试填校验通过。"}
          </p>
        )}
      </div>
    </details>
  );
}
