import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
export default function ConnectorWriteReceipts({
  projectId,
  runId,
}: {
  projectId: string;
  runId: string;
}) {
  const list = trpc.connector.writes.useQuery({ projectId, runId });
  const confirm = trpc.connector.confirm.useMutation();
  const [approved, setApproved] = useState(""),
    [feedback, setFeedback] = useState("");
  if (list.isError)
    return <p role="alert">写回回执读取失败。{list.error.message}</p>;
  if (!list.data?.length) return null;
  return (
    <section
      className="grid gap-2 rounded border p-3"
      aria-label="外部写回预览"
    >
      <h3 className="font-semibold">外部写回预览与回执</h3>
      {list.data.map(r => (
        <div className="grid gap-1" key={r.operationKey}>
          <p>
            {r.label} · {r.destination} · {r.rowCount} 行 ·{" "}
            {r.status === "committed"
              ? "目标已确认"
              : r.status === "pending"
                ? "等待核对目标回执"
                : r.status.startsWith("rejected_")
                  ? "目标拒绝，HTTP " + r.status.slice(9)
                  : "尚未发送"}
          </p>
          <details>
            <summary>核对待写入样本（最多三行）</summary>
            <pre className="max-h-48 overflow-auto text-sm">
              {JSON.stringify(r.sample, null, 2)}
            </pre>
          </details>
          <p className="break-all text-sm">
            内容摘要 <code>{r.payloadHash}</code>
          </p>
          {r.receipt && (
            <p>
              目标回执 <code>{r.receipt}</code>
            </p>
          )}
          {r.canConfirm &&
            (r.status === "preview" || r.status === "pending") &&
            (approved === r.operationKey ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={confirm.isPending}
                  onClick={async () => {
                    try {
                      const result = await confirm.mutateAsync({
                        projectId,
                        operationKey: r.operationKey,
                        payloadHash: r.payloadHash,
                      });
                      setFeedback(
                        result.status === "committed"
                          ? "目标已确认写入。"
                          : result.status === "rejected"
                            ? "目标拒绝了该内容。请核对目标合同和行数据。"
                            : "结果待核对，再次操作将先读取原回执。"
                      );
                      await list.refetch();
                      setApproved("");
                    } catch (e) {
                      setFeedback(
                        e instanceof Error ? e.message : "目标核对失败。"
                      );
                    }
                  }}
                >
                  确认发送或核对 {r.rowCount} 行
                </Button>
                <Button
                  disabled={confirm.isPending}
                  variant="outline"
                  onClick={() => setApproved("")}
                >
                  取消
                </Button>
              </div>
            ) : (
              <Button
                className="w-fit"
                variant="outline"
                onClick={() => setApproved(r.operationKey)}
              >
                {r.status === "pending" ? "核对原操作" : "审核外部写入"}
              </Button>
            ))}
        </div>
      ))}
      {feedback && <p role="status">{feedback}</p>}
    </section>
  );
}
