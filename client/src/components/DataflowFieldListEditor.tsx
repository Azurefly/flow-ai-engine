import { fieldListIssue } from "@shared/dataflow-field-list";
import { Button } from "./ui/button";
export function DataflowFieldListEditor({
  value,
  disabled,
  label,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  label: string;
  onChange: (value: unknown) => void;
}) {
  const issue = fieldListIssue(value);
  if (!Array.isArray(value))
    return (
      <div className="grid gap-2">
        <p role="alert" className="text-xs text-destructive">
          {issue}
        </p>
        <Button
          disabled={disabled}
          variant="outline"
          onClick={() => onChange([])}
        >
          重建字段列表
        </Button>
      </div>
    );
  return (
    <div className="grid gap-2">
      {!value.length && (
        <p className="text-xs text-muted-foreground">尚未添加字段</p>
      )}
      {value.map((item, index) => (
        <div key={index} className="flex min-w-0 items-center gap-2">
          <span className="w-5 shrink-0 text-xs text-muted-foreground">
            {index + 1}
          </span>
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-muted"
            aria-label={`${label}第${index + 1}项字段名称`}
            placeholder="填写字段名称，如 orderId"
            disabled={disabled}
            value={
              typeof item === "string" ? item : (JSON.stringify(item) ?? "")
            }
            onChange={event =>
              onChange(
                value.map((current, i) =>
                  i === index ? event.target.value : current
                )
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`删除${label}第${index + 1}项`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            删除
          </Button>
        </div>
      ))}
      {issue && (
        <p role="alert" className="text-xs text-destructive">
          {issue}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={() => onChange([...value, ""])}
      >
        添加字段
      </Button>
    </div>
  );
}
