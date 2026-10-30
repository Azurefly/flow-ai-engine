/** Resolve shared class constants so source-contract checks inspect their actual values. */
export function inlinePresentationClasses(source: string) {
  const classes = new Map(Array.from(source.matchAll(/const (surfaceClass\d+) = ("(?:[^"\\]|\\.)*");/g), match => [match[1], match[2]]));
  return source.replace(/className=\{(surfaceClass\d+)\}/g, (binding, name) => classes.has(name) ? `className=${classes.get(name)}` : binding);
}
