import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalResourcePayload } from "../shared/resource-creation";

export const kinds = ["api_read", "file_read", "receipt_write"] as const;
export type Kind = (typeof kinds)[number];
export type Row = Record<string, unknown>;
export const rowLimit = 1000;
export const byteLimit = 512 * 1024;
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const rowsHash = (rows: Row[]) => hash(canonicalResourcePayload(rows));
export function connectorEnabled(kind: Kind) {
  return !(process.env.FLOW_DATA_CONNECTOR_DISABLED ?? "")
    .split(",")
    .map(s => s.trim())
    .includes(kind);
}
const identifier = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    n => !["__proto__", "constructor", "prototype"].includes(n),
    "字段名不可用。"
  );
const connection = {
  endpointRef: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  path: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[A-Za-z0-9_-][A-Za-z0-9_/-]*$/, "请填写端点内的相对资源路径。"),
};
const common = {
  projectId: z.string().min(8).max(36),
  assetId: z.string().min(8).max(36),
  label: z.string().trim().min(1).max(128),
};
export const versionInput = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("api_read"),
    ...connection,
    datasetVersion: z.string().trim().min(1).max(128),
    rowKey: identifier,
    maxPages: z.number().int().min(1).max(100).default(50),
    maxRows: z.number().int().min(1).max(rowLimit).default(rowLimit),
    maxBytes: z.number().int().min(1).max(byteLimit).default(byteLimit),
    timeoutMs: z.number().int().min(500).max(10000).default(8000),
    mapping: z.record(identifier, identifier).default({}),
  }),
  z.object({
    ...common,
    kind: z.literal("file_read"),
    fileName: z.string().trim().min(1).max(160),
    base64: z
      .string()
      .min(1)
      .max(Math.ceil(byteLimit / 3) * 4),
  }),
  z.object({
    ...common,
    kind: z.literal("receipt_write"),
    ...connection,
    rowKey: identifier,
  }),
]);
export type VersionInput = z.infer<typeof versionInput>;
export type Contract = {
  endpointRef?: string;
  endpointBase?: string;
  path?: string;
  datasetVersion?: string;
  rowKey?: string;
  maxPages?: number;
  maxRows?: number;
  maxBytes?: number;
  timeoutMs?: number;
  mapping?: Record<string, string>;
  fileName?: string;
  fields?: string[];
};

export function decodeFile(base64: string) {
  if (base64.length > Math.ceil(byteLimit / 3) * 4)
    throw Error("CSV 大小超过 512 KiB。");
  const bytes = Buffer.from(base64, "base64");
  if (
    !bytes.length ||
    bytes.length > byteLimit ||
    bytes.toString("base64") !== base64
  )
    throw Error("CSV 大小或内容编码无效。");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("CSV 必须是有效的 UTF-8 文件。");
  }
  return { bytes, ...csvRows(text) };
}

export function csvRows(text: string) {
  const rows: Row[] = [];
  let fields: string[] = [],
    cells: string[] = [],
    field = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const error = (message: string) =>
    Error(
      "CSV 第 " + start + " 行，第 " + (cells.length + 1) + " 列：" + message
    );
  function finish() {
    cells.push(field);
    if (cells.length !== 1 || cells[0] !== "" || closed) {
      if (!fields.length) {
        fields = cells.map(v => v.trim());
        if (
          fields.length > 100 ||
          fields.some(item => !identifier.safeParse(item).success) ||
          new Set(fields).size !== fields.length
        )
          throw error("标题为空、重复或超限。");
      } else {
        if (fields.length !== cells.length) throw error("列数与标题不一致。");
        if (rows.length >= rowLimit) throw error("记录超过 1000 行。");
        rows.push(Object.fromEntries(fields.map((key, i) => [key, cells[i]])));
      }
    }
    cells = [];
    field = "";
    closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      newline = c === "\r" || c === "\n",
      crlf = c === "\r" && text[i + 1] === "\n";
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += crlf ? "\r\n" : c;
        if (crlf) i++;
        if (newline) line++;
      }
    } else if (newline) {
      finish();
      if (crlf) i++;
      start = ++line;
    } else if (c === ",") {
      cells.push(field);
      field = "";
      closed = false;
    } else if (c === '"' && !field && !closed) {
      quoted = true;
    } else if (c === '"' || closed) {
      throw error("引号位置错误。");
    } else field += c;
  }
  if (quoted) throw error("缺少闭引号。");
  finish();
  if (!fields.length) throw error("缺少标题。");
  return { fields, rows };
}
export function validateRowKeys(
  rows: Row[],
  key: string,
  seen = new Set<string>()
) {
  rows.forEach((r, i) => {
    const v = r[key];
    if (
      !Object.hasOwn(r, key) ||
      (typeof v !== "string" && typeof v !== "number") ||
      String(v).trim() === ""
    )
      throw Error("第 " + (i + 1) + " 行缺少有效行键 " + key + "。");
    const encoded = JSON.stringify(v);
    if (seen.has(encoded)) throw Error("行键 " + key + " 出现重复。");
    seen.add(encoded);
  });
}
export function parsePage(bytes: Uint8Array, contract: Contract) {
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Error("API 分页响应不是有效的 UTF-8 JSON。");
  }
  const page = z
    .object({
      version: z.string(),
      rows: z.array(z.record(z.string(), z.unknown())).max(rowLimit),
      nextCursor: z.string().min(1).max(256).nullable(),
    })
    .safeParse(p);
  if (!page.success || page.data.version !== contract.datasetVersion)
    throw Error("API 分页合同或数据集版本不匹配。");
  return page.data;
}
export function mapRows(
  rows: Row[],
  mapping: Record<string, string>,
  columns: string[]
) {
  const entries = Object.entries(mapping);
  return rows.map((row, index) => {
    const projected = entries.length
      ? Object.fromEntries(
          entries.map(([to, from]) => {
            if (!Object.hasOwn(row, from))
              throw Error(
                "第 " + (index + 1) + " 行缺少映射字段 " + from + "。"
              );
            return [to, row[from]];
          })
        )
      : row;
    return columns.length
      ? Object.fromEntries(columns.map(name => [name, projected[name]]))
      : projected;
  });
}
