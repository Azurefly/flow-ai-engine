import { useEffect, useRef, useState } from "react";
import { FolderTree, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Definition } from "../../../server/workflow-service";

export default function WorkflowSubflowSnapshots({
  workflowId,
  savedVersion,
  definition,
  published,
  canEdit,
  busy,
  onSave,
  onResolve,
}: {
  workflowId: string;
  savedVersion: number;
  definition: Definition | null;
  published: boolean;
  canEdit: boolean;
  busy: boolean;
  onSave: () => Promise<void>;
  onResolve: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const currentId = useRef(workflowId);
  currentId.current = workflowId;
  const currentVersion = useRef(savedVersion);
  currentVersion.current = savedVersion;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setSaving(false);
    lock.current = false;
  }, [workflowId]);
  useEffect(() => setError(""), [savedVersion]);
  const nodes = definition?.nodes.filter(node => node.type === "subflow") ?? [];
  if (!nodes.length) return null;
  const snapshots = nodes.map(node => {
    const value = node.config.resolvedSubflowDefinition;
    const snapshot =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { nodes?: unknown[]; edges?: unknown[] })
        : null;
    const saved =
      node.config.resolvedSubflowId === node.config.subflowId &&
      Array.isArray(snapshot?.nodes) &&
      Array.isArray(snapshot?.edges);
    const stamp = new Date(String(node.config.resolvedSubflowUpdatedAt ?? ""));
    return {
      id: node.id,
      name: node.name,
      childName: String(node.config.resolvedSubflowName ?? "尚未捕获快照"),
      saved,
      count: saved ? snapshot!.nodes!.length : 0,
      stamp: Number.isNaN(stamp.getTime())
        ? "未记录时间"
        : stamp.toLocaleString("zh-CN", { hour12: false }),
    };
  });
  const missing = snapshots.filter(item => !item.saved).length;
  const save = async () => {
    if (lock.current || busy || published || !canEdit || error) return;
    lock.current = true;
    setSaving(true);
    const submittedId = workflowId;
    const submittedVersion = savedVersion;
    try {
      await onSave();
    } catch (failure) {
      if (
        alive.current &&
        currentId.current === submittedId &&
        currentVersion.current === submittedVersion
      )
        setError(
          failure instanceof Error ? failure.message : "快照保存结果尚未确认。"
        );
    } finally {
      if (alive.current && currentId.current === submittedId) {
        setSaving(false);
        lock.current = false;
      }
    }
  };
  return (
    <section
      data-workflow-subflow-snapshots=""
      aria-label="私有子流程快照"
      className="aiflow-type-body mb-3 grid min-w-0 gap-3 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="aiflow-type-control flex items-center gap-2 font-semibold">
            <FolderTree size={16} aria-hidden="true" />
            子流程执行快照 · {nodes.length} 个引用
          </p>
          <p className="mt-1 break-words text-muted-foreground">
            {published
              ? "本次发布使用已保存的子流程快照。先取消发布，再更新草稿中的快照。"
              : "保存草稿时同步私有子流程。发布与运行使用已保存快照；内容变化时按当前规则重新审核。"}
          </p>
        </div>
        {canEdit && !published && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 max-w-full whitespace-normal"
            disabled={busy || saving || Boolean(error)}
            onClick={() => void save()}
          >
            {saving && (
              <Loader2
                size={14}
                className="mr-2 animate-spin"
                aria-hidden="true"
              />
            )}
            {saving ? "正在更新并保存…" : "更新子流程快照并保存"}
          </Button>
        )}
      </div>
      {missing > 0 && (
        <p role="status" className="text-aiflow-warning">
          {missing} 个引用尚未保存快照；请保存草稿后再审核发布。
        </p>
      )}
      <details className="min-w-0 rounded-lg bg-muted/50 p-2">
        <summary className="aiflow-type-control cursor-pointer rounded px-1 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          查看本页快照信息
        </summary>
        <ul className="mt-2 grid min-w-0 gap-2">
          {snapshots.map(item => (
            <li
              key={item.id}
              className="min-w-0 break-words rounded-lg border border-border bg-card p-3"
            >
              <p className="font-medium">
                {item.name} · {item.childName}
              </p>
              <p className="aiflow-type-meta mt-1 text-muted-foreground">
                {item.saved
                  ? `${item.count} 个节点 · ${item.stamp}`
                  : "保存时从流程所有者的私有库捕获定义"}
              </p>
            </li>
          ))}
        </ul>
      </details>
      {error && (
        <div
          role="alert"
          className="grid min-w-0 gap-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3"
        >
          <p className="break-words">
            {error} 当前填写已保留；请先核对已保存版本，再继续更新。
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-fit max-w-full whitespace-normal"
            onClick={onResolve}
          >
            核对保存结果并保留修改
          </Button>
        </div>
      )}
    </section>
  );
}
