import { runInputRowsFromValue, type RunInputRow } from "./run-input-editor";

/** Input and start.initialVariables (vars) are separate namespaces. Never copy vars into input. */
export function workflowInputSuggestions(definition: unknown): RunInputRow[] {
  const values: Record<string, unknown> = Object.create(null);
  const walk = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of Array.from(
        value.matchAll(
          /\{\{\s*input\.([A-Za-z0-9_:-]+(?:\.[A-Za-z0-9_:-]+)*)\s*\}\}/g
        )
      )) {
        const parts = match[1].split(".");
        if (
          parts.some(p => ["__proto__", "constructor", "prototype"].includes(p))
        )
          continue;
        let cursor = values;
        parts.forEach((part, index) => {
          if (index === parts.length - 1) {
            if (!(part in cursor)) cursor[part] = "";
          } else {
            if (!cursor[part] || typeof cursor[part] !== "object")
              cursor[part] = Object.create(null);
            cursor = cursor[part] as Record<string, unknown>;
          }
        });
      }
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  if (
    definition &&
    typeof definition === "object" &&
    "nodes" in definition &&
    Array.isArray(definition.nodes)
  )
    definition.nodes.forEach(node => walk(node.config));
  return runInputRowsFromValue(values);
}

export function appendMissingWorkflowInputs(
  rows: RunInputRow[],
  suggestions: RunInputRow[]
) {
  const existing = new Set(rows.map(row => row.key.trim()).filter(Boolean));
  return [...rows, ...suggestions.filter(row => !existing.has(row.key))];
}
