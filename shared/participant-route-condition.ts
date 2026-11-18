export const PARTICIPANT_IDENTITIES = [
  { value: "isParticipant", label: "流程参与人" },
  { value: "isInitiator", label: "流程发起人" },
  { value: "isActor", label: "本次操作人" },
  { value: "isReceiver", label: "本次选定接收人" },
  { value: "isRelationSender", label: "本轮关系发送人" },
  { value: "isRelationReceiver", label: "本轮关系接收人" },
] as const;

export const PARTICIPANT_DATA_OPERATORS = [
  { value: "equals", label: "等于" },
  { value: "notEquals", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "exists", label: "存在" },
  { value: "greaterThan", label: "大于" },
  { value: "lessThan", label: "小于" },
] as const;

type Identity = (typeof PARTICIPANT_IDENTITIES)[number]["value"];
type DataOperator = (typeof PARTICIPANT_DATA_OPERATORS)[number]["value"];
export type ParticipantRouteCondition = { negate?: boolean } & (
  | {
      kind: "group";
      match: "all" | "any";
      conditions: ParticipantRouteCondition[];
    }
  | { kind: "identity"; identity: Identity }
  | { kind: "role"; roleKeys: string[]; match: "all" | "any" }
  | { kind: "user"; userIds: number[] }
  | {
      kind: "department";
      unitIds: string[];
      minDepth: number;
      maxDepth: number | null;
      membership: "any" | "primary";
    }
  | { kind: "state"; stateCodes: string[] }
  | { kind: "data"; left: unknown; operator: DataOperator; right?: unknown }
);

export function participantConditionLeaves(
  condition: ParticipantRouteCondition
): Exclude<ParticipantRouteCondition, { kind: "group" }>[] {
  return condition.kind === "group"
    ? condition.conditions.flatMap(participantConditionLeaves)
    : [condition];
}

export function createParticipantRouteCondition(
  kind: ParticipantRouteCondition["kind"]
): ParticipantRouteCondition {
  switch (kind) {
    case "group":
      return {
        kind,
        match: "all",
        conditions: [{ kind: "identity", identity: "isParticipant" }],
      };
    case "identity":
      return { kind, identity: "isInitiator" };
    case "role":
      return { kind, roleKeys: [], match: "any" };
    case "user":
      return { kind, userIds: [] };
    case "department":
      return { kind, unitIds: [], minDepth: 0, maxDepth: 0, membership: "any" };
    case "state":
      return { kind, stateCodes: [] };
    case "data":
      return {
        kind,
        left: "{{participant.stateCode}}",
        operator: "equals",
        right: "",
      };
  }
}
