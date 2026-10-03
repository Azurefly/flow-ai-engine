export function automaticCanvasFit(
  preview: boolean,
  selectedId?: string | null
) {
  return {
    padding: preview ? 0.12 : 0.22,
    minZoom: preview ? 0.1 : 0.65,
    maxZoom: preview ? 1.25 : 1,
    ...(selectedId && !preview ? { nodes: [{ id: selectedId }] } : {}),
  };
}
