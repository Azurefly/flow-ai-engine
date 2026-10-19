import React, { useContext } from "react";
import { ResourceCatalogContext } from "@/contexts/ResourceCatalogContext";
import { Button } from "./ui/button";

export function ResourceCatalogNotice() {
  const { ready, refreshing, refresh } = useContext(ResourceCatalogContext);
  if (ready) return null;
  return (
    <div
      role={refreshing ? "status" : "alert"}
      data-resource-catalog-notice=""
      className="aiflow-type-body grid gap-2 rounded-lg border border-border bg-muted p-3 text-muted-foreground"
    >
      <p>
        {refreshing
          ? "正在确认资源列表，填写内容已保留。读取完成后可保存。"
          : "资源列表暂不可用，填写内容已保留。请重新读取资源后保存。"}
      </p>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-fit"
        disabled={refreshing}
        onClick={refresh}
      >
        {refreshing ? "正在读取…" : "重新读取资源"}
      </Button>
    </div>
  );
}
