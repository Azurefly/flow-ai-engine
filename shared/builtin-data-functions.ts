export const builtinDataFunctions = [
  { value: "builtin:trim", label: "去除首尾空格" },
  { value: "builtin:lower", label: "转为小写" },
  { value: "builtin:upper", label: "转为大写" },
  { value: "builtin:mask-phone", label: "手机号脱敏（保留前3后4位）" },
] as const;
