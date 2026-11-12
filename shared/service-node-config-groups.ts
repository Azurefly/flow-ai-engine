/** REST and method nodes share the same contract and inspector organization. */
export const SERVICE_NODE_CONFIG_GROUPS = [
  {
    label: "请求设置",
    keys: ["endpointRef", "restType", "restApi", "secretRef"],
  },
  {
    label: "请求参数",
    keys: ["restHeaderParam", "restGetBodyParam", "restJsonParam"],
  },
  {
    label: "执行策略",
    keys: [
      "timeout",
      "retryMaxAttempts",
      "retryBaseDelayMs",
      "writeSafety",
      "compensationNodeId",
      "circuitFailureThreshold",
      "circuitResetMs",
      "concurrencyKey",
      "concurrencyLimit",
    ],
  },
  { label: "节点标识", keys: ["nodeDh", "restmc"] },
  { label: "兼容配置", keys: ["restAttributeMap", "restScriptCode"] },
];
