export type IdentifiedWorkflow = { id: string; definitionVersion?: number | null };

/**
 * 选择当前明确请求的流程。若该流程尚未进入列表缓存，必须等待详情查询，
 * 不得回退到列表首项，否则仓库“打开设计器”会展示错误的资源。
 */
export function resolveSelectedWorkflow<T extends IdentifiedWorkflow>(items: T[], requestedId: string | null, detail: T | null | undefined) {
  if (requestedId) {
    const listed = items.find(item => item.id === requestedId);
    const matchingDetail = detail?.id === requestedId ? detail : null;
    if (listed && matchingDetail && Number(matchingDetail.definitionVersion) > Number(listed.definitionVersion ?? 0)) return matchingDetail;
    return listed ?? matchingDetail;
  }
  return items[0] ?? null;
}
