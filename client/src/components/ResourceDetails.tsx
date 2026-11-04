import { useState } from "react";
import "./resource-details.css";
import { dataflowResultValue } from "@shared/dataflow-result-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function displayValue(value: unknown): string {
  if (value === "") return "（空字符串）";
  return dataflowResultValue(value, false);
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
        data-resource-details-trigger=""
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
          data-resource-details=""
        >
          <Button
            variant="ghost"
            data-resource-details-close=""
            aria-label="关闭资源详情"
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
          <DialogHeader>
            <DialogTitle>
              {asset.name}
            </DialogTitle>
            <DialogDescription className="aiflow-type-body">
              {asset.sourceName || "未关联数据源"} ·
              以下为已登记内容，样本不代表当前源数据。
            </DialogDescription>
          </DialogHeader>
          <div data-resource-details-tabs="" aria-label="资源详情内容">
            <Button
              variant={section === "schema" ? "default" : "outline"}
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
            data-resource-details-content=""
          >
            {!rows.length && (
              <p className="aiflow-type-body">
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
                    data-resource-record=""
                  >
                    <h3 className="aiflow-type-control">
                      {section === "schema" ? "字段" : "样本行"}{" "}
                      {currentPage * 10 + index + 1}
                    </h3>
                    <dl>
                      {fields.map(([key, value]) => (
                        <div
                          key={key}
                          data-resource-field=""
                        >
                          <dt className="aiflow-type-meta">
                            {key === "name" && section === "schema"
                              ? "字段名"
                              : key === "type" && section === "schema"
                                ? "类型"
                                : key}
                          </dt>
                          <dd className="aiflow-type-body">
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
          <div data-resource-details-footer="">
            <span
              className="aiflow-type-meta text-muted-foreground"
              role="status"
            >
              共 {rows.length} {section === "schema" ? "字段" : "行样本"} ·{" "}
              {currentPage + 1} / {pages} 页
            </span>
            <div>
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
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
