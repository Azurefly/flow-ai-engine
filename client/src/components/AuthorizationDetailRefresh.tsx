import { Button } from "./ui/button";

export function AuthorizationDetailRefresh({
  query,
  label,
  disabled,
  embedded,
  buttonLabel = "刷新权限来源",
}: {
  query: {
    isFetching: boolean;
    dataUpdatedAt: number;
    refetch: () => Promise<unknown>;
  };
  label: string;
  disabled: boolean;
  embedded?: boolean;
  buttonLabel?: string;
}) {
  const updated = query.dataUpdatedAt
    ? new Date(query.dataUpdatedAt).toLocaleTimeString("zh-CN", {
        hour12: false,
      })
    : "尚未更新";
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 ${embedded ? "" : "px-4"}`}
    >
      <p className="aiflow-type-meta text-muted-foreground">
        {disabled
          ? "选择列表中的条目后显示权限来源。"
          : `查看时每 30 秒更新 · 上次更新：${updated}`}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        disabled={disabled || query.isFetching}
        onClick={() => void query.refetch()}
      >
        {query.isFetching ? "正在刷新…" : buttonLabel}
      </Button>
    </div>
  );
}
