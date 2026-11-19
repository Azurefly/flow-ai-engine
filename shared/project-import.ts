export const projectImportByteLimit = 512 * 1024;
export const projectCorrectionByteLimit = 1024 * 1024;
export const projectImportRowLimit = 500;
export const duplicateProjectCodeMessage = "同一文件有重复业务代号。";
const rowReferenceHeader = "批次行标识";
const revisionHeader = "批次修订";

export type ProjectImportRecord = {
  line: number;
  code: string;
  name: string;
  domainCode: string;
  description: string;
};
export type ImportIssue = { line: number; field: string; message: string };
export type ParsedProjectImport = {
  records: ProjectImportRecord[];
  issues: ImportIssue[];
  rowReferences?: { key: string; revision: string }[];
};

function needsCsvProtection(value: string) {
  return /^[\s]*[=+@-]|^['\t\r\n]/.test(value);
}

function quoteCorrectionCell(value: string | number) {
  const text = String(value);
  return '"' + (needsCsvProtection(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
}

export function projectCorrectionCsv(batch: {
  batchId: string;
  revision: number;
  issues: ImportIssue[];
  rows: { rowNumber: number; record: ProjectImportRecord; projectId: string | null; error: string | null }[];
}) {
  const lines = [[rowReferenceHeader, revisionHeader, "源行", "业务代号", "业务名称", "工作域代号", "业务说明", "问题字段", "原因"]];
  for (const { rowNumber, record, projectId, error } of batch.rows) {
    if (projectId) continue;
    const issues = batch.issues.filter(issue => issue.line === record.line);
    if (error) issues.push({ line: record.line, field: "业务代号", message: error });
    if (!issues.length) continue;
    lines.push([
      batch.batchId + "/" + rowNumber, String(batch.revision), String(record.line),
      record.code, record.name, record.domainCode, record.description,
      issues.map(issue => issue.field).join("、"), issues.map(issue => issue.message).join("；"),
    ]);
  }
  return lines.length > 1 ? "\uFEFF" + lines.map(line => line.map(quoteCorrectionCell).join(",")).join("\r\n") : null;
}

const columns = {
  code: ["业务代号", "code"],
  name: ["业务名称", "name"],
  domainCode: ["工作域代号", "domaincode"],
  description: ["业务说明", "description"],
};

/** Parse a complete CSV stream so CRLF inside a quoted field stays part of its value. */
export function parseProjectImport(text: string): ParsedProjectImport {
  const records: ProjectImportRecord[] = [];
  const issues: ImportIssue[] = [];
  const data = text.replace(/^\uFEFF/, "");
  let header: string[] | undefined;
  let rowReferences: ParsedProjectImport["rowReferences"];
  let referenceIndex = -1;
  let revisionIndex = -1;
  const indices = { code: -1, name: -1, domainCode: -1, description: -1 };
  const codes = new Set<string>();
  let line = 1;
  let start = 1;
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let tooManyRows = false;
  const issue = (field: string, message: string) =>
    issues.push({ line: start, field, message });
  function finishRecord() {
    cells.push(value);
    if (cells.length === 1 && !cells[0].trim()) return;
    if (!header) {
      header = cells.map(cell => cell.trim().toLowerCase());
      referenceIndex = header.indexOf(rowReferenceHeader);
      revisionIndex = header.indexOf(revisionHeader);
      if (referenceIndex !== -1 || revisionIndex !== -1) {
        rowReferences = [];
        for (const title of [rowReferenceHeader, revisionHeader]) {
          if (header.filter(label => label === title).length !== 1)
            issue(title, "修正文件须各保留一列批次行标识和批次修订。");
        }
      }
      for (const key of Object.keys(columns) as (keyof typeof columns)[]) {
        const matching = header.flatMap((label, index) =>
          columns[key].includes(label) ? [index] : []
        );
        indices[key] = matching[0] ?? -1;
        if (matching.length > 1)
          issue(columns[key][0], "同一字段出现了多个标题。");
      }
      if (indices.code < 0 || indices.name < 0)
        issue("标题", "CSV 标题必须包含业务代号、业务名称（或 code、name）。");
      return;
    }
    if (records.length >= projectImportRowLimit) {
      tooManyRows = true;
      issue("记录", "每次最多导入 500 个业务项目。");
      return;
    }
    const get = (key: keyof typeof columns) => {
      const text = cells[indices[key]] ?? "";
      return rowReferences && text.startsWith("'") && needsCsvProtection(text.slice(1)) ? text.slice(1) : text;
    };
    rowReferences?.push({ key: cells[referenceIndex] ?? "", revision: cells[revisionIndex] ?? "" });
    const record = {
      line: start,
      code: get("code").trim().toUpperCase(),
      name: get("name").trim(),
      domainCode: get("domainCode").trim().toUpperCase(),
      description: get("description"),
    };
    if (cells.length !== header.length) issue("列数", "记录的列数与标题不同。");
    if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(record.code))
      issue(
        "业务代号",
        "业务代号须以字母开头，可含数字、下划线或连字符，长度为 2–64。"
      );
    if (codes.has(record.code)) issue("业务代号", duplicateProjectCodeMessage);
    if (!record.name || record.name.length > 160)
      issue("业务名称", "业务名称须为 1–160 个字符。");
    if (record.domainCode.length > 64)
      issue("工作域代号", "工作域代号最多 64 个字符。");
    if (record.description.length > 2000)
      issue("业务说明", "业务说明最多 2000 个字符。");
    codes.add(record.code);
    records.push(record);
  }
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > projectCorrectionByteLimit || (bytes > projectImportByteLimit && !data.split(/[\r\n]/, 1)[0].includes(rowReferenceHeader)))
    return {
      records,
      issues: [
        { line: 1, field: "文件", message: "业务 CSV 最大为 512 KiB，批次行修正文件最大为 1 MiB。" },
      ],
    };
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const newline = ch === "\r" || ch === "\n";
    const crlf = ch === "\r" && data[i + 1] === "\n";
    if (quoted) {
      if (ch === '"') {
        if (data[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        value += crlf ? "\r\n" : ch;
        if (newline) line++;
        if (crlf) i++;
      }
    } else if (newline) {
      finishRecord();
      if ((!records.length && issues.length) || tooManyRows)
        return { records, issues, ...(rowReferences && { rowReferences }) };
      start = ++line;
      cells = [];
      value = "";
      afterQuote = false;
      if (crlf) i++;
    } else if (ch === ",") {
      cells.push(value);
      value = "";
      afterQuote = false;
    } else if (ch === '"' && !value && !afterQuote) {
      quoted = true;
    } else if (ch === '"' || (afterQuote && ch.trim())) {
      issue(
        header?.[cells.length] || "字段",
        "引号位置错误，请用双引号包围整个字段。"
      );
      return { records, issues, ...(rowReferences && { rowReferences }) };
    } else if (!afterQuote) value += ch;
  }
  if (quoted) issue(header?.[cells.length] || "字段", "字段缺少闭引号。");
  else finishRecord();
  if (!header && !issues.length) issue("文件", "CSV 文件为空。");
  else if (!records.length && !issues.length)
    issue("记录", "模板中还没有业务记录。");
  if (bytes > projectImportByteLimit && !rowReferences)
    issue("文件", "业务 CSV 最大为 512 KiB。");
  return { records, issues, ...(rowReferences && { rowReferences }) };
}
