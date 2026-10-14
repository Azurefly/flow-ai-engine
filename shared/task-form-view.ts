export interface TaskFormViewField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string;
  readOnly: boolean;
  options: unknown[];
}

/** Keep designer trial inputs and actual task inputs on the same display contract. */
export function taskFormViewFields(schema: unknown): TaskFormViewField[] {
  const fields =
    schema && typeof schema === "object"
      ? (schema as { fields?: unknown }).fields
      : undefined;
  if (!Array.isArray(fields)) return [];
  return fields
    .filter(item => item && typeof item === "object" && !Array.isArray(item))
    .map(item => {
      const field = item as Record<string, unknown>;
      const key = String(field.key ?? "").trim();
      const type = String(field.type ?? "text").toLowerCase();
      return {
        key,
        label: String(field.label ?? "").trim() || key,
        type,
        required: field.required === true,
        readOnly: field.readOnly === true,
        options: Array.isArray(field.options) ? field.options : [],
        defaultValue: Array.isArray(field.defaultValue)
          ? JSON.stringify(field.defaultValue)
          : String(
              field.defaultValue ??
                (type === "boolean" && field.readOnly !== true ? false : "")
            ),
      };
    })
    .filter(field => field.key && field.label);
}
