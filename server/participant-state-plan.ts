import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";
import type {
  ParticipantCard,
  ParticipantRelation,
  ParticipantStateRuntime,
} from "../shared/participant-state";
import { resolveStateDisplayName } from "../shared/workflow-node-contract";
import type { WorkflowDefinition, WorkflowNode } from "./workflow-compiler";
import { resolveTemplates, routerRuleMatches } from "./workflow-routing";
import { participantRouteConditionSchema } from "./participant-route-condition-schema";
import {
  matchesParticipantCondition,
  type ParticipantDepartment,
} from "./participant-route-condition";

type JsonRecord = Record<string, unknown>;
export type ParticipantStateChange = {
  userId: number;
  before: ParticipantCard | null;
  stateNodeId: string;
  stateCode: string;
  stateName: string;
  stateColor: string | null;
  path: string[];
};

export function planParticipantStateChange(input: {
  definition: WorkflowDefinition;
  entryNodeId: string;
  actorUserId: number;
  initiatorUserId: number;
  userIds: number[];
  receiverUserIds: number[];
  relation?: ParticipantRelation;
  cards: Record<string, ParticipantCard>;
  roles: Map<number, string[]>;
  departments?: Map<number, ParticipantDepartment[]>;
  operationResults?: ParticipantStateRuntime["operationResults"];
  context: JsonRecord;
}): ParticipantStateChange[] {
  const nodes = new Map(input.definition.nodes.map(node => [node.id, node]));
  const routers = new Map(
    input.definition.nodes
      .filter(node => node.type === "router")
      .map(node => [
        node.id,
        normalizeReferenceRouterConfig(node.config).rules.map(rule => ({
          ...rule,
          participantCondition:
            rule.participantCondition === undefined
              ? undefined
              : participantRouteConditionSchema.parse(
                  rule.participantCondition
                ),
        })),
      ])
  );
  const changes: ParticipantStateChange[] = [];
  const participants = Object.fromEntries(
    Array.from(
      new Set([
        ...Object.values(input.cards).map(card => card.userId),
        ...input.userIds,
      ])
    ).map(userId => {
      const card = input.cards[String(userId)];
      const record = input.operationResults?.[String(userId)];
      const relationId =
        input.relation &&
        [
          input.relation.senderUserId,
          ...input.relation.receiverUserIds,
        ].includes(userId)
          ? input.relation.id
          : (card?.relationId ?? null);
      return [
        String(userId),
        {
          userId,
          stateCode: card?.stateCode ?? null,
          stateName: card?.stateName ?? null,
          results: record?.relationId === relationId ? record.results : {},
        },
      ];
    })
  );
  for (const userId of Array.from(new Set(input.userIds)).sort(
    (a, b) => a - b
  )) {
    const before = input.cards[String(userId)] ?? null;
    const assignedRoles = input.roles.get(userId) ?? [];
    const departments = input.departments?.get(userId) ?? [];
    const participant = {
      ...participants[String(userId)],
      userId,
      isInitiator: userId === input.initiatorUserId,
      isParticipant: true,
      roleKeys: assignedRoles,
      departmentIds: departments.map(department => department.unitId),
      primaryDepartmentId:
        departments.find(department => department.isPrimary)?.unitId ?? null,
      stateCode: before?.stateCode ?? null,
      stateName: before?.stateName ?? null,
      isActor: userId === input.actorUserId,
      isReceiver: input.receiverUserIds.includes(userId),
      isRelationSender: userId === input.relation?.senderUserId,
      isRelationReceiver:
        input.relation?.receiverUserIds.includes(userId) ?? false,
    };
    const context = { ...input.context, participants, participant };
    const roles = [...assignedRoles, "default"];
    if (participant.isActor) roles.push("actor");
    if (participant.isReceiver) roles.push("receiver");
    if (participant.isRelationSender) roles.push("relation_sender");
    if (participant.isRelationReceiver) roles.push("relation_receiver");
    if (participant.isInitiator) roles.push("initiator");
    let node: WorkflowNode | undefined = nodes.get(input.entryNodeId);
    const path: string[] = [];
    while (node?.type === "router") {
      if (path.includes(node.id))
        throw new Error("人员路由存在循环，无法分配状态。");
      path.push(node.id);
      const rules = routers.get(node.id)!;
      const matches = rules.filter(
        rule =>
          !rule.isDefault &&
          routerRuleMatches(rule, context, roles) &&
          (!rule.participantCondition ||
            matchesParticipantCondition(rule.participantCondition, {
              userId,
              roleKeys: assignedRoles,
              stateCode: participant.stateCode,
              departments,
              context,
              identities: participant,
            }))
      );
      if (matches.length > 1 && matches[0].priority === matches[1].priority)
        throw new Error(
          `人员 ${userId} 在路由“${node.name}”命中相同优先级的多条规则，请明确优先级。`
        );
      const selected = matches[0] ?? rules.find(rule => rule.isDefault);
      if (!selected) {
        if (node.config.unmatched === "error" || !before)
          throw new Error(
            `人员 ${userId} 在路由“${node.name}”未匹配目标状态。`
          );
        node = undefined;
        break;
      }
      const edge = input.definition.edges.find(
        edge =>
          edge.sourceNodeId === node!.id &&
          (edge.sourceHandle || "default") === selected.handle
      );
      if (!edge) throw new Error(`路由“${node.name}”的目标连线不存在。`);
      node = nodes.get(edge.targetNodeId);
    }
    if (!node) {
      if (before) continue;
      throw new Error(`人员 ${userId} 缺少初始状态。`);
    }
    if (node.type !== "state")
      throw new Error("操作后的路由必须到达个人状态。");
    path.push(node.id);
    const config = resolveTemplates(node.config, context) as JsonRecord;
    changes.push({
      userId,
      before,
      stateNodeId: node.id,
      stateCode: String(config.nodeDh || config.stateCode || node.id),
      stateName: resolveStateDisplayName(config, node.name),
      stateColor:
        typeof config.stateColor === "string" && config.stateColor.trim()
          ? config.stateColor
          : null,
      path,
    });
  }
  return changes;
}
