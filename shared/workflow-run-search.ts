const localizedStatusQueries: Record<string, string> = {
  排队中: "queued",
  运行中: "running",
  等待人工: "waiting",
  已暂停: "blocked",
  成功: "success",
  失败: "failed",
  已取消: "cancelled",
  已终止: "terminated",
};

export function normalizeWorkflowRunSearchQuery(value: string) {
  const query = value.trim();
  return localizedStatusQueries[query] ?? query;
}
