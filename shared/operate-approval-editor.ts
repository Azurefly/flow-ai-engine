import {
  normalizeReferenceOperateConfig,
  type ReferenceSignMode,
} from "./reference-operate-config";
import type { NodeConfig } from "./workflow-node-contract";
const record = (value: unknown): NodeConfig =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as NodeConfig)
    : {};
/** Keep imported server attributes and canvas settings in sync, preserving unrelated bindings. */
export function updateOperateApproval(
  config: NodeConfig,
  change: {
    mode?: ReferenceSignMode;
    userIds?: string[];
    percent?: number | string;
  }
): NodeConfig {
  const current = normalizeReferenceOperateConfig(config);
  const mode = change.mode ?? current.signMode;
  const userIds = change.userIds
    ? Array.from(
        new Set(
          change.userIds
            .map(Number)
            .filter(id => Number.isInteger(id) && id > 0)
        )
      )
    : current.signSelectorUserIds;
  const percent = change.percent ?? Math.round(current.passPercent * 100);
  const attribute = record(config.operateAttributeMap);
  return {
    bdcz: {
      ...record(config.bdcz),
      hqhqsz: mode === "single" ? "" : mode,
      xzdfhq: userIds,
      hqtgbfb: percent,
    },
    operateAttributeMap: {
      ...attribute,
      signForFlag: mode === "single" ? "" : mode,
      orSignForAttribute: {
        ...record(attribute.orSignForAttribute),
        orSignForStaff: userIds,
      },
      andSignForAttribute: {
        ...record(attribute.andSignForAttribute),
        andSignForStaff: userIds,
        passPercent: percent === "" ? "" : Number(percent) / 100,
      },
    },
  };
}
export function orderOperateApprovers(
  candidates: number[],
  selected: number[],
  sequential: boolean
) {
  return sequential && selected.length
    ? selected.filter(id => candidates.includes(id))
    : candidates.filter(id => !selected.length || selected.includes(id));
}
