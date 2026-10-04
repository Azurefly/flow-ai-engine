export function readDeduplicateKeys(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.keys) || !config.keys.length)
    throw new Error("去重节点必须配置业务键。");
  if (config.keys.some(key => typeof key !== "string" || !key.trim()))
    throw new Error("去重业务键必须是非空字段名。");
  const keys = config.keys.map(key => key.trim());
  if (new Set(keys).size !== keys.length)
    throw new Error("去重业务键不能重复。");
  return keys;
}
