import React from "react";
import { getFlowProfile } from "@shared/flow-profile-contract";
import type { FlowType } from "@shared/workflow-node-contract";

/** 类型采用运行记录或任务接口的实际值，缺失时明确展示。 */
export function FlowTypeBadge({ type }: { type?: string | null }) {
  const label = getFlowProfile(type as FlowType)?.label ?? "未标注类型";
  return <span data-flow-type={type ?? "unknown"} className="flow-type-badge">{label}</span>;
}
