import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

export function DurableSubflowPicker({
  workflowId,
  config,
  disabled,
  onChange,
}: {
  workflowId?: string;
  config: Record<string, unknown>;
  disabled: boolean;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const query = trpc.workflow.callableTargets.useQuery(
    { parentId: workflowId, search, cursor },
    { enabled: !disabled }
  );
  const selectedId = String(config.subflowId ?? "");
  const version = Number(config.childVersion || 0);
  const current = (query.data?.items ?? []).find(
    item => item.id === selectedId
  );
  const selectClass =
    "h-10 w-full rounded border border-border bg-background px-2 text-sm";
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <legend className="font-medium">调用已发布流程</legend>
      <label className="grid gap-1 text-sm">
        搜索流程名称或编号
        <Input
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setCursor(0);
          }}
        />
      </label>
      <label className="grid gap-1 text-sm">
        目标流程和发布版本
        <select
          className={selectClass}
          value={selectedId ? selectedId + "@" + version : ""}
          onChange={event => {
            const item = query.data?.items.find(
              target => target.id + "@" + target.version === event.target.value
            );
            onChange({
              subflowId: item?.id ?? "",
              childVersion: item?.version,
              childPlanHash: undefined,
            });
          }}
        >
          <option value="">选择有查看及运行权限的流程</option>
          {selectedId && (!current || current.version !== version) && (
            <option value={selectedId + "@" + version}>
              {selectedId} · 已固定 v{version}
            </option>
          )}
          {query.data?.items.map(item => (
            <option key={item.id} value={item.id + "@" + item.version}>
              {item.name} · v{item.version}
            </option>
          ))}
        </select>
      </label>
      {query.error && (
        <p role="alert">
          {query.error.message}{" "}
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            重试
          </Button>
        </p>
      )}
      {(cursor > 0 || query.data?.nextCursor != null) && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!cursor}
            onClick={() => setCursor(Math.max(0, cursor - 20))}
          >
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={query.data?.nextCursor == null}
            onClick={() => setCursor(query.data?.nextCursor ?? cursor)}
          >
            下一页
          </Button>
        </div>
      )}
      <label className="grid gap-1 text-sm">
        子流程失败时
        <select
          className={selectClass}
          value={String(config.failurePolicy ?? "fail_parent")}
          onChange={e => onChange({ failurePolicy: e.target.value })}
        >
          <option value="fail_parent">结束父流程并记录失败</option>
          <option value="return_result">返回失败状态并继续</option>
          <option value="retry_once">用固定版本重试一次</option>
          <option value="manual">等待人工决定</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        父流程结束时
        <select
          className={selectClass}
          value={String(config.cancelPolicy ?? "propagate")}
          onChange={e => onChange({ cancelPolicy: e.target.value })}
        >
          <option value="propagate">取消仍在执行的子实例</option>
          <option value="detach">让子实例独立完成</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        返回字段路径（留空返回子流程完整结果）
        <Input
          value={String(config.childResultPath ?? "")}
          onChange={e => onChange({ childResultPath: e.target.value })}
          placeholder="例如 order.id"
        />
      </label>
    </fieldset>
  );
}
