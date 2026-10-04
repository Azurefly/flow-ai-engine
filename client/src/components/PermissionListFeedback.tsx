import * as React from "react";
import { Button } from "@/components/ui/button";
export function PermissionListFeedback({
  name,
  loading,
  error,
  onRetry,
}: {
  name: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (error)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 bg-aiflow-danger-surface px-4 py-3 text-sm text-aiflow-danger"
      >
        <span>{name}读取失败，已显示的内容可能不是最新状态。</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          重试读取{name}
        </Button>
      </div>
    );
  if (loading)
    return (
      <p
        role="status"
        className="aiflow-type-body px-4 py-3 text-muted-foreground"
      >
        正在读取{name}…
      </p>
    );
  return null;
}
