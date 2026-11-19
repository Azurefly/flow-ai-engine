export const resourceRequestKeyPattern = /^[A-Za-z0-9_-]{16,96}$/;

/** Match JSON persistence, with stable object-key order and meaningful array order. */
export function canonicalResourcePayload(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") {
      const result: Record<string, unknown> = Object.create(null);
      Object.keys(item)
        .sort()
        .forEach(key => {
          result[key] = sort((item as Record<string, unknown>)[key]);
        });
      return result;
    }
    return item;
  };
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value ?? null))));
}

export function newResourceRequestKey() {
  return Array.from(
    globalThis.crypto.getRandomValues(new Uint8Array(24)),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

export function newOperationUuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
