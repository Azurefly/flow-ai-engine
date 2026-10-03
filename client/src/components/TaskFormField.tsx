export function TaskFormField({
  field,
  value,
  onChange,
}: {
  field: { type: string; readOnly: boolean; options: unknown[] };
  value: string;
  onChange: (value: string) => void;
}) {
  const className =
    "min-h-11 rounded border border-border bg-card px-3 py-2 text-sm font-normal disabled:opacity-70";
  if (field.type === "boolean")
    return (
      <input
        type="checkbox"
        className="size-5 accent-blue-600"
        checked={value === "true"}
        disabled={field.readOnly}
        onChange={event => onChange(String(event.target.checked))}
      />
    );
  if (field.type === "select" || field.type === "multiselect") {
    const multiple = field.type === "multiselect";
    let selected: unknown[] = [];
    if (multiple) {
      try {
        const parsed = JSON.parse(value || "[]");
        selected = Array.isArray(parsed) ? parsed : [];
      } catch {}
    }
    return (
      <select
        className={className}
        multiple={multiple}
        disabled={field.readOnly}
        value={multiple ? selected.map(item => JSON.stringify(item)) : value}
        onChange={event =>
          onChange(
            multiple
              ? JSON.stringify(
                  Array.from(event.target.selectedOptions, option =>
                    JSON.parse(option.value)
                  )
                )
              : event.target.value
          )
        }
      >
        {!multiple && <option value="">请选择</option>}
        {field.options.map((item, index) => {
          const option =
            item && typeof item === "object" && !Array.isArray(item)
              ? (item as Record<string, unknown>)
              : { value: item, label: item };
          return (
            <option
              key={index}
              value={
                multiple
                  ? JSON.stringify(option.value)
                  : String(option.value ?? "")
              }
            >
              {String(option.label ?? option.value ?? "")}
            </option>
          );
        })}
      </select>
    );
  }
  if (field.type === "textarea")
    return (
      <textarea
        className={`${className} min-h-20 resize-y`}
        value={value}
        readOnly={field.readOnly}
        onChange={event => onChange(event.target.value)}
      />
    );
  return (
    <input
      type={
        ["number", "email", "date"].includes(field.type) ? field.type : "text"
      }
      step={field.type === "number" ? "any" : undefined}
      className={className}
      value={value}
      readOnly={field.readOnly}
      onChange={event => onChange(event.target.value)}
    />
  );
}
