/** Share repeated immutable class strings across modules after minification.
 * Application calls, object keys and dependency paths remain unchanged.
 */
export function compactStyleConstants(
  code: string,
  parse: (code: string) => any
) {
  const names = new Set<string>();
  const literals = new Map<string, { start: number; end: number }[]>();
  function walk(node: any, parent?: any) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") names.add(node.name);
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      node.value.length > 20 &&
      /^[\x20-\x7e]+$/.test(node.value) &&
      /\s/.test(node.value) &&
      /(?:text-|bg-|border-|rounded-|items-|px-|py-)/.test(node.value) &&
      /^[a-zA-Z0-9_\s:[\]#./%()!>=+,-]+$/.test(node.value) &&
      !(parent?.key === node && !parent.computed) &&
      ![
        "ImportDeclaration",
        "ImportExpression",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(parent?.type) &&
      !parent?.directive
    ) {
      const positions = literals.get(node.value) ?? [];
      positions.push({ start: node.start, end: node.end });
      literals.set(node.value, positions);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) walk(child, node);
      else if (value && typeof value === "object") walk(value, node);
    }
  }
  const ast = parse(code);
  walk(ast);
  const edits: { start: number; end: number; text: string }[] = [];
  const declarations: string[] = [];
  let index = 0;
  for (const [value, positions] of Array.from(literals.entries())) {
    if (positions.length < 3) continue;
    let name: string;
    do {
      name = `$C${(index++).toString(36)}`;
    } while (names.has(name));
    const literal = JSON.stringify(value);
    if (
      positions.reduce(
        (sum, pos) => sum + pos.end - pos.start - name.length,
        0
      ) <=
      name.length + literal.length + 8
    )
      continue;
    names.add(name);
    declarations.push(`${name}=${literal}`);
    edits.push(...positions.map(pos => ({ ...pos, text: name })));
  }
  if (!declarations.length) return null;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  let prologueEnd = 0;
  for (const statement of ast.body) {
    if (!statement.directive) break;
    prologueEnd = statement.end;
  }
  return {
    code:
      code.slice(0, prologueEnd) +
      `;const ${declarations.join(",")};\n` +
      code.slice(prologueEnd),
    map: null,
  };
}
