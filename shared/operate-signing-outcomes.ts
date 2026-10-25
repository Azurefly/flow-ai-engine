export type SigningDecision = "approved" | "rejected" | "abstained";
export type SigningOutcome = { code?: unknown; decision?: unknown };
const decisions: readonly string[] = ["approved", "rejected", "abstained"];
export function outcomeDecision(
  outcome: SigningOutcome
): SigningDecision | undefined {
  const code = String(outcome.code ?? "").trim();
  if (decisions.includes(String(outcome.decision)))
    return outcome.decision as SigningDecision;
  if (decisions.includes(code)) return code as SigningDecision;
  return ["returned", "cancelled"].includes(code) ? "rejected" : undefined;
}
export function assertSigningOutcomes(
  outcomes: SigningOutcome[],
  multiple: boolean
) {
  const seen = new Set<SigningDecision>();
  for (const outcome of outcomes) {
    const code = String(outcome.code ?? "").trim();
    if (
      outcome.decision !== undefined &&
      !decisions.includes(String(outcome.decision))
    )
      throw new Error("处理结果的签署含义必须是通过、拒绝或弃权。");
    if (
      decisions.includes(code) &&
      outcome.decision !== undefined &&
      outcome.decision !== code
    )
      throw new Error("系统保留结果的签署含义不可更改。");
    if (!multiple) continue;
    const decision = outcomeDecision(outcome);
    if (!decision) throw new Error("多人签署的每个业务结果必须明确签署含义。");
    if (code.length > 96) throw new Error("多人签署结果代号不能超过96个字符。");
    if (seen.has(decision))
      throw new Error(
        "多人签署每种含义只能对应一个汇总出口；多个业务动作可使用独立操作节点。"
      );
    seen.add(decision);
  }
  if (multiple && seen.has("abstained") && !seen.has("rejected"))
    throw new Error("允许弃权时必须配置拒绝出口，未达通过门槛时沿此出口继续。");
}
export function aggregateOutcomeCode(
  contractValue: unknown,
  decision: "approved" | "rejected"
): string {
  const contract =
    contractValue && typeof contractValue === "object"
      ? (contractValue as Record<string, unknown>)
      : {};
  if (contract.mode !== "explicit") return decision;
  const outcomes = Array.isArray(contract.outcomes)
    ? (contract.outcomes as SigningOutcome[])
    : Object.keys((contract.handles ?? {}) as object).map(code => ({ code }));
  assertSigningOutcomes(outcomes, true);
  const outcome = outcomes.find(item => outcomeDecision(item) === decision);
  if (!outcome) throw new Error("多人签署缺少对应的汇总出口：" + decision);
  return String(outcome.code).trim();
}

export function contractOutcomeDecision(contractValue: unknown, code: unknown) {
  const contract =
    contractValue && typeof contractValue === "object"
      ? (contractValue as Record<string, unknown>)
      : {};
  const configured = Array.isArray(contract.outcomes)
    ? contract.outcomes.find(
        item => item && typeof item === "object" && item.code === code
      )
    : undefined;
  return outcomeDecision(configured ?? { code });
}
