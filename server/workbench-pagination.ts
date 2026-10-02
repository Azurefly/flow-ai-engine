export type WorkbenchPageCursor =
  | { kind: "task"; rank: number; createdAt: string; id: string }
  | { kind: "instance"; createdAt: string; id: string };

export type AuthorizedPage<T> = {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
};

export function encodeWorkbenchPageCursor(cursor: WorkbenchPageCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeWorkbenchPageCursor(
  value: string | undefined,
  kind: WorkbenchPageCursor["kind"]
): WorkbenchPageCursor | undefined {
  if (!value) return undefined;
  if (value.length > 512) throw new Error("列表游标无效，请刷新后重试。");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const validDate =
      typeof parsed.createdAt === "string" &&
      Number.isFinite(Date.parse(parsed.createdAt));
    const validId =
      typeof parsed.id === "string" &&
      parsed.id.length > 0 &&
      parsed.id.length <= 64;
    if (parsed.kind !== kind || !validDate || !validId)
      throw new Error("invalid cursor shape");
    if (kind === "task") {
      if (!Number.isInteger(parsed.rank) || parsed.rank < 0 || parsed.rank > 2)
        throw new Error("invalid task cursor rank");
      return {
        kind,
        rank: parsed.rank,
        createdAt: parsed.createdAt,
        id: parsed.id,
      };
    }
    return { kind, createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error("列表游标无效，请刷新后重试。");
  }
}

export async function collectAuthorizedPage<
  T,
  C extends WorkbenchPageCursor,
>(input: {
  limit: number;
  scanLimit?: number;
  batchSize?: number;
  cursor?: C;
  loadBatch: (after: C | undefined, limit: number) => Promise<T[]>;
  getCursor: (row: T) => C;
  isAuthorized: (row: T) => Promise<boolean>;
}): Promise<AuthorizedPage<T>> {
  const scanLimit = input.scanLimit ?? 5_000;
  const batchSize = input.batchSize ?? 200;
  const authorized: T[] = [];
  let after = input.cursor;
  let lastScanned: C | undefined;
  let scanned = 0;
  let exhausted = false;

  while (authorized.length <= input.limit && scanned < scanLimit) {
    const requestSize = Math.min(batchSize, scanLimit - scanned);
    const rows = await input.loadBatch(after, requestSize);
    if (!rows.length) {
      exhausted = true;
      break;
    }
    for (const row of rows) {
      const rowCursor = input.getCursor(row);
      lastScanned = rowCursor;
      after = rowCursor;
      scanned += 1;
      if (await input.isAuthorized(row)) authorized.push(row);
      if (authorized.length > input.limit) break;
    }
    if (authorized.length > input.limit) break;
    if (rows.length < requestSize) {
      exhausted = true;
      break;
    }
  }

  const hasMore = authorized.length > input.limit || !exhausted;
  const items = authorized.slice(0, input.limit);
  const nextCursor = hasMore
    ? encodeWorkbenchPageCursor(
        authorized.length > input.limit
          ? input.getCursor(items[items.length - 1])
          : lastScanned!
      )
    : null;
  return { items, hasMore, nextCursor };
}
