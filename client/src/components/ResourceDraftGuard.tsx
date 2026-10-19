import React, { type ReactNode } from "react";
import { useResourceDraftSummary } from "./ResourceDraftSession";

export function ResourceDraftGuard({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { count } = useResourceDraftSummary(projectId);
  return (
    <>
      {count > 0 && (
        <p
          role="status"
          data-resource-draft-summary=""
          className="aiflow-type-body mb-4 rounded-lg border border-aiflow-info-border bg-accent px-4 py-3 text-foreground"
        >
          有 {count}{" "}
          类资源尚未保存。切换资源类别会保留填写；离开当前业务前需要确认。
        </p>
      )}
      {children}
    </>
  );
}
