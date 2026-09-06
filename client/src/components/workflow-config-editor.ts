import type { NodeConfig } from "@shared/workflow-node-contract";

export function isConfigRecord(value: unknown): value is NodeConfig {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// canvas_operate.js saves boolean entries and imports label-valued entries.
// Neither shape is a flat object of Chinese yes/no strings.
export const STATE_INNATE_OPERATIONS = [
  { value: "bj", label: "办结" },
  { value: "zdbj", label: "自动办结" },
  { value: "tsbjsyzlc", label: "同时办结所有子流程" },
  { value: "cs", label: "抄送" },
] as const;

export type StateInnateOperation = (typeof STATE_INNATE_OPERATIONS)[number]["value"];

export function hasStateInnateOperation(
  entries: unknown[],
  key: StateInnateOperation
) {
  return entries.some(entry => isConfigRecord(entry) && Boolean(entry[key]));
}

/** Only edit the requested flag; retain imported labels and opaque entries. */
export function toggleStateInnateOperation(
  entries: unknown[],
  key: StateInnateOperation,
  enabled: boolean
): unknown[] {
  if (enabled && hasStateInnateOperation(entries, key)) return entries;
  let found = false;
  const next = entries.flatMap(entry => {
    if (!isConfigRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, key))
      return [entry];
    found = true;
    if (enabled) return [{ ...entry, [key]: true }];
    const remaining = { ...entry };
    delete remaining[key];
    return Object.keys(remaining).length ? [remaining] : [];
  });
  return enabled && !found ? [...next, { [key]: true }] : next;
}

/** Do not stringify or deduplicate unrecognized selection entries. */
export function toggleConfigSelection(
  entries: unknown[],
  value: string,
  enabled: boolean
): unknown[] {
  if (!enabled) return entries.filter(entry => entry !== value);
  return entries.includes(value) ? entries : [...entries, value];
}

/** Invalid/duplicate names must not silently delete another property. */
export function renameConfigProperty(
  record: NodeConfig,
  previousKey: string,
  nextKey: string
): NodeConfig {
  if (
    !nextKey.trim() ||
    nextKey === previousKey ||
    Object.prototype.hasOwnProperty.call(record, nextKey)
  )
    return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === previousKey ? nextKey : key,
      value,
    ])
  );
}

export function subflowSelectionConfig(
  current: unknown,
  selected?: { id: string; name: string }
): NodeConfig {
  return {
    ...(isConfigRecord(current) ? current : {}),
    id: selected?.id ?? "",
    text: selected?.name ?? "",
  };
}

export function showSigningPercent(mode: unknown) {
  // Keep the current runtime's Chinese alias; sequential signing needs everyone.
  return mode === "andSignFor" || mode === "会签";
}
