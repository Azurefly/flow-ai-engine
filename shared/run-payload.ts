export interface RunPayloadParts {
  businessInput: unknown;
  flowVariables: unknown;
  nodeResults: unknown;
  nodeConfiguration: unknown;
  runtimeMetadata: unknown;
  additionalBusinessFields: unknown;
  additionalContext: unknown;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function omit(
  record: Record<string, unknown>,
  keys: ReadonlySet<string>
): Record<string, unknown> | null {
  const entries = Object.entries(record).filter(([key]) => !keys.has(key));
  return entries.length ? Object.fromEntries(entries) : null;
}

export function hasRunPayloadValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

export function splitRunPayload(
  value: unknown,
  nodeType?: string
): RunPayloadParts {
  const parsed = parsePayload(value);
  const root = asRecord(parsed);
  if (!root) {
    return {
      businessInput: parsed,
      flowVariables: null,
      nodeResults: null,
      nodeConfiguration: null,
      runtimeMetadata: null,
      additionalBusinessFields: null,
      additionalContext: null,
    };
  }

  const context = asRecord(root.context);
  const hasContext = Object.prototype.hasOwnProperty.call(root, "context");
  const recognizedRootKeys = new Set(["config", "context", "runtime"]);
  const recognizedContextKeys = new Set(["input", "vars", "nodes", "runtime"]);
  const taskKeys =
    nodeType === "operate"
      ? [
          "taskId",
          "approvalGroupId",
          "signMode",
          "approvalProgress",
          "completedByUserId",
          "responsibleUserId",
        ]
      : [];
  const taskMetadata = Object.fromEntries(
    taskKeys
      .filter(key => Object.prototype.hasOwnProperty.call(root, key))
      .map(key => [key, root[key]])
  );
  taskKeys.forEach(key => recognizedRootKeys.add(key));
  const runtime = context?.runtime ?? root.runtime ?? null;

  return {
    businessInput:
      context?.input ?? (hasContext ? null : omit(root, recognizedRootKeys)),
    flowVariables: context?.vars ?? null,
    nodeResults: context?.nodes ?? null,
    nodeConfiguration: root.config ?? null,
    runtimeMetadata: hasRunPayloadValue(taskMetadata)
      ? runtime === null
        ? taskMetadata
        : { runtime, task: taskMetadata }
      : runtime,
    additionalBusinessFields: context ? omit(root, recognizedRootKeys) : null,
    additionalContext: context
      ? omit(context, recognizedContextKeys)
      : hasContext
        ? root.context
        : null,
  };
}
