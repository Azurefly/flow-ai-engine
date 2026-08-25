import type { FlowNodeType, NodeConfig } from "./workflow-node-contract";

export type HttpServiceTaskPlan = {
  kind: "http";
  sourceType: "http" | "rest" | "method";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  urlTemplate: string;
  headersTemplate: Record<string, unknown> | unknown[];
  queryTemplate: Record<string, unknown> | unknown[];
  bodyTemplate?: unknown;
  timeoutMs: number;
  effect: "read" | "write";
  idempotency: "none" | "workflow_node_key";
  retryClass: "safe_read" | "idempotent_write";
};

function firstString(...values: unknown[]) {
  return values.find(value => typeof value === "string" && value.trim()) as
    | string
    | undefined;
}

function parseBody(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return value || undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Compiles all HTTP-shaped canvas nodes into one immutable service-task contract. */
export function compileHttpServiceTask(
  nodeType: FlowNodeType,
  config: NodeConfig
): HttpServiceTaskPlan | null {
  if (!(["http", "rest", "method"] as FlowNodeType[]).includes(nodeType))
    return null;
  const sourceType = nodeType as HttpServiceTaskPlan["sourceType"];
  const reference = nodeType === "rest" || nodeType === "method";
  const method = String(
    reference
      ? firstString(config.restType, config.method) ?? "GET"
      : config.method ?? "GET"
  ).toUpperCase() as HttpServiceTaskPlan["method"];
  if (!(["GET", "POST", "PUT", "PATCH", "DELETE"] as string[]).includes(method))
    throw new Error("ServiceTask 请求方法不受支持。");
  const configuredTimeout = Number(config.timeout ?? 15000);
  const timeoutMs = Math.min(
    Math.max(Number.isFinite(configuredTimeout) ? Math.trunc(configuredTimeout) : 15000, 1000),
    15000
  );
  const effect = method === "GET" ? "read" : "write";
  const attributes =
    config.restAttributeMap && typeof config.restAttributeMap === "object"
      ? (config.restAttributeMap as Record<string, unknown>)
      : {};
  return {
    kind: "http",
    sourceType,
    method,
    urlTemplate: String(
      reference
        ? firstString(config.restApi, config.endpoint, config.url) ?? ""
        : firstString(config.url, config.endpoint) ?? ""
    ),
    headersTemplate: (reference
      ? config.restHeaderParam ?? config.headers
      : config.headers) as Record<string, unknown> | unknown[] ?? {},
    queryTemplate: (reference
      ? config.restGetBodyParam ?? attributes.restEntryParam
      : config.query) as Record<string, unknown> | unknown[] ?? {},
    bodyTemplate: parseBody(
      reference
        ? config.restJsonParam === undefined || config.restJsonParam === ""
          ? config.body
          : config.restJsonParam
        : config.body
    ),
    timeoutMs,
    effect,
    idempotency: effect === "write" ? "workflow_node_key" : "none",
    retryClass: effect === "write" ? "idempotent_write" : "safe_read",
  };
}
