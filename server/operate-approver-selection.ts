import { orderOperateApprovers } from "../shared/operate-approval-editor";
import type { ReferenceSignMode } from "../shared/reference-operate-config";

/** Preview and execution must agree; explicit approval membership cannot shrink silently. */
export function selectOperateApprovers(
  candidates: number[],
  selected: number[],
  signMode: ReferenceSignMode
) {
  if (signMode === "single") return candidates;
  const eligible = new Set(candidates);
  if (selected.some(id => !eligible.has(id)))
    throw new Error(
      "或签/会签指定方未命中当前操作候选人，请调整人员配置，审批要求不会自动降低。"
    );
  const approvers = orderOperateApprovers(
    candidates,
    selected,
    signMode === "sequentialSignFor"
  );
  if (!approvers.length)
    throw new Error("或签/会签指定方未命中当前操作候选人。");
  return approvers;
}
