export function roleExpiryInput(
  value: string,
  now = Date.now()
): { expiresAt?: Date; error?: string } {
  if (!value.trim()) return {};
  const hours = Number(value);
  if (!Number.isSafeInteger(hours) || hours < 1)
    return { error: "有效期须填写不小于 1 的整数小时；留空表示长期有效。" };
  const expiresAt = new Date(now + hours * 3_600_000);
  if (!Number.isFinite(expiresAt.getTime()))
    return { error: "有效期超出支持范围，请填写较小的小时数。" };
  return { expiresAt };
}
