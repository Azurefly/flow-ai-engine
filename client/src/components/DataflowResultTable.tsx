import React, { useMemo, useRef, useState } from "react";
import {
  dataflowResultColumns,
  dataflowResultPage,
  dataflowResultValue as formatDataflowValue,
  dataflowResultValueKind,
} from "@shared/dataflow-result-preview";
import { Button } from "./ui/button";
import "./dataflow-result-table.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function DataflowResultTable({
  rows,
  title = "最终结果预览",
}: {
  rows: Record<string, unknown>[];
  title?: string;
}) {
  const [page, setPage] = useState(0);
  const [cell, setCell] = useState<{ column: string; value: unknown; row: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const preview = dataflowResultPage(rows, page);
  const previewRows = preview.rows;
  const columns = useMemo(() => dataflowResultColumns(rows), [rows]);
  if (!columns.length)
    return (
      <p className="aiflow-type-body" data-result-empty="">
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
        {columns.length} 个字段 · 点击值看全文，可横向滚动。
      </p>
      <div data-result-scroll="">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th
                  key={column}
                >
                  <span title={column}>{column}</span>
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
                    <button type="button" title="查看完整内容" onClick={event => { trigger.current = event.currentTarget; setCell({ column, value: row[column], row: preview.offset + rowIndex + 1 }); }}>
                      {formatDataflowValue(row[column])}
                    </button>
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
      {/* UX：全文按需打开，不缩小字号；保留原始值，不在表格内展开巨型段落。 */}
      <Dialog open={Boolean(cell)} onOpenChange={open => { if (!open) setCell(null); }}>
        <DialogContent data-result-value-dialog="" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus(); }}>
          <Button type="button" variant="ghost" size="icon" className="result-value-close" aria-label="关闭完整内容" onClick={() => setCell(null)}>×</Button>
          <DialogHeader>
            <DialogTitle>单元格完整内容</DialogTitle>
            <DialogDescription>{cell ? `第 ${cell.row} 行 · ${dataflowResultValueKind(cell.value)}` : ""}</DialogDescription>
          </DialogHeader>
          {cell && <>
            <p data-result-field-name="">{cell.column}</p>
            <pre tabIndex={0} aria-label="完整字段值">{formatDataflowValue(cell.value, false)}</pre>
          </>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
