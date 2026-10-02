import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function displayValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "未提供";
  if (value === "") return "（空字符串）";
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}

export function ResourceDetails({
  asset,
}: {
  asset: {
    name: string;
    sourceName?: string;
    schema?: unknown[];
    sample?: Record<string, unknown>[];
  };
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<"schema" | "sample">("schema");
  const [page, setPage] = useState(0);
  const rows =
    section === "schema" ? (asset.schema ?? []) : (asset.sample ?? []);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pages - 1);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="aiflow-type-control h-11 sm:h-10"
        aria-label={`查看资源详情 ${asset.name}`}
        onClick={() => {
          setSection("schema");
          setPage(0);
          setOpen(true);
        }}
      >
        查看详情
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-1rem)] max-w-2xl flex-col gap-4 overflow-hidden"
        >
          <Button
            variant="ghost"
            className="aiflow-type-control absolute right-2 top-2 h-11 w-11 p-0 sm:h-10 sm:w-10"
            aria-label="关闭资源详情"
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
          <DialogHeader className="shrink-0 pr-10">
            <DialogTitle className="break-words [overflow-wrap:anywhere]">
              {asset.name}
            </DialogTitle>
            <DialogDescription className="aiflow-type-body break-words [overflow-wrap:anywhere]">
              {asset.sourceName || "未关联数据源"} ·
              以下为已登记内容，样本不代表当前源数据。
            </DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 gap-2" aria-label="资源详情内容">
            <Button
              variant={section === "schema" ? "default" : "outline"}
              className="aiflow-type-control h-11 flex-1 sm:h-10"
              aria-pressed={section === "schema"}
              onClick={() => {
                setSection("schema");
                setPage(0);
              }}
            >
              字段结构（{asset.schema?.length ?? 0}）
            </Button>
            <Button
              variant={section === "sample" ? "default" : "outline"}
              className="aiflow-type-control h-11 flex-1 sm:h-10"
              aria-pressed={section === "sample"}
              onClick={() => {
                setSection("sample");
                setPage(0);
              }}
            >
              样本数据（{asset.sample?.length ?? 0}）
            </Button>
          </div>
          <section
            aria-label={section === "schema" ? "登记字段结构" : "登记样本数据"}
            className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain"
          >
            {!rows.length && (
              <p className="aiflow-type-body py-6 text-muted-foreground">
                {section === "schema" ? "未登记字段结构。" : "未登记样本数据。"}
              </p>
            )}
            {rows
              .slice(currentPage * 10, (currentPage + 1) * 10)
              .map((row, index) => {
                const fields: [string, unknown][] =
                  row !== null && typeof row === "object" && !Array.isArray(row)
                    ? Object.entries(row)
                    : [["内容", row]];
                return (
                  <article
                    key={currentPage * 10 + index}
                    className="min-w-0 rounded-lg border bg-muted/20 p-3"
                  >
                    <h3 className="aiflow-type-control mb-2 font-semibold">
                      {section === "schema" ? "字段" : "样本行"}{" "}
                      {currentPage * 10 + index + 1}
                    </h3>
                    <dl className="space-y-2">
                      {fields.map(([key, value]) => (
                        <div
                          key={key}
                          className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]"
                        >
                          <dt className="aiflow-type-control break-words text-muted-foreground [overflow-wrap:anywhere]">
                            {key === "name" && section === "schema"
                              ? "字段名"
                              : key === "type" && section === "schema"
                                ? "类型"
                                : key}
                          </dt>
                          <dd className="aiflow-type-body min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {displayValue(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {!fields.length && (
                      <p className="aiflow-type-body text-muted-foreground">
                        空记录
                      </p>
                    )}
                  </article>
                );
              })}
          </section>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span
              className="aiflow-type-meta text-muted-foreground"
              role="status"
            >
              共 {rows.length} {section === "schema" ? "字段" : "行样本"} ·{" "}
              {currentPage + 1} / {pages} 页
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="aiflow-type-control h-11 sm:h-10"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                className="aiflow-type-control h-11 sm:h-10"
                disabled={currentPage >= pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
