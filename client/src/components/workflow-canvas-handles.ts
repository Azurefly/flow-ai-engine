import {
  readConditionHandles,
  readOperateOutcomeMode,
  readOperateOutcomes,
  type FlowNodeType,
  type NodeConfig,
} from "@shared/workflow-node-contract";
import { normalizeReferenceRouterConfig } from "@shared/reference-router-config";

/** Render persisted legacy outlets without rewriting their routing semantics. */
export function readCanvasSourceHandles(
  kind: FlowNodeType,
  config: NodeConfig,
  connectedHandles: Array<string | null | undefined> = []
) {
  if (kind === "end") return [];
  if (kind === "condition")
    return Array.from(new Set(readConditionHandles(config)));
  if (kind === "router") {
    return Array.from(
      new Set(
        [
          String(config.defaultRoute ?? "default").trim() || "default",
          ...normalizeReferenceRouterConfig(config).rules.map(
            rule => rule.handle
          ),
        ].filter(Boolean)
      )
    );
  }
  if (kind === "operate") {
    if (readOperateOutcomeMode(config) === "explicit")
      return readOperateOutcomes(config).map(outcome => outcome.sourceHandle);
    const existing = Array.from(
      new Set(connectedHandles.map(handle => handle?.trim() || "default"))
    );
    return existing.length ? existing : ["default"];
  }
  if (kind === "llm") {
    const failure = String(config.failureHandle ?? "").trim();
    return failure ? ["default", failure] : ["default"];
  }
  if (
    ["http", "rest", "method"].includes(kind) &&
    config.writeSafety === "compensated"
  )
    return ["default", "compensation"];
  return ["default"];
}
