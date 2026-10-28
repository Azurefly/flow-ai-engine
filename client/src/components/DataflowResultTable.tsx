import React, { useMemo, useState } from "react";
import {
  dataflowResultColumns,
  dataflowResultPage,
} from "@shared/dataflow-result-preview";
import { Button } from "./ui/button";

const metaClassName = "aiflow-type-meta text-muted-foreground";
function formatDataflowValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return String(value);
  return text.length > 96 ? `${text.slice(0, 93)}…` : text;
}

export function DataflowResultTable({
  rows,
  title = "最终结果预览",
}: {
  rows: Record<string, unknown>[];
  title?: string;
}) {
  const [page, setPage] = useState(0);
  const preview = dataflowResultPage(rows, page);
  const previewRows = preview.rows;
  const columns = useMemo(() => dataflowResultColumns(rows), [rows]);
  if (!columns.length)
    return (
      <p className="aiflow-type-body rounded border border-border p-3 text-muted-foreground">
        {title} · 共 {rows.length} 行
      </p>
    );
  return (
    <section className="min-w-0 rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="aiflow-type-body font-semibold text-foreground">
          {title}
        </h3>
        <span className={metaClassName}>
          第 {preview.page + 1} / {preview.pageCount} 页 · 每页 10 行 · 共{" "}
          {rows.length} 行
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        共 {columns.length} 个字段；可横向滚动查看全部字段。
      </p>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full min-w-[360px] text-left">
          <thead className="bg-muted text-sm text-muted-foreground">
            <tr>
              {columns.map(column => (
                <th
                  key={column}
                  className="aiflow-type-meta whitespace-nowrap px-2 py-1.5 font-medium"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row: any, rowIndex: number) => (
              <tr key={rowIndex} className="border-t border-border">
                {columns.map(column => (
                  <td
                    key={column}
                    title={
                      typeof row[column] === "string"
                        ? row[column]
                        : JSON.stringify(row[column])
                    }
                    className="aiflow-type-meta max-w-48 truncate px-2 py-1.5 text-foreground"
                  >
                    {formatDataflowValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="结果上一页"
          disabled={preview.page === 0}
          onClick={() => setPage(preview.page - 1)}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="结果下一页"
          disabled={preview.page + 1 >= preview.pageCount}
          onClick={() => setPage(preview.page + 1)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}
