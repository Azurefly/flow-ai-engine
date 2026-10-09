export function readRolePermissionCodes(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.filter((code): code is string => typeof code === "string" && Boolean(code.trim()))))
      : [];
  } catch { return []; }
}
