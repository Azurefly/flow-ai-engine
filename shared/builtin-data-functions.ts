export const builtinDataFunctions = [
  { value: "builtin:trim", label: "去除首尾空格" },
  { value: "builtin:lower", label: "转为小写" },
  { value: "builtin:upper", label: "转为大写" },
  { value: "builtin:mask-phone", label: "手机号脱敏（保留前3后4位）" },
] as const;

export function builtinDataFunctionChoice(udf: {
  id: string;
  name: string;
  udfType: string;
  artifactRef?: unknown;
}) {
  const implementation =
    udf.udfType === "javascript"
      ? builtinDataFunctions.find(item => item.value === udf.artifactRef)
      : undefined;
  return {
    value: udf.id,
    label: `${udf.name} · ${implementation?.label ?? "尚不可执行"}（${udf.id.slice(0, 8)}）`,
    disabled: !implementation,
  };
}

export function dataFunctionTypeLabel(udfType: string, artifactRef?: unknown) {
  if (
    udfType === "javascript" &&
    builtinDataFunctions.some(item => item.value === artifactRef)
  )
    return "内置文本处理";
  const labels: Record<string, string> = {
    javascript: "JavaScript",
    sql: "SQL",
    python: "Python",
    jar: "JAR",
  };
  return `${labels[udfType] ?? udfType}（仅登记）`;
}
