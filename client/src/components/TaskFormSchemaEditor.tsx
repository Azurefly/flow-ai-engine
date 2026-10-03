import * as React from "react";
import { assertTaskFormSchema, taskFormInputValue } from "@shared/task-form";
import { TaskFormField } from "./TaskFormField";
import { Button } from "./ui/button";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const types = {
  text: "文本",
  string: "文本",
  textarea: "多行文本",
  number: "数字",
  boolean: "是 / 否",
  email: "邮箱",
  date: "日期",
  select: "单选",
  multiselect: "多选",
};
const inputClass =
  "h-9 min-w-0 w-full rounded border border-border bg-card px-2 text-sm disabled:opacity-60";

export function TaskFormSchemaEditor({
  value,
  disabled,
  onChange,
  advanced,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
  advanced: React.ReactNode;
}) {
  const schema = record(value);
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  let error = "";
  try {
    assertTaskFormSchema(schema);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const save = (next: unknown[]) => onChange({ ...schema, fields: next });
  const update = (index: number, patch: RecordValue) =>
    save(
      fields.map((item, position) =>
        position === index ? { ...record(item), ...patch } : item
      )
    );
  const removeDefault = (index: number) =>
    save(
      fields.map((item, position) => {
        if (position !== index) return item;
        const next = { ...record(item) };
        delete next.defaultValue;
        return next;
      })
    );
  return (
    <fieldset
      className="grid min-w-0 gap-3 rounded-lg border border-border p-3"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-semibold">任务表单</legend>
      <p className="text-xs text-muted-foreground">
        显示名称供办理人查看；字段代号用于流程取值。字段顺序即办理时的显示顺序。
      </p>
      {!fields.length && (
        <p className="rounded bg-muted p-3 text-sm text-muted-foreground">
          尚未添加字段，办理人只需选择处理结果。
        </p>
      )}
      {fields.map((item, index) => {
        const field = record(item);
        const type = String(field.type ?? "text").toLowerCase();
        const options = Array.isArray(field.options) ? field.options : [];
        const defaultValue = field.defaultValue;
        const defaultText =
          defaultValue === undefined || defaultValue === null
            ? ""
            : typeof defaultValue === "object"
              ? JSON.stringify(defaultValue)
              : String(defaultValue);
        const name = String(field.label || field.key || `字段 ${index + 1}`);
        return (
          <section
            key={index}
            className="grid min-w-0 gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {index + 1}. {name}
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || index === 0}
                  aria-label={`上移${name}`}
                  onClick={() => {
                    const next = [...fields];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    save(next);
                  }}
                >
                  上移
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled || index === fields.length - 1}
                  aria-label={`下移${name}`}
                  onClick={() => {
                    const next = [...fields];
                    [next[index + 1], next[index]] = [
                      next[index],
                      next[index + 1],
                    ];
                    save(next);
                  }}
                >
                  下移
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-red-600"
                  aria-label={`删除${name}`}
                  onClick={() =>
                    save(fields.filter((_, position) => position !== index))
                  }
                >
                  删除
                </Button>
              </div>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs">
                显示名称
                <input
                  className={inputClass}
                  value={String(field.label ?? "")}
                  onChange={event =>
                    update(index, { label: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                字段代号
                <input
                  className={inputClass}
                  value={String(field.key ?? "")}
                  onChange={event => update(index, { key: event.target.value })}
                />
              </label>
            </div>
            <label className="grid gap-1 text-xs">
              字段类型
              <select
                className={inputClass}
                value={type === "string" ? "text" : type}
                onChange={event => update(index, { type: event.target.value })}
              >
                {!Object.hasOwn(types, type) && (
                  <option value={type}>未知类型 · {type}</option>
                )}
                {Object.entries(types)
                  .filter(([code]) => code !== "string")
                  .map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["required", "必填"],
                  ["readOnly", "只读"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={field[key] === true}
                    onChange={event =>
                      update(index, { [key]: event.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {["select", "multiselect"].includes(type) && (
              <div className="grid gap-2">
                <span className="text-xs font-semibold">可选项</span>
                {options.map((option, position) => {
                  const optionRecord = record(option);
                  const optionValue = Object.hasOwn(optionRecord, "value")
                    ? optionRecord.value
                    : option;
                  const changeOption = (patch: RecordValue) =>
                    update(index, {
                      options: options.map((current, at) =>
                        at === position
                          ? {
                              value: optionValue,
                              label: String(
                                optionRecord.label ?? optionValue ?? ""
                              ),
                              ...optionRecord,
                              ...patch,
                            }
                          : current
                      ),
                    });
                  return (
                    <div
                      key={position}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1"
                    >
                      <input
                        aria-label={`${name}选项${position + 1}名称`}
                        placeholder="显示名称"
                        className={inputClass}
                        value={String(optionRecord.label ?? optionValue ?? "")}
                        onChange={event =>
                          changeOption({ label: event.target.value })
                        }
                      />
                      <input
                        aria-label={`${name}选项${position + 1}值`}
                        placeholder="选项值"
                        className={inputClass}
                        value={
                          typeof optionValue === "object"
                            ? JSON.stringify(optionValue)
                            : String(optionValue ?? "")
                        }
                        onChange={event =>
                          changeOption({
                            value:
                              typeof optionValue === "number"
                                ? taskFormInputValue(
                                    "number",
                                    event.target.value
                                  )
                                : event.target.value,
                          })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`删除${name}选项${position + 1}`}
                        onClick={() =>
                          update(index, {
                            options: options.filter((_, at) => at !== position),
                          })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() =>
                    update(index, {
                      options: [...options, { value: "", label: "" }],
                    })
                  }
                >
                  添加选项
                </Button>
              </div>
            )}
            <details className="grid min-w-0 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                默认值与填写限制
              </summary>
              <div className="grid gap-3 pt-3">
                <div className="grid gap-1">
                  <span className="text-xs">
                    默认值{defaultValue === undefined ? "（未设置）" : ""}
                  </span>
                  <TaskFormField
                    field={{
                      label: `${name}默认值`,
                      type,
                      readOnly: disabled,
                      options,
                    }}
                    value={defaultText}
                    onChange={text =>
                      update(index, {
                        defaultValue: taskFormInputValue(type, text),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-fit"
                    onClick={() => removeDefault(index)}
                  >
                    清除默认值
                  </Button>
                </div>
                {(type === "number"
                  ? ["min", "max"]
                  : ["text", "string", "textarea", "email"].includes(type)
                    ? ["maxLength"]
                    : []
                ).map(key => (
                  <label key={key} className="grid gap-1 text-xs">
                    {
                      { min: "最小值", max: "最大值", maxLength: "最大长度" }[
                        key
                      ]
                    }
                    <input
                      type="number"
                      step={key === "maxLength" ? 1 : "any"}
                      className={inputClass}
                      value={field[key] === undefined ? "" : String(field[key])}
                      onChange={event => {
                        const next = { ...field };
                        if (event.target.value === "") delete next[key];
                        else next[key] = Number(event.target.value);
                        save(
                          fields.map((current, at) =>
                            at === index ? next : current
                          )
                        );
                      }}
                    />
                  </label>
                ))}
              </div>
            </details>
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
          let suffix = fields.length + 1;
          while (fields.some(item => record(item).key === `field_${suffix}`))
            suffix++;
          save([
            ...fields,
            {
              key: `field_${suffix}`,
              label: "新字段",
              type: "text",
              required: false,
            },
          ]);
        }}
      >
        添加表单字段
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
