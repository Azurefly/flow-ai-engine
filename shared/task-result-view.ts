type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

function displayValue(value: unknown, field: RecordValue = {}): string {
  if (value === undefined || value === null || value === "") return "未填写";
  if (Array.isArray(value) && !value.length) return "未选择";
  const options = Array.isArray(field.options) ? field.options : [];
  const displayOption = (item: unknown) => {
    const match = options.find(
      option =>
        JSON.stringify(
          Object.prototype.hasOwnProperty.call(record(option), "value")
            ? record(option).value
            : option
        ) === JSON.stringify(item)
    );
    const label = record(match).label;
    return typeof label === "string"
      ? label
      : typeof item === "object"
        ? JSON.stringify(item, null, 2)
        : String(item);
  };
  if (String(field.type).toLowerCase() === "select")
    return displayOption(value);
  if (Array.isArray(value)) return value.map(displayOption).join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  return typeof value === "object"
    ? JSON.stringify(value, null, 2)
    : String(value);
}

export function taskResultView(configValue: unknown, resultValue: unknown) {
  const config = record(configValue);
  const result = record(resultValue);
  const schema = record(config.formSchema);
  const fields = Array.isArray(schema.fields)
    ? schema.fields
        .map(record)
        .filter(field => typeof field.key === "string" && field.key.trim())
    : [];
  const declared = new Set<string>();
  const rows = fields.flatMap(field => {
    const key = String(field.key).trim();
    if (declared.has(key) || ["decision", "outcome", "comment"].includes(key))
      return [];
    declared.add(key);
    return [
      {
        key,
        label: String(field.label ?? "").trim() || key,
        value: displayValue(result[key], field),
      },
    ];
  });
  for (const [key, value] of Object.entries(result)) {
    if (declared.has(key) || ["decision", "outcome", "comment"].includes(key))
      continue;
    rows.push({ key, label: key, value: displayValue(value) });
  }
  const code = String(result.outcome ?? result.decision ?? "").trim();
  const outcomes = Array.isArray(config.outcomes)
    ? config.outcomes.map(record)
    : [];
  const outcome = outcomes.find(
    item => String(item.code ?? "").trim() === code
  );
  return {
    outcome: String(
      outcome?.label ??
        (
          { approved: "同意", rejected: "拒绝", abstained: "弃权" } as Record<
            string,
            string
          >
        )[code] ??
        code
    ),
    comment:
      result.comment === undefined || result.comment === null
        ? ""
        : String(result.comment),
    rows,
  };
}
