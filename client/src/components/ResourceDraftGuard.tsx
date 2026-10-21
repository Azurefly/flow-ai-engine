import React, { type ReactNode } from "react";
import { useResourceDraftSummary } from "./ResourceDraftSession";

export function ResourceDraftGuard({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { count, uncertain, authorization } =
    useResourceDraftSummary(projectId);
  return (
    <>
      {count > 0 && (
        <p
          role="status"
          data-resource-draft-summary=""
          className="aiflow-type-body mb-4 rounded-lg border border-aiflow-info-border bg-accent px-4 py-3 text-foreground"
        >
          有 {count}{" "}
          {uncertain
            ? "类资源需要保存或核对结果。请重新打开对应表单确认；离开不会撤销可能已完成的创建。"
            : authorization
              ? "类填写尚未保存。离开当前业务前需要确认；放弃填写不会撤销已提交的授权。"
              : "类资源尚未保存。切换资源类别会保留填写；离开当前业务前需要确认。"}
        </p>
      )}
      {children}
    </>
  );
}
