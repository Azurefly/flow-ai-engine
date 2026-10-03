type JsonRecord = Record<string, unknown>;
export function assertTaskFormSchema(schema: unknown) {
  const record = asRecord(schema);
  if (record.fields === undefined) return;
  if (!Array.isArray(record.fields))
    throw new Error("表单 fields 必须是数组。");
  const keys = new Set<string>();
  for (const raw of record.fields) {
    const field = asRecord(raw);
    const key = typeof field.key === "string" ? field.key.trim() : "";
    if (!key || keys.has(key)) throw new Error("表单代号不能为空或重复。");
    if (
      [
        "decision",
        "outcome",
        "comment",
        "__proto__",
        "constructor",
        "prototype",
      ].includes(key)
    )
      throw new Error(`任务表单字段“${key}”使用了保留代号。`);
    keys.add(key);
    if (
      field.required === true &&
      field.readOnly === true &&
      field.defaultValue === undefined
    )
      throw new Error(`只读必填字段“${key}”需默认值。`);
    const type = String(field.type ?? "text").toLowerCase();
    if (
      ![
        "text",
        "string",
        "textarea",
        "email",
        "date",
        "number",
        "boolean",
        "select",
        "multiselect",
      ].includes(type)
    )
      throw new Error(`字段“${key}”类型无效。`);
    for (const flag of ["required", "readOnly"])
      if (field[flag] !== undefined && typeof field[flag] !== "boolean")
        throw new Error(`任务表单字段“${key}”的 ${flag} 必须是布尔值。`);
    for (const bound of ["min", "max", "maxLength"] as const) {
      const value = field[bound];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`字段“${key}”的 ${bound} 必须是有限数值。`);
      if (bound === "maxLength" && (!Number.isInteger(value) || value < 0))
        throw new Error(`字段“${key}”的最大长度必须是非负整数。`);
    }
    if (
      typeof field.min === "number" &&
      typeof field.max === "number" &&
      field.min > field.max
    )
      throw new Error(`字段“${key}”的最小值不能大于最大值。`);
    if (["select", "multiselect"].includes(type)) {
      if (!Array.isArray(field.options) || !field.options.length)
        throw new Error(`任务表单字段“${key}”必须配置选项。`);
      if (
        field.options.some(
          option =>
            option &&
            typeof option === "object" &&
            !Array.isArray(option) &&
            !Object.prototype.hasOwnProperty.call(option, "value")
        )
      )
        throw new Error(`字段“${key}”的选项缺少 value。`);
      if (
        type === "select" &&
        field.options.some(
          option => typeof (asRecord(option).value ?? option) !== "string"
        )
      )
        throw new Error(`单选字段“${key}”的选项值必须是字符串。`);
      const optionValues = field.options.map(option =>
        Object.prototype.hasOwnProperty.call(asRecord(option), "value")
          ? asRecord(option).value
          : option
      );
      if (
        type === "select" &&
        optionValues.some(value => !String(value).trim())
      )
        throw new Error(`单选字段“${key}”的选项值不能为空。`);
      if (
        new Set(optionValues.map(value => JSON.stringify(value))).size !==
        optionValues.length
      )
        throw new Error(`字段“${key}”的选项值不可重复。`);
    }
    // Defaults must obey the same rules as actual submissions. Editable required
    // fields may omit a default; read-only required fields cannot be repaired by users.
    if (
      field.defaultValue !== undefined ||
      (field.required === true && field.readOnly === true)
    ) {
      try {
        validateFormSubmission(
          [
            {
              ...field,
              required: field.readOnly === true && field.required === true,
            },
          ],
          {}
        );
      } catch (error) {
        throw new Error(
          `字段“${key}”默认值无效：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

export function validateFormSubmission(
  fields: unknown[],
  submittedValue: unknown
) {
  const submitted = asRecord(submittedValue);
  const result: JsonRecord = {};
  const keys = new Set<string>();
  for (const rawField of fields) {
    const field = asRecord(rawField);
    const key = String(field.key ?? "").trim();
    if (!key) throw new Error("表单字段缺少 key。");
    if (keys.has(key)) throw new Error(`表单字段“${key}”重复。`);
    keys.add(key);
    const hasSubmitted = Object.prototype.hasOwnProperty.call(submitted, key);
    let value = hasSubmitted ? submitted[key] : field.defaultValue;
    if (
      field.readOnly === true &&
      hasSubmitted &&
      JSON.stringify(value) !== JSON.stringify(field.defaultValue)
    )
      throw new Error(`表单字段“${key}”为只读，不允许由调用方修改。`);
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0);
    if (field.required === true && empty)
      throw new Error(`表单必填字段“${key}”缺失。`);
    if (empty) continue;
    const type = String(field.type ?? "text").toLowerCase();
    if (
      ["text", "string", "textarea", "email", "date", "select"].includes(
        type
      ) &&
      typeof value !== "string"
    )
      throw new Error(`表单字段“${key}”必须是字符串。`);
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))
      throw new Error(`表单字段“${key}”不是有效邮箱。`);
    if (type === "date" && !isCalendarDate(String(value)))
      throw new Error(`表单字段“${key}”不是有效日期。`);
    if (
      type === "number" &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw new Error(`表单字段“${key}”必须是有限数值。`);
    if (type === "boolean" && typeof value !== "boolean")
      throw new Error(`表单字段“${key}”必须是布尔值。`);
    if (type === "multiselect" && !Array.isArray(value))
      throw new Error(`表单字段“${key}”必须是数组。`);
    const options = Array.isArray(field.options)
      ? field.options.map(option => {
          const record = asRecord(option);
          return Object.keys(record).length ? record.value : option;
        })
      : [];
    if (options.length) {
      const values = type === "multiselect" ? (value as unknown[]) : [value];
      if (
        values.some(
          item =>
            !options.some(
              option => JSON.stringify(option) === JSON.stringify(item)
            )
        )
      )
        throw new Error(`表单字段“${key}”包含选项范围外的值。`);
    }
    if (
      typeof value === "string" &&
      Number.isFinite(Number(field.maxLength)) &&
      value.length > Number(field.maxLength)
    )
      throw new Error(`表单字段“${key}”超过最大长度。`);
    if (
      typeof value === "number" &&
      Number.isFinite(Number(field.min)) &&
      value < Number(field.min)
    )
      throw new Error(`表单字段“${key}”低于最小值。`);
    if (
      typeof value === "number" &&
      Number.isFinite(Number(field.max)) &&
      value > Number(field.max)
    )
      throw new Error(`表单字段“${key}”超过最大值。`);
    result[key] = value;
  }
  return result;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1)
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function taskFormInputValue(type: string, value: string): unknown {
  if (value === "") return "";
  switch (type.toLowerCase()) {
    case "number":
      return Number(value);
    case "boolean":
      return value === "true" ? true : value === "false" ? false : value;
    case "multiselect":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}
