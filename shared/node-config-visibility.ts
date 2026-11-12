import type { NodeConfig, NodeField } from "./workflow-node-contract";

/** Persistence retains imported keys; only controls with a current purpose are exposed. */
export function visibleNodeConfigFields(
  kind: string,
  fields: NodeField[],
  config: NodeConfig,
  inProject = false,
  flowType = "control"
) {
  return fields.filter(field => {
    if (flowType === "data" && ["start", "end"].includes(kind)) return false;
    if (kind === "sink" && field.key === "idempotencyKey") return false;
    if (
      ["rest", "method"].includes(kind) &&
      ["restAttributeMap", "restScriptCode"].includes(field.key)
    )
      return false;
    if (
      ["rest", "method", "http"].includes(kind) &&
      inProject &&
      field.key === "secretRef"
    )
      return false;
    if (kind === "router" && field.key === "lysz")
      return (
        Array.isArray(config.lysz) &&
        config.lysz.length > 0 &&
        !(Array.isArray(config.routes) && config.routes.length)
      );
    return true;
  });
}

export function hasRetiredHttpValidation(config: NodeConfig) {
  const attributes = config.restAttributeMap as NodeConfig | undefined;
  const meaningful = (value: unknown): boolean => {
    if (typeof value === "string")
      return (
        Boolean(value.trim()) &&
        !["否", "以本人身份", "赋予"].includes(value.trim())
      );
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (value && typeof value === "object")
      return Object.values(value).some(meaningful);
    return false;
  };
  return (
    meaningful(config.restScriptCode) ||
    attributes?.valid === true ||
    attributes?.valid === "true"
  );
}

export function removeRetiredHttpValidation(config: NodeConfig): NodeConfig {
  const attributes =
    config.restAttributeMap &&
    typeof config.restAttributeMap === "object" &&
    !Array.isArray(config.restAttributeMap)
      ? (config.restAttributeMap as NodeConfig)
      : {};
  return {
    ...config,
    restScriptCode: "",
    restAttributeMap: { ...attributes, valid: false },
  };
}
