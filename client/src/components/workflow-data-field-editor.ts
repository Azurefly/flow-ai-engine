type Profile = {
  label: string;
  initial: Record<string, unknown>;
  fields: Array<{
    key: string;
    label: string;
    kind?: "select";
    options?: Array<{ value: string; label: string }>;
  }>;
};
export const DATA_FIELD_EDITOR_PROFILES: Record<string, Profile> = {
  data_project: {
    label: "投影字段",
    initial: { source: "", target: "" },
    fields: [
      { key: "source", label: "输入字段" },
      { key: "target", label: "输出字段" },
    ],
  },
  data_derive: {
    label: "派生字段",
    initial: { name: "", expression: "" },
    fields: [
      { key: "name", label: "新字段名称" },
      { key: "expression", label: "表达式或固定值" },
    ],
  },
  data_sort: {
    label: "排序字段",
    initial: { field: "", direction: "asc" },
    fields: [
      { key: "field", label: "字段名称" },
      {
        key: "direction",
        label: "排序方向",
        kind: "select",
        options: [
          { value: "asc", label: "升序" },
          { value: "desc", label: "降序" },
        ],
      },
    ],
  },
};
export function dataFieldEditorKey(
  nodeKind: string | undefined,
  fieldKey: string
) {
  const key = `data_${nodeKind}`;
  return fieldKey === "fields" && DATA_FIELD_EDITOR_PROFILES[key]
    ? key
    : fieldKey;
}
export function newDataFieldItem(key: string) {
  const profile = DATA_FIELD_EDITOR_PROFILES[key];
  return profile ? { ...profile.initial } : undefined;
}
