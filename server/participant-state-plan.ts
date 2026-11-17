import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";
import type {
  ParticipantCard,
  ParticipantRelation,
} from "../shared/participant-state";
import { resolveStateDisplayName } from "../shared/workflow-node-contract";
import type { WorkflowDefinition, WorkflowNode } from "./workflow-compiler";
import { resolveTemplates, routerRuleMatches } from "./workflow-routing";

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
  context: JsonRecord;
}): ParticipantStateChange[] {
  const nodes = new Map(input.definition.nodes.map(node => [node.id, node]));
  const changes: ParticipantStateChange[] = [];
  for (const userId of Array.from(new Set(input.userIds)).sort(
    (a, b) => a - b
  )) {
    const before = input.cards[String(userId)] ?? null;
    const participant = {
      userId,
      stateCode: before?.stateCode ?? null,
      stateName: before?.stateName ?? null,
      isActor: userId === input.actorUserId,
      isReceiver: input.receiverUserIds.includes(userId),
      isRelationSender: userId === input.relation?.senderUserId,
      isRelationReceiver:
        input.relation?.receiverUserIds.includes(userId) ?? false,
    };
    const context = { ...input.context, participant };
    const roles = [...(input.roles.get(userId) ?? ["default"])];
    if (participant.isActor) roles.push("actor");
    if (participant.isReceiver) roles.push("receiver");
    if (participant.isRelationSender) roles.push("relation_sender");
    if (participant.isRelationReceiver) roles.push("relation_receiver");
    if (userId === input.initiatorUserId) roles.push("initiator");
    let node: WorkflowNode | undefined = nodes.get(input.entryNodeId);
    const path: string[] = [];
    while (node?.type === "router") {
      if (path.includes(node.id))
        throw new Error("人员路由存在循环，无法分配状态。");
      path.push(node.id);
      const router = normalizeReferenceRouterConfig(node.config);
      const matches = router.rules.filter(
        rule => !rule.isDefault && routerRuleMatches(rule, context, roles)
      );
      if (matches.length > 1 && matches[0].priority === matches[1].priority)
        throw new Error(
          `人员 ${userId} 在路由“${node.name}”命中相同优先级的多条规则，请明确优先级。`
        );
      const selected = matches[0] ?? router.rules.find(rule => rule.isDefault);
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
