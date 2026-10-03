export function prepareReadOnlyDataflowSql(
  statement: string,
  parameters: Record<string, unknown> = {},
  noBackslashEscapes = false
) {
  let sql = "";
  let code = "";
  const values: unknown[] = [];
  for (let index = 0; index < statement.length; ) {
    const char = statement[index];
    if (["'", '"', "`"].includes(char)) {
      const begin = index++;
      let closed = false;
      while (index < statement.length) {
        if (statement[index] === "\\" && !noBackslashEscapes && char !== "`") {
          index += 2;
          continue;
        }
        if (statement[index++] === char) {
          if (statement[index] === char) {
            index++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("SQL 字符串或标识符引号未闭合。");
      sql += statement.slice(begin, index);
      code += " ";
      continue;
    }
    if (
      char === "#" ||
      (statement.slice(index, index + 2) === "--" &&
        /\s/.test(statement[index + 2] ?? " "))
    ) {
      const end = statement.slice(index).search(/[\r\n]/);
      const next = end < 0 ? statement.length : index + end;
      sql += statement.slice(index, next);
      code += " ";
      index = next;
      continue;
    }
    if (statement.slice(index, index + 2) === "/*") {
      if (/^\/\*(?:!|M!)/i.test(statement.slice(index)))
        throw new Error("SQL 节点不允许可执行注释。");
      const end = statement.indexOf("*/", index + 2);
      if (end < 0) throw new Error("SQL 注释未闭合。");
      sql += statement.slice(index, end + 2);
      code += " ";
      index = end + 2;
      continue;
    }
    if (char === ":") {
      const name = statement
        .slice(index + 1)
        .match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0];
      if (name) {
        if (!Object.prototype.hasOwnProperty.call(parameters, name))
          throw new Error(`SQL 参数 ${name} 未提供。`);
        const value = parameters[name];
        if (
          !(
            value === null ||
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value)) ||
            (value instanceof Date && Number.isFinite(value.getTime()))
          )
        )
          throw new Error(
            `SQL 参数 ${name} 必须为标量值，不能使用对象、数组或无效数值。`
          );
        values.push(value);
        sql += "?";
        code += "?";
        index += name.length + 1;
        continue;
      }
    }
    if (char === "?")
      throw new Error("SQL 参数请使用 :参数名，不支持未绑定的位置参数。");
    sql += char;
    code += char;
    index++;
  }
  if (
    !/^\s*select\b/i.test(code) ||
    /;|\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|call|load)\b/i.test(
      code
    )
  )
    throw new Error("SQL 节点仅支持单条只读 SELECT 语句。");
  if (/\binto\b|\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i.test(code))
    throw new Error("SQL 节点禁止写出、变量赋值及锁定查询。");
  return { sql: sql.trim(), values };
}
