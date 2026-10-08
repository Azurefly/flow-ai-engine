export type SubflowFlowType = "state" | "control";

/** Older private subflows were validated as state flows. */
export function readSubflowFlowType(definition: unknown): SubflowFlowType {
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  )
    return "state";
  const settings = (definition as { settings?: unknown }).settings;
  return settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>).subflowFlowType === "control"
    ? "control"
    : "state";
}

export function withSubflowFlowType<
  T extends { settings: Record<string, unknown> },
>(definition: T, flowType: SubflowFlowType): T {
  return {
    ...definition,
    settings: { ...definition.settings, subflowFlowType: flowType },
  };
}
