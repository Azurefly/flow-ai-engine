export const durableSubflowMode = "durable_child";
export const maxDurableCallSites = 8;

export function isDurableSubflow(node: {
  type: string;
  config: Record<string, unknown>;
}) {
  return (
    node.type === "subflow" && node.config.executionMode === durableSubflowMode
  );
}

export const childFailurePolicies = [
  "fail_parent",
  "return_result",
  "retry_once",
  "manual",
] as const;
export const childCancelPolicies = ["propagate", "detach"] as const;
export type ChildFailurePolicy = (typeof childFailurePolicies)[number];
export type ChildCancelPolicy = (typeof childCancelPolicies)[number];
const resultSegment = new RegExp("^[\\p{L}\\p{N}_-]+$", "u");

export function childCallOptions(config: Record<string, unknown>) {
  const failure = config.failurePolicy ?? "fail_parent";
  const cancel = config.cancelPolicy ?? "propagate";
  if (!childFailurePolicies.includes(failure as ChildFailurePolicy))
    throw new Error("请选择有效的子流程失败策略。");
  if (!childCancelPolicies.includes(cancel as ChildCancelPolicy))
    throw new Error("请选择有效的父取消策略。");
  const resultPath = config.childResultPath ?? "";
  if (
    typeof resultPath !== "string" ||
    resultPath.length > 240 ||
    (resultPath &&
      !resultPath
        .split(".")
        .every(
          part =>
            resultSegment.test(part) &&
            !["__proto__", "constructor", "prototype"].includes(part)
        ))
  )
    throw new Error("子结果路径应由点号分隔的字段名或数组下标组成。");
  if (
    config.childVersion != null &&
    (!Number.isSafeInteger(config.childVersion) ||
      Number(config.childVersion) < 1)
  )
    throw new Error("子流程发布版本必须是正整数。");
  return {
    failurePolicy: failure as ChildFailurePolicy,
    cancelPolicy: cancel as ChildCancelPolicy,
    resultPath,
  };
}
