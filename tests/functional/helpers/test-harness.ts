import {
  type FlowNodeType,
  type NodeConfig,
  canConnectFlowNodeTypes,
  createDefaultNodeConfig,
  FLOW_NODE_DEFINITIONS,
  FLOW_NODE_TYPES,
  validateNodeConfig,
  withNodeConfigDefaults,
} from "../../../shared/workflow-node-contract";
import { isFlowNodeAllowed } from "../../../shared/flow-profile-contract";
import {
  hasStateInnateOperation,
  toggleStateInnateOperation,
  toggleConfigSelection,
  renameConfigProperty,
  subflowSelectionConfig,
  showSigningPercent,
  type StateInnateOperation,
} from "../../../client/src/components/workflow-config-editor";

export type TestExecutionRecord = {
  testId: string;
  name: string;
  category: "button" | "config" | "contract" | "workflow" | "validation";
  module: string;
  target: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

export class TestResultCollector {
  private static records: TestExecutionRecord[] = [];

  static record(entry: Omit<TestExecutionRecord, "durationMs"> & { start: number }) {
    this.records.push({
      testId: entry.testId,
      name: entry.name,
      category: entry.category,
      module: entry.module,
      target: entry.target,
      status: entry.status,
      durationMs: Math.round(performance.now() - entry.start),
      error: entry.error,
    });
  }

  static getRecords() {
    return [...this.records];
  }

  static clear() {
    this.records = [];
  }
}

/**
 * Coerces structured input rows into typed runtime parameters,
 * matching WorkflowTestRunModal logic.
 */
export function coerceStructuredInputRows(
  rows: Array<{ key: string; value: string }>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.key.trim()) continue;
    const raw = row.value.trim();
    if (raw === "true") result[row.key] = true;
    else if (raw === "false") result[row.key] = false;
    else if (raw === "null") result[row.key] = null;
    else if (raw !== "" && !Number.isNaN(Number(raw))) result[row.key] = Number(raw);
    else {
      try {
        if (raw.startsWith("{") || raw.startsWith("[")) {
          result[row.key] = JSON.parse(raw);
        } else {
          result[row.key] = raw;
        }
      } catch {
        result[row.key] = raw;
      }
    }
  }
  return result;
}

/**
 * Parses business CSV format with robust BOM stripping and column normalization,
 * matching BusinessCenter import requirements.
 */
export function parseBusinessCsvContent(text: string) {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error("CSV 文件必须至少包含标题行和一行数据。");

  const header = lines[0].split(",").map(cell => cell.trim().replace(/\s+/g, ""));
  const codeIndex = header.findIndex(h => ["业务代号", "代号", "code"].includes(h.toLowerCase()));
  const nameIndex = header.findIndex(h => ["业务名称", "名称", "name"].includes(h.toLowerCase()));
  const domainIndex = header.findIndex(h =>
    ["工作域代号", "工作域", "domaincode", "domain"].includes(h.toLowerCase())
  );
  const descIndex = header.findIndex(h =>
    ["业务说明", "说明", "description", "desc"].includes(h.toLowerCase())
  );

  if (codeIndex === -1 || nameIndex === -1) {
    throw new Error("CSV 标题必须包含业务代号、业务名称。");
  }

  const seenCodes = new Set<string>();
  const rows: Array<{ code: string; name: string; domainCode: string; description: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(col => col.trim());
    const code = cols[codeIndex] ? cols[codeIndex].toUpperCase() : "";
    const name = cols[nameIndex] || "";
    const domainCode = domainIndex >= 0 && cols[domainIndex] ? cols[domainIndex].trim() : "";
    const description = descIndex >= 0 && cols[descIndex] ? cols[descIndex].trim() : "";

    if (!code || !name) throw new Error(`第 ${i + 1} 行存在空白的业务代号或名称。`);
    if (seenCodes.has(code)) throw new Error(`CSV 中存在重复的业务代号：${code}。`);
    seenCodes.add(code);

    rows.push({ code, name, domainCode, description });
  }

  return rows;
}
