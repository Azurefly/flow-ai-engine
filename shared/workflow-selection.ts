export type IdentifiedWorkflow = { id: string };

/**
 * 选择当前明确请求的流程。若该流程尚未进入列表缓存，必须等待详情查询，
 * 不得回退到列表首项，否则仓库“打开设计器”会展示错误的资源。
 */
export function resolveSelectedWorkflow<T extends IdentifiedWorkflow>(items: T[], requestedId: string | null, detail: T | null | undefined) {
  if (requestedId) return items.find(item => item.id === requestedId) ?? detail ?? null;
  return items[0] ?? null;
}
