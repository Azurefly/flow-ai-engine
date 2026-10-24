/** Keep a useful editor when the page contains expanded diagnostics or is very short. */
export function availableEditorHeight(
  viewportHeight: number,
  documentTop: number,
  gutter = 16
) {
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(documentTop))
    return 480;
  return Math.max(
    360,
    Math.floor(viewportHeight - Math.max(0, documentTop) - gutter)
  );
}
