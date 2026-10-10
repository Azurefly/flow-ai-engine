export const maxRoleExpiryTime = Date.parse("2038-01-19T03:14:07Z");
export function roleExpiryDateInput(value: string, now = Date.now()): { expiresAt?: Date; error?: string } {
  if (!value.trim()) return {};
  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) return { error: "请选择有效的到期时间。" };
  if (expiresAt.getTime() <= now) return { error: "到期时间必须晚于当前时间；留空表示长期有效。" };
  if (expiresAt.getTime() > maxRoleExpiryTime) return { error: "到期时间超出支持范围，请选择较早的日期。" };
  return { expiresAt };
}
export function assertRoleExpiryRange(expiresAt?: Date | null) {
  if (
    expiresAt &&
    (!Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() > maxRoleExpiryTime)
  )
    throw new Error("有效期过长或日期无效，请缩短授权时间；留空表示长期有效。");
}
export function roleExpiryInput(
  value: string,
  now = Date.now()
): { expiresAt?: Date; error?: string } {
  if (!value.trim()) return {};
  const hours = Number(value);
  if (!Number.isSafeInteger(hours) || hours < 1)
    return { error: "有效期须填写不小于 1 的整数小时；留空表示长期有效。" };
  const expiresAt = new Date(now + hours * 3_600_000);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() > maxRoleExpiryTime
  )
    return { error: "有效期超出支持范围，请填写较小的小时数。" };
  return { expiresAt };
}
