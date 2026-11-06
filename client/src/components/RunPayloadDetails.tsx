import { runErrorPreview } from "@shared/run-error-preview";
import React from "react";
import { taskResultView } from "@shared/task-result-view";
import { hasRunPayloadValue, splitRunPayload } from "@shared/run-payload";
import "./run-payload-details.css";

type FieldRow = { field: string; value: string; fullValue?: string };
const FIELD_PREVIEW_LIMIT = 1600;
const DEPTH_PREVIEW = "内容层级较深，已收起";
const sectionTitleClass = "aiflow-type-section-title";

function flattenFields(
  value: unknown,
  prefix = "",
  depth = 0,
  rows: FieldRow[] = []
): FieldRow[] {
  if (rows.length >= 80) return rows;
  if (value === null || value === undefined) return rows;
  if (depth >= 6) {
    rows.push({ field: prefix || "值", value: DEPTH_PREVIEW });
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
          value: `${text.slice(0, FIELD_PREVIEW_LIMIT).replace(/[\uD800-\uDBFF]$/, "")}…`,
          fullValue: text,
        }
      : { field: prefix || "值", value: text }
  );
  return rows;
}

function PayloadFields({
  value,
  rows: fields,
}: {
  value?: unknown;
  rows?: FieldRow[];
}) {
  const [showFull, setShowFull] = React.useState(false);
  const rows = fields ?? flattenFields(value);
  if (!rows.length) return null;
  return (
    // 全文区域保留原生空格键展开/滚动，避免画布的全局按键处理截获。
    <dl data-payload-fields="" onKeyDown={event => {
      if (event.key === " ") event.stopPropagation();
    }}>
      {rows.map((row, index) => (
        <div
          key={`${row.field}-${index}`}
          data-payload-field=""
        >
          <dt className="aiflow-type-meta" title={row.field}>
            {row.field}
          </dt>
          <dd className="aiflow-type-body">
            <div data-payload-preview="">{row.value}</div>
            {row.fullValue && (
              <details>
                <summary className="aiflow-type-control">
                  查看完整内容（{row.fullValue.length} 字符）
                </summary>
                <pre className="aiflow-type-code">
                  {row.fullValue}
                </pre>
              </details>
            )}
          </dd>
        </div>
      ))}
      {/* 摘要超出层级或字段上限时，按需展示原数据，不截断真实值。 */}
      {value !== undefined && (rows.length === 80 || rows.some(row => row.value === DEPTH_PREVIEW)) && (
        <div data-payload-field="">
          <dt>{rows.length === 80 ? "字段较多，仅展示前 80 项。" : DEPTH_PREVIEW}</dt>
          <dd>
            <details onToggle={event => setShowFull(event.currentTarget.open)}>
              <summary>查看完整数据（JSON）</summary>
              {showFull && <pre className="aiflow-type-code">{JSON.stringify(value, null, 2)}</pre>}
            </details>
          </dd>
        </div>
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
    <details data-payload-disclosure="">
      <summary className="aiflow-type-control">
        {label}
        <span>展开</span>
      </summary>
      <div>
        <PayloadFields value={value} />
      </div>
    </details>
  );
}

export function RunPayloadDetails({
  title,
  value,
  nodeType,
  nodeConfig,
  kind = "input",
}: {
  title: string;
  value: unknown;
  nodeType?: string;
  nodeConfig?: unknown;
  kind?: "input" | "output" | "error";
}) {
  if (value === null || value === undefined) return null;
  if (kind === "error") {
    const error = runErrorPreview(value);
    return (
      <section data-run-payload-details>
        <h4 className={sectionTitleClass}>
          {title}
        </h4>
        <div data-payload-groups="">
          {error.message && (
            <PayloadFields value={{ 错误原因: error.message }} />
          )}
          {hasRunPayloadValue(error.details) && (
            <div>
              <p className="aiflow-type-body" data-payload-group-label="">
                错误详情
              </p>
              <PayloadFields value={error.details} />
            </div>
          )}
          {!error.message &&
            !hasRunPayloadValue(error.details) &&
            !error.stack && (
              <p className="aiflow-type-body text-muted-foreground">
                未提供错误详情。
              </p>
            )}
          <PayloadDisclosure label="调用堆栈（诊断信息）" value={error.stack} />
        </div>
      </section>
    );
  }
  const parts = splitRunPayload(value, nodeType);
  const output = parts.businessInput as Record<string, unknown> | null;
  if (
    kind === "output" &&
    nodeType === "operate" &&
    output?.result &&
    typeof output.result === "object" &&
    !Array.isArray(output.result)
  ) {
    const view = taskResultView(nodeConfig, {
      ...output.result,
      outcome: output.outcome ?? (output.result as any).outcome,
      decision: output.decision ?? (output.result as any).decision,
    });
    return (
      <section data-run-payload-details>
        <h4 className={sectionTitleClass}>{title}</h4>
        <PayloadFields
          rows={[
            { field: "办理结果", value: view.outcome || "未提供" },
            ...(view.comment
              ? [{ field: "处理意见", value: view.comment }]
              : []),
            ...view.rows.map(row => ({ field: row.label, value: row.value })),
          ]}
        />
        <PayloadDisclosure
          label="完整办理结果与汇总明细"
          value={parts.businessInput}
        />
        <PayloadDisclosure
          label="运行时元数据（内部诊断字段）"
          value={parts.runtimeMetadata}
        />
      </section>
    );
  }
  const visibleGroups = [
    {
      label: kind === "output" ? "业务结果" : "业务输入",
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
    <section data-run-payload-details>
      <h4 className={sectionTitleClass}>
        {title}
      </h4>
      <div data-payload-groups="">
        {visibleGroups.map(group =>
          group.collapsed ? (
            <PayloadDisclosure
              key={group.label}
              label={group.label}
              value={group.value}
            />
          ) : (
            <div key={group.label}>
              <p className="aiflow-type-body" data-payload-group-label="">
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
