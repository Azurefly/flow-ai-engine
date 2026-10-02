export type RuntimeModelInfo = { id: string; ownedBy: string };

export async function loadRuntimeModelCatalog(
  apiKey: string,
  loadModels: () => Promise<{
    data: Array<{ id: string; owned_by: string }>;
  }>
): Promise<RuntimeModelInfo[]> {
  if (!apiKey.trim()) return [];

  const catalog = await loadModels();
  return catalog.data.map(model => ({
    id: model.id,
    ownedBy: model.owned_by,
  }));
}
