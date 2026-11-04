import React, { useMemo, useState } from "react";
import {
  dataflowResultColumns,
  dataflowResultPage,
} from "@shared/dataflow-result-preview";
import { Button } from "./ui/button";
import "./dataflow-result-table.css";

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
    // UX：结果表的字体、间距与滚动在组件作用域统一，分页和单元格逻辑保留。
    <section data-dataflow-result="">
      <header>
        <h3>
          {title}
        </h3>
        <span>
          第 {preview.page + 1} / {preview.pageCount} 页 · 每页 10 行 · 共{" "}
          {rows.length} 行
        </span>
      </header>
      <p>
        共 {columns.length} 个字段；可横向滚动查看全部字段。
      </p>
      <div data-result-scroll="">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th
                  key={column}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row: any, rowIndex: number) => (
              <tr key={rowIndex}>
                {columns.map(column => (
                  <td
                    key={column}
                    title={
                      typeof row[column] === "string"
                        ? row[column]
                        : JSON.stringify(row[column])
                    }
                  >
                    {formatDataflowValue(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
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
      </footer>
    </section>
  );
}
