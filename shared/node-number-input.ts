export type NodeNumberConstraints = {
  label: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
};

/** Keep incomplete input as text so draft validation can block saving it. */
export function parseNodeNumberDraft(raw: string): number | string {
  const text = raw.trim();
  if (!text) return "";
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return raw;
  const number = Number(text);
  return Number.isFinite(number) ? number : raw;
}

export function nodeNumberDraftError(
  field: NodeNumberConstraints,
  raw: string
) {
  const value = parseNodeNumberDraft(raw);
  if (value === "") return field.required ? `${field.label}不能为空。` : null;
  if (typeof value !== "number") return `${field.label}须填写有效数值。`;
  if (field.step === 1 && !Number.isInteger(value))
    return `${field.label}须为整数。`;
  if (
    (field.min !== undefined && value < field.min) ||
    (field.max !== undefined && value > field.max)
  )
    return field.min !== undefined && field.max !== undefined
      ? `${field.label}须在 ${field.min} 至 ${field.max} 之间。`
      : field.min !== undefined
        ? `${field.label}不能小于 ${field.min}。`
        : `${field.label}不能大于 ${field.max}。`;
  return null;
}

export function stepNodeNumberDraft(
  raw: string,
  direction: 1 | -1,
  field: NodeNumberConstraints
) {
  const parsed = parseNodeNumberDraft(raw);
  const current = typeof parsed === "number" ? parsed : (field.min ?? 0);
  const step =
    typeof field.step === "number"
      ? field.step
      : field.step === "any" && field.min === 0 && field.max === 1
        ? 0.01
        : 1;
  const decimals = (number: number) => {
    const [coefficient, exponent = "0"] = String(number).split("e");
    return Math.max(
      0,
      (coefficient.split(".")[1] ?? "").length - Number(exponent)
    );
  };
  const places = Math.min(20, Math.max(decimals(step), decimals(current)));
  let next = Number((current + direction * step).toFixed(places));
  if (field.min !== undefined) next = Math.max(field.min, next);
  if (field.max !== undefined) next = Math.min(field.max, next);
  return Number.isFinite(next) ? String(next) : raw;
}
