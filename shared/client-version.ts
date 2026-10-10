export function isProductionClientEntry(
  value: string | null | undefined
): value is string {
  return Boolean(value && /^\/assets\/index-[\w-]+\.js$/.test(value));
}

export function readClientEntry(html: string): string | null {
  const tags = /<script\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    if (!/\stype\s*=\s*["']module["']/i.test(match[0])) continue;
    const source = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (isProductionClientEntry(source)) return source;
  }
  return null;
}

export function hasClientVersionChanged(
  current: string | null,
  latest: string | null
) {
  return (
    isProductionClientEntry(current) &&
    isProductionClientEntry(latest) &&
    current !== latest
  );
}
