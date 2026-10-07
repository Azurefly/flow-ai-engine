export function resolveMessageCorrelationKey(value: unknown): string {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isSafeInteger(value))
  )
    throw new Error(
      "消息等待相关键模板必须解析为文本或安全整数，请检查业务编号。"
    );
  const key = String(value).trim();
  if (!key || key.length > 255)
    throw new Error("消息等待相关键必须为 1 至 255 个字符，请检查业务编号。");
  return key;
}
