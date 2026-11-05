import { gzipSync } from "node:zlib";

/** Hoist immutable repeated strings only when both raw and gzip output improve.
 * Calls, identifiers, property keys, directives and dependency references stay intact.
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
      node.value.length > 12 &&
      node.value.length < 8192 &&
      !/^(?:https?:|file:|assets\/|\.\.?\/)/.test(node.value) &&
      !/\.(?:js|mjs|cjs|css|wasm)(?:\?|$)/.test(node.value) &&
      !node.value.includes("__VITE_") &&
      !(parent?.key === node && !parent.computed) &&
      ![
        "ImportSpecifier",
        "ExportSpecifier",
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

  let prologueEnd = 0;
  for (const statement of ast.body) {
    if (!statement.directive) break;
    prologueEnd = statement.end;
  }
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [],
    declarations: string[] = [];
  function render(nextEdits: Edit[], nextDeclarations: string[]) {
    let output = code;
    for (const edit of [...nextEdits].sort((a, b) => b.start - a.start))
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    return (
      output.slice(0, prologueEnd) +
      `;const ${nextDeclarations.join(",")};\n` +
      output.slice(prologueEnd)
    );
  }
  let index = 0,
    best = code,
    gzipBytes = gzipSync(code).length;
  const candidates = Array.from(literals.entries())
    .filter(([, positions]) => positions.length >= 2)
    .sort(
      (a, b) =>
        (b[1].length - 1) * Buffer.byteLength(b[0]) -
        (a[1].length - 1) * Buffer.byteLength(a[0])
    );
  for (const [value, positions] of candidates) {
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
    const nextEdits = [
      ...edits,
      ...positions.map(pos => ({ ...pos, text: name })),
    ];
    const nextDeclarations = [...declarations, `${name}=${literal}`];
    const output = render(nextEdits, nextDeclarations);
    if (Buffer.byteLength(output) >= Buffer.byteLength(best)) continue;
    const size = gzipSync(output).length;
    if (size > gzipBytes) continue;
    names.add(name);
    edits.push(...nextEdits.slice(edits.length));
    declarations.push(nextDeclarations[nextDeclarations.length - 1]);
    best = output;
    gzipBytes = size;
  }
  return declarations.length ? { code: best, map: null } : null;
}
