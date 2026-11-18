import { describe, expect, it } from "vitest";
import { availableCounts, conditionText, readApprovalCount, withApprovalCount } from "../shared/approval-condition-presentation";
import type { ParticipantRouteCondition as Condition } from "../shared/participant-route-condition";
import { matchesParticipantCondition } from "./participant-route-condition";

const vote = (id: number, node = "finance"): Condition => ({
  kind: "data", left: `{{participants.${id}.results.${node}.decision}}`, operator: "equals", right: "approved",
});
const group = (match: "any" | "all", ...conditions: Condition[]): Condition =>
  ({ kind: "group", match, conditions });
const pair = (a: number, b: number) => group("all", vote(a), vote(b));

describe("approval count editing", () => {
  it("recognizes the complete two-of-three expression, independent of order", () => {
    const rule = group("any", pair(2, 1), pair(3, 2), pair(1, 3));
    expect(readApprovalCount(rule)).toMatchObject({ required: 2, node: "finance" });
    expect(conditionText(rule, { finance: "财务审核" })).toBe("财务审核 · 3 人中至少 2 人通过");
  });

  it("keeps partial combinations, duplicate voters, different operations, negation and extension fields in the original editor", () => {
    for (const rule of [
      group("any", pair(1, 2), pair(1, 3)), group("any", pair(1, 2), pair(1, 2), pair(2, 3)),
      pair(1, 1), group("all", vote(1), vote(2, "audit")), { ...vote(1), negate: true },
      group("all", { ...vote(1), audit: "keep" } as Condition), group("any"), null,
    ]) expect(readApprovalCount(rule)).toBeUndefined();
  });

  it("round-trips every threshold for five voters using the runtime matcher over every combination of votes", () => {
    const ids = [1, 2, 3, 4, 5];
    const rule = readApprovalCount(group("any", ...ids.map(id => vote(id))))!;
    for (const required of availableCounts(rule)) {
      const condition = withApprovalCount(rule, required);
      expect(readApprovalCount(condition)?.required).toBe(required);
      for (let mask = 0; mask < 32; mask++) {
        const approved = ids.filter((_, i) => mask & (1 << i));
        const participants = Object.fromEntries(approved.map(id => [id, { results: { finance: { decision: "approved" } } }]));
        const matched = matchesParticipantCondition(condition, { userId: 1, stateCode: null, roleKeys: [], departments: [],
          identities: {}, context: { participants } });
        expect(matched).toBe(approved.length >= required);
      }
    }
  });
});
