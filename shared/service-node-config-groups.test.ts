import { expect, it } from "vitest";
import { FLOW_NODE_DEFINITIONS } from "./workflow-node-contract";
import { SERVICE_NODE_CONFIG_GROUPS } from "./service-node-config-groups";

it.each(["rest", "method"] as const)(
  "%s 分组完整覆盖配置契约，无重复或遗漏的可编辑字段",
  kind => {
    const grouped = SERVICE_NODE_CONFIG_GROUPS.flatMap(group => group.keys);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(
      FLOW_NODE_DEFINITIONS[kind].fields.map(field => field.key).sort()
    );
    expect(SERVICE_NODE_CONFIG_GROUPS[0].keys).toContain("endpointRef");
    expect(
      SERVICE_NODE_CONFIG_GROUPS.find(group => group.label === "节点标识")?.keys
    ).toContain("restmc");
  }
);
