export function TaskFormField({
  field,
  value,
  onChange,
  error,
}: {
  field: { label: string; type: string; readOnly: boolean; options: unknown[] };
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const className =
    "min-h-11 rounded border border-border bg-card px-3 py-2 text-sm font-normal disabled:opacity-70";
  if (field.type === "boolean")
    return (
      <input
        type="checkbox"
        aria-label={field.label}
        aria-invalid={Boolean(error)}
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
    const options = field.options.map(item =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item, label: item }
    );
    if (multiple)
      return (
        <div
          role="group"
          aria-label={field.label}
          aria-invalid={Boolean(error)}
          className="grid max-h-48 gap-1 overflow-y-auto rounded border border-border p-2"
        >
          {options.map((option, index) => {
            const matches = (item: unknown) =>
              JSON.stringify(item) === JSON.stringify(option.value);
            const checked = selected.some(matches);
            return (
              <label
                key={index}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm font-normal hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={field.readOnly}
                  className="size-5 accent-blue-600"
                  onChange={event =>
                    onChange(
                      JSON.stringify(
                        event.target.checked
                          ? [...selected, option.value]
                          : selected.filter(item => !matches(item))
                      )
                    )
                  }
                />
                {String(option.label ?? option.value ?? "")}
              </label>
            );
          })}
        </div>
      );
    return (
      <select
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        className={className}
        disabled={field.readOnly}
        value={value}
        onChange={event => onChange(event.target.value)}
      >
        <option value="">请选择</option>
        {options.map((option, index) => {
          return (
            <option key={index} value={String(option.value ?? "")}>
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
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        className={`${className} min-h-20 resize-y`}
        value={value}
        readOnly={field.readOnly}
        onChange={event => onChange(event.target.value)}
      />
    );
  return (
    <input
      aria-label={field.label}
      aria-invalid={Boolean(error)}
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
