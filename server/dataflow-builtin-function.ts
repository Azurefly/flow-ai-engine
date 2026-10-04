import { builtinDataFunctions } from "../shared/builtin-data-functions";
export function executeBuiltinDataFunction(
  rows: Record<string, unknown>[],
  artifactRef: string,
  inputField: string,
  outputField: string
) {
  if (!builtinDataFunctions.some(item => item.value === artifactRef))
    throw new Error("此函数尚无可执行实现，请选择已登记的内置处理函数。");
  for (const field of [inputField, outputField])
    if (
      !field.trim() ||
      ["__proto__", "constructor", "prototype"].includes(field)
    )
      throw new Error("函数必须配置有效的输入与输出字段。");
  return rows.map((row, index) => {
    if (!Object.prototype.hasOwnProperty.call(row, inputField))
      throw new Error(`函数第 ${index + 1} 行缺少输入字段 ${inputField}。`);
    const value = row[inputField];
    if (value !== null && typeof value !== "string")
      throw new Error(`函数输入字段 ${inputField} 必须为文本或 null。`);
    const transformed =
      value === null
        ? null
        : artifactRef === "builtin:trim"
          ? value.trim()
          : artifactRef === "builtin:lower"
            ? value.toLowerCase()
            : artifactRef === "builtin:upper"
              ? value.toUpperCase()
              : /^\d{11}$/.test(value)
                ? `${value.slice(0, 3)}****${value.slice(-4)}`
                : (() => {
                    throw new Error(
                      `函数第 ${index + 1} 行手机号必须为11位数字文本。`
                    );
                  })();
    return { ...row, [outputField]: transformed };
  });
}
