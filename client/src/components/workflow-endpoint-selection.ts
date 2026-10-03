import type { NodeConfig } from "@shared/workflow-node-contract";

type EndpointChoice = {
  refCode: string;
  status: string;
  secretRef: string | null;
};

/** The catalog controls credentials; choosing a destination preserves the request. */
export function selectWorkflowEndpoint(
  config: NodeConfig,
  refCode: string,
  endpoints: EndpointChoice[]
): NodeConfig {
  if (!refCode) return { ...config, endpointRef: "", secretRef: "" };
  const endpoint = endpoints.find(
    item => item.refCode === refCode && item.status === "active"
  );
  if (!endpoint)
    throw new Error("所选服务端点已停用或不属于当前业务，请刷新后重新选择。");
  return {
    ...config,
    endpointRef: endpoint.refCode,
    secretRef: endpoint.secretRef ?? "",
  };
}
