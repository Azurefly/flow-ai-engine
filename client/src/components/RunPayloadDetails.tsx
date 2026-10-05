import { hasRunPayloadValue, splitRunPayload } from "@shared/run-payload";

type FieldRow = { field: string; value: string; fullValue?: string };
const FIELD_PREVIEW_LIMIT = 1600;

function flattenFields(
  value: unknown,
  prefix = "",
  depth = 0,
  rows: FieldRow[] = []
): FieldRow[] {
  if (rows.length >= 80) return rows;
  if (value === null || value === undefined) return rows;
  if (depth >= 6) {
    rows.push({ field: prefix || "值", value: "内容层级较深，已收起" });
    return rows;
  }
  if (Array.isArray(value)) {
    if (!value.length && prefix) rows.push({ field: prefix, value: "空列表" });
    value.forEach((item, index) =>
      flattenFields(item, `${prefix || "列表"}[${index}]`, depth + 1, rows)
    );
    return rows;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length && prefix)
      rows.push({ field: prefix, value: "空对象" });
    entries.forEach(([key, item]) =>
      flattenFields(item, prefix ? `${prefix}.${key}` : key, depth + 1, rows)
    );
    return rows;
  }
  const text = String(value);
  rows.push(
    text.length > FIELD_PREVIEW_LIMIT
      ? {
          field: prefix || "值",
          value: `${text.slice(0, FIELD_PREVIEW_LIMIT)}…`,
          fullValue: text,
        }
      : { field: prefix || "值", value: text }
  );
  return rows;
}

function PayloadFields({ value }: { value: unknown }) {
  const rows = flattenFields(value);
  if (!rows.length) return null;
  return (
    <dl className="overflow-hidden rounded-md border border-border bg-card">
      {rows.map((row, index) => (
        <div
          key={`${row.field}-${index}`}
          className="grid min-w-0 gap-1 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(112px,0.35fr)_minmax(0,1fr)]"
        >
          <dt className="aiflow-type-code break-all font-mono text-muted-foreground">
            {row.field}
          </dt>
          <dd className="aiflow-type-body min-w-0 whitespace-pre-wrap break-words text-foreground">
            {row.value}
            {row.fullValue && (
              <details className="mt-2 rounded border border-border bg-muted">
                <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center px-2 font-medium text-aiflow-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                  查看完整内容（{row.fullValue.length} 字符）
                </summary>
                <pre className="aiflow-type-code max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-border p-2 [overflow-wrap:anywhere]">
                  {row.fullValue}
                </pre>
              </details>
            )}
          </dd>
        </div>
      ))}
      {rows.length === 80 && (
        <p className="aiflow-type-body px-3 py-2 text-muted-foreground">
          字段较多，仅展示前 80 项。
        </p>
      )}
    </dl>
  );
}

function PayloadDisclosure({
  label,
  value,
}: {
  label: string;
  value: unknown;
}) {
  if (!hasRunPayloadValue(value)) return null;
  return (
    <details className="overflow-hidden rounded-md border border-border bg-muted">
      <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
        {label}
        <span className="font-normal text-muted-foreground">展开</span>
      </summary>
      <div className="border-t border-border p-2">
        <PayloadFields value={value} />
      </div>
    </details>
  );
}

export function RunPayloadDetails({
  title,
  value,
  nodeType,
}: {
  title: string;
  value: unknown;
  nodeType?: string;
}) {
  if (value === null || value === undefined) return null;
  const parts = splitRunPayload(value, nodeType);
  const visibleGroups = [
    {
      label: title.includes("输出") ? "业务结果" : "业务输入",
      value: parts.businessInput,
      collapsed: false,
    },
    { label: "流程变量", value: parts.flowVariables, collapsed: true },
    { label: "节点结果", value: parts.nodeResults, collapsed: true },
    {
      label: "其他业务字段",
      value: parts.additionalBusinessFields,
      collapsed: false,
    },
  ].filter(group => hasRunPayloadValue(group.value));

  return (
    <section data-run-payload-details className="min-w-0">
      <h4 className="aiflow-type-section-title mb-2 font-semibold text-foreground">
        {title}
      </h4>
      <div className="grid min-w-0 gap-2">
        {visibleGroups.map(group =>
          group.collapsed ? (
            <PayloadDisclosure
              key={group.label}
              label={group.label}
              value={group.value}
            />
          ) : (
            <div key={group.label} className="min-w-0">
              <p className="aiflow-type-body mb-1 font-medium text-muted-foreground">
                {group.label}
              </p>
              <PayloadFields value={group.value} />
            </div>
          )
        )}
        {!visibleGroups.length && (
          <p className="aiflow-type-body rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground">
            此节点没有业务字段。
          </p>
        )}
        <PayloadDisclosure
          label="节点配置快照"
          value={parts.nodeConfiguration}
        />
        <PayloadDisclosure
          label="运行时元数据（内部诊断字段）"
          value={parts.runtimeMetadata}
        />
        <PayloadDisclosure
          label="其他上下文字段"
          value={parts.additionalContext}
        />
      </div>
    </section>
  );
}
