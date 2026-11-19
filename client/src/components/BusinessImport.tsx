import { useRef, useState, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { newOperationUuid } from "@shared/resource-creation";
import { projectImportByteLimit } from "@shared/project-import";

export function BusinessImport({
  fileInput,
}: {
  fileInput: RefObject<HTMLInputElement | null>;
}) {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string>();
  const query = selectedId ? { batchId: selectedId } : {};
  const status = trpc.project.importStatus.useQuery(query);
  const history = trpc.project.importHistory.useQuery();
  const preview = trpc.project.previewImport.useMutation();
  const commit = trpc.project.commitImport.useMutation();
  const pendingPreview = useRef<{
    batchId: string;
    expectedRevision: number;
    csv: string;
  } | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const batch = status.isError ? undefined : status.data;
  const problems = batch
    ? [
        ...batch.issues,
        ...batch.rows.flatMap(row =>
          row.error
            ? [{ line: row.record.line, field: "业务代号", message: row.error }]
            : []
        ),
      ]
    : [];
  const completed = batch?.rows.filter(row => row.projectId).length ?? 0;
  const remaining = (batch?.rows.length ?? 0) - completed;
  async function operate(action: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "读取结果失败，请核对批次后重试。"
      );
      await status.refetch();
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  async function readFile(file: File, edit: boolean) {
    if (file.size > projectImportByteLimit)
      throw new Error("业务 CSV 最大为 512 KiB。");
    const csv = await file.text();
    let intent = pendingPreview.current;
    if (
      !intent ||
      intent.csv !== csv ||
      (edit && intent.batchId !== batch?.batchId)
    )
      intent = {
        csv,
        batchId: edit && batch ? batch.batchId : newOperationUuid(),
        expectedRevision: edit && batch ? batch.revision : 0,
      };
    pendingPreview.current = intent;
    const result = await preview.mutateAsync(intent);
    utils.project.importStatus.setData({ batchId: result.batchId }, result);
    utils.project.importStatus.setData({}, result);
    setSelectedId(result.batchId);
    void utils.project.importHistory.invalidate();
    pendingPreview.current = null;
  }
  async function apply() {
    if (!batch) return;
    let result: typeof status.data;
    do {
      result = await commit.mutateAsync({
        batchId: batch.batchId,
        expectedRevision: batch.revision,
      });
      utils.project.importStatus.setData(query, result);
    } while (
      result &&
      !result.issues.length &&
      !result.rows.some(r => r.error) &&
      result.rows.some(r => !r.projectId)
    );
    await utils.project.page.invalidate();
  }
  function exportProblems() {
    const quote = (s: string) =>
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"';
    const items = [
      "源行,字段,原因",
      ...problems.map(p =>
        [p.line, p.field, p.message].map(v => quote(String(v))).join(",")
      ),
    ];
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", items.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "业务导入错误.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        aria-label="业务导入文件"
        accept=".csv,text/csv"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const edit = event.target.dataset.correction === "true";
          delete event.target.dataset.correction;
          if (file) void operate(() => readFile(file, edit));
        }}
      />
      {(batch || working || error || status.isError) && (
        <section
          aria-label="业务导入批次"
          className="mb-4 rounded-lg border bg-card p-4"
        >
          <h2 className="font-semibold">业务导入批次</h2>
          {(history.data?.length ?? 0) > 1 && (
            <label className="my-2 block">
              查看批次
              <select
                className="ml-2 max-w-full"
                disabled={working}
                value={batch?.batchId ?? selectedId ?? ""}
                onChange={event => {
                  setSelectedId(event.target.value);
                  setError("");
                }}
              >
                {history.data?.map(entry => (
                  <option key={entry.batchId} value={entry.batchId}>
                    {new Date(entry.updatedAt).toLocaleString()} ·{" "}
                    {entry.batchId.slice(0, 8)} · 修订 {entry.revision}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          {status.isError ? (
            <Button onClick={() => void status.refetch()}>重新读取批次</Button>
          ) : (
            batch && (
              <>
                <p role="status">
                  已创建 {completed} · 待处理 {remaining} · 问题{" "}
                  {problems.length}
                </p>
                <div className="my-2 flex flex-wrap gap-2">
                  {remaining > 0 && !problems.length && (
                    <Button
                      disabled={working}
                      onClick={() => void operate(apply)}
                    >
                      {working
                        ? "正在提交…"
                        : completed
                          ? "继续导入"
                          : "确认导入"}
                    </Button>
                  )}
                  {(problems.length > 0 || remaining > 0) && (
                    <Button
                      variant="outline"
                      disabled={working}
                      onClick={() => {
                        if (fileInput.current) {
                          fileInput.current.dataset.correction = "true";
                          fileInput.current.click();
                        }
                      }}
                    >
                      上传本批纠正版
                    </Button>
                  )}
                  {problems.length > 0 && (
                    <Button variant="outline" onClick={exportProblems}>
                      下载错误明细
                    </Button>
                  )}
                </div>
                {!!problems.length && (
                  <ul className="max-h-36 overflow-auto" tabIndex={0}>
                    {problems.map((p, i) => (
                      <li key={i}>
                        第 {p.line} 行 · {p.field} · {p.message}
                      </li>
                    ))}
                  </ul>
                )}
                {batch.rows.length > 0 && (
                  <details>
                    <summary>查看逐行结果</summary>
                    <ul className="max-h-48 overflow-auto" tabIndex={0}>
                      {batch.rows.map(r => (
                        <li key={r.rowNumber}>
                          第 {r.record.line} 行 · {r.record.code} ·{" "}
                          {r.record.name} ·{" "}
                          {r.projectId
                            ? "已创建"
                            : r.error
                              ? "待纠正"
                              : "待处理"}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )
          )}
        </section>
      )}
    </>
  );
}
