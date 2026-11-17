export const PARTICIPANT_STATE_MODEL = "participant-v1";

export type ParticipantOperation = {
  scope: "actor" | "actor_and_receivers" | "relation" | "all";
  relation: "none" | "create" | "consume";
};

export type ParticipantCard = {
  userId: number;
  stateNodeId: string;
  stateCode: string;
  stateName: string;
  version: number;
  relationId: string | null;
};

export type ParticipantRelation = {
  id: string;
  senderUserId: number;
  receiverUserIds: number[];
  status: "active" | "closed";
  createdVersion: number;
  closedVersion?: number;
};

export type ParticipantStateRuntime = {
  version: 1;
  cards: Record<string, ParticipantCard>;
  relations: Record<string, ParticipantRelation>;
};

export type ParticipantTaskBinding = {
  model: typeof PARTICIPANT_STATE_MODEL;
  stateNodeId: string;
  cardVersion: number;
  relationId: string | null;
};

export function isParticipantStateDefinition(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { settings?: { stateModel?: unknown } }).settings
        ?.stateModel === PARTICIPANT_STATE_MODEL
  );
}

export function participantOperation(
  config: Record<string, unknown>
): ParticipantOperation {
  const value = config.participantOperation as
    | Partial<ParticipantOperation>
    | undefined;
  return {
    scope: value?.scope ?? "actor",
    relation: value?.relation ?? "none",
  };
}

export function participantTaskBinding(
  payload: unknown
): ParticipantTaskBinding | null {
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const binding = (
    payload as { participantState?: ParticipantTaskBinding } | null
  )?.participantState;
  return binding?.model === PARTICIPANT_STATE_MODEL &&
    typeof binding.stateNodeId === "string" &&
    Number.isSafeInteger(binding.cardVersion) &&
    binding.cardVersion > 0
    ? binding
    : null;
}

export const PARTICIPANT_SCOPE_OPTIONS = [
  { value: "actor", label: "本次操作人" },
  { value: "actor_and_receivers", label: "操作人与新接收人" },
  { value: "relation", label: "本轮发送人与接收人" },
  { value: "all", label: "实例全部参与人" },
] as const;

export const PARTICIPANT_RELATION_OPTIONS = [
  { value: "none", label: "普通状态操作" },
  { value: "create", label: "建立新一轮提交关系" },
  { value: "consume", label: "结束当前提交关系" },
] as const;
