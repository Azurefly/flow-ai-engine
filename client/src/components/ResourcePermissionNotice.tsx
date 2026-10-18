import React, { useContext } from "react";
import { ResourceEditContext } from "@/contexts/ResourceEditContext";
import { Button } from "./ui/button";

export function ResourcePermissionNotice() {
  const { canEdit, refreshing, refresh } = useContext(ResourceEditContext);
  if (canEdit) return null;
  return (
    <div
      role="alert"
      className="aiflow-type-body grid gap-2 rounded-lg border border-border bg-muted p-3 text-muted-foreground"
    >
      <p>资源编辑权限暂不可用，填写内容已保留。可刷新确认最新权限。</p>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-fit"
        disabled={refreshing}
        onClick={refresh}
      >
        {refreshing ? "正在刷新…" : "刷新业务权限"}
      </Button>
    </div>
  );
}
