/** The editor writes the existing interpolation contract; it never evaluates code. */
export type ValuePart =
  | { kind: "text"; value: string }
  | { kind: "reference"; path: string; raw: string };
export type ValueSource = {
  key: string;
  label: string;
  fields: Array<{ value: string; label: string }>;
  hint?: string;
};

export function readValueParts(value: unknown): ValuePart[] {
  if (typeof value !== "string") return [];
  // Exact references preserve the runtime's whitespace and value-type semantics.
  const exact = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (exact) return [{ kind: "reference", path: exact[1].trim(), raw: value }];
  const parts: ValuePart[] = [];
  let offset = 0;
  for (const match of Array.from(value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))) {
    if (match.index! > offset)
      parts.push({ kind: "text", value: value.slice(offset, match.index) });
    parts.push({ kind: "reference", path: match[1].trim(), raw: match[0] });
    offset = match.index! + match[0].length;
  }
  if (offset < value.length || !parts.length)
    parts.push({ kind: "text", value: value.slice(offset) });
  return parts;
}

export function writeValueParts(parts: ValuePart[]) {
  return parts
    .map(part => (part.kind === "text" ? part.value : part.raw))
    .join("");
}

export function referenceLocation(path: string, sources: ValueSource[]) {
  const normalized = path.replace(/^\$\.?/, "");
  const source = [...sources]
    .sort((a, b) => b.key.length - a.key.length)
    .find(item =>
      item.key
        ? normalized === item.key || normalized.startsWith(item.key + ".")
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
    );
  return source
    ? { source, field: normalized.slice(source.key.length).replace(/^\./, "") }
    : null;
}

export function makeValueReference(
  source: string,
  field: string
): ValuePart | null {
  const path = [source, field.trim()].filter(Boolean).join(".");
  if (
    !path ||
    path
      .split(".")
      .some(
        part =>
          !part ||
          /[{}\s]/.test(part) ||
          ["__proto__", "prototype", "constructor"].includes(part)
      )
  )
    return null;
  return { kind: "reference", path, raw: `{{${path}}}` };
}

type Node = {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
};
function objectPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 3) return [];
  return Object.entries(value)
    .flatMap(([key, child]) => {
      if (
        !key ||
        /[.{}\s]/.test(key) ||
        ["__proto__", "prototype", "constructor"].includes(key)
      )
        return [];
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...objectPaths(child, path, depth + 1)];
    })
    .slice(0, 100);
}

/** Only graph ancestors are offered; an unconnected or future node is never guessed. */
export function nodeValueSources(
  nodeId: string,
  nodes: Node[],
  edges: { source: string; target: string }[],
  flowType: string,
  inputFields: string[] = []
): ValueSource[] {
  const ancestors = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges.filter(edge => edge.target === current)) {
      if (edge.source !== nodeId && !ancestors.has(edge.source)) {
        ancestors.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  const upstream = nodes.filter(node => ancestors.has(node.id));
  const options = (fields: string[]) =>
    Array.from(new Set(fields))
      .slice(0, 100)
      .map(value => ({ value, label: value }));
  const variables = upstream.flatMap(node =>
    node.type === "start" ? objectPaths(node.config.initialVariables) : []
  );
  const formFields = Array.from(
    new Map(
      upstream
        .flatMap(node =>
          node.type === "form" && Array.isArray(node.config.fields)
            ? node.config.fields.flatMap(field =>
                field && typeof field.key === "string"
                  ? [
                      {
                        value: field.key,
                        label: String(field.label || field.key),
                      },
                    ]
                  : []
              )
            : []
        )
        .map(field => [field.value, field])
    ).values()
  );
  const sources: ValueSource[] = [
    {
      key: "input",
      label: flowType === "data" ? "当前行数据" : "流程启动输入",
      fields: flowType === "data" ? options(inputFields) : formFields,
      hint:
        flowType === "data"
          ? "每行处理时读取当前记录的字段。"
          : "流程启动时提供的数据。未列出的字段可按实际名称填写。",
    },
    {
      key: "vars",
      label: "流程变量",
      fields: options(variables),
      hint: "由开始节点初始化或运行过程中写入的变量。",
    },
    {
      key: "result",
      label: "上一步结果",
      fields: [],
      hint: "读取运行时上一步的输出；并行流程建议明确选择上游节点。",
    },
  ];
  if (flowType === "data")
    sources.push({
      key: "row",
      label: "当前行数据（已有引用）",
      fields: options(inputFields),
    });
  for (const node of upstream) {
    let fields: ValueSource["fields"] = [];
    if (["rest", "method", "http"].includes(node.type))
      fields = [
        { value: "status", label: "响应状态码" },
        { value: "body", label: "响应内容" },
        { value: "headers", label: "响应头" },
      ];
    if (node.type === "transform")
      fields = options(objectPaths(node.config.mappings));
    if (node.type === "start")
      fields = options(objectPaths(node.config.initialVariables));
    if (node.type === "llm")
      fields = [
        { value: "content", label: "模型回答" },
        { value: "structured", label: "结构化结果" },
      ];
    if (node.type === "subflow")
      fields = [{ value: "result", label: "子流程结果" }];
    if (node.type === "form")
      fields = [
        { value: "submitted", label: "已提交表单" },
        ...(Array.isArray(node.config.fields)
          ? node.config.fields.flatMap(field =>
              field && typeof field.key === "string"
                ? [
                    {
                      value: "submitted." + field.key,
                      label: String(field.label || field.key),
                    },
                  ]
                : []
            )
          : []),
      ];
    if (flowType === "data")
      fields = [
        { value: "rows", label: "全部数据记录" },
        { value: "rows.0", label: "第一条记录" },
      ];
    sources.push({
      key: `nodes.${node.id}`,
      label: `节点：${node.name}`,
      fields,
      hint: "只列出已连接的上游节点。具体字段以该节点的运行结果为准。",
    });
  }
  return flowType === "data"
    ? sources.filter(source => !["vars", "result"].includes(source.key))
    : sources;
}

export function usesNodeValueReferences(kind: string | undefined, key: string) {
  const fields: Record<string, string[]> = {
    start: ["initialVariables"],
    end: ["resultTemplate"],
    milestone: ["details"],
    rest: ["restApi", "restHeaderParam", "restGetBodyParam", "restJsonParam"],
    method: ["restApi", "restHeaderParam", "restGetBodyParam", "restJsonParam"],
    http: ["url", "headers", "body", "query"],
    transform: ["mappings"],
    condition: ["left", "right"],
    llm: ["systemPrompt", "prompt"],
    subflow: ["input"],
    message_catch: ["correlationKey"],
  };
  return Boolean(kind && fields[kind]?.includes(key));
}
