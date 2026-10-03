import { expect, it } from "vitest";
import { OPERATE_CONFIG_GROUPS } from "../shared/operate-config-groups";
import { FLOW_NODE_DEFINITIONS } from "../shared/workflow-node-contract";

it("配置顺序对应实际人工办理过程", () => {
  expect(OPERATE_CONFIG_GROUPS.map(group => group.label)).toEqual([
    "基本信息",
    "处理人",
    "表单与时限",
    "结果与分支",
    "高级配置",
  ]);
  expect(OPERATE_CONFIG_GROUPS[1].keys).toContain("assigneeMode");
  expect(OPERATE_CONFIG_GROUPS[0].keys).toContain("instruction");
});
it("每个既有操作配置字段都有唯一归属，不丢失兼容配置", () => {
  const keys = OPERATE_CONFIG_GROUPS.flatMap(group => group.keys);
  expect(new Set(keys).size).toBe(keys.length);
  expect(
    FLOW_NODE_DEFINITIONS.operate.fields
      .map(field => field.key)
      .filter(key => !keys.includes(key))
  ).toEqual([]);
  expect(OPERATE_CONFIG_GROUPS[4].keys).toEqual(
    expect.arrayContaining([
      "qxkz",
      "bddx",
      "bdcz",
      "sxsz",
      "fsfsz",
      "jsfsz",
      "zdzx",
    ])
  );
});
