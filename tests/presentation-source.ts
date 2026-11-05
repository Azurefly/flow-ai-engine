import ts from "typescript";

/** Resolve static presentation strings without executing source or weakening event/API checks. */
export function inlinePresentationClasses(source: string) {
  const ast = ts.createSourceFile("presentation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const classes = new Map<string, ts.Expression>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /class/i.test(node.name.text) && node.initializer) classes.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  function value(node: ts.Node, seen = new Set<string>()): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isParenthesizedExpression(node)) return value(node.expression, seen);
    if (ts.isIdentifier(node) && classes.has(node.text) && !seen.has(node.text)) return value(classes.get(node.text)!, new Set([...seen, node.text]));
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = value(node.left, seen), right = value(node.right, seen);
      if (left !== undefined && right !== undefined) return left + right;
    }
    return undefined;
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "className" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      const expression = node.initializer.expression;
      const compatible = !ts.isIdentifier(expression) || /^(surfaceClass\d+|mutedToneClass)$/.test(expression.text);
      const resolved = compatible ? value(expression) : undefined;
      if (resolved !== undefined) { edits.push({ start: node.initializer.getStart(ast), end: node.initializer.end, text: JSON.stringify(resolved) }); return; }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && classes.has(node.name.text) && node.initializer) {
      const resolved = value(node.initializer);
      if (resolved !== undefined) { edits.push({ start: node.initializer.getStart(ast), end: node.initializer.end, text: JSON.stringify(resolved) }); return; }
    }
    if (ts.isBinaryExpression(node) || ts.isParenthesizedExpression(node)) {
      const resolved = value(node);
      if (resolved !== undefined && node.getText(ast).includes("Class")) { edits.push({ start: node.getStart(ast), end: node.end, text: JSON.stringify(resolved) }); return; }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
