import type {
  WorkflowDefinition,
  WorkflowNode,
} from "../server/workflow-compiler";
import { PARTICIPANT_STATE_MODEL } from "./participant-state";
import { createDefaultNodeConfig } from "./workflow-node-contract";

/** Editable example also used by the runtime regression suite. */
export function createParticipantStateExample(): WorkflowDefinition {
  const node = (
    id: string,
    type: WorkflowNode["type"],
    name: string,
    x: number,
    y: number,
    config: Record<string, unknown> = {}
  ): WorkflowNode => ({
    id,
    type,
    name,
    position: { x, y },
    config: { ...createDefaultNodeConfig(type), ...config },
  });
  const state = (
    id: string,
    name: string,
    x: number,
    y: number,
    terminal = false
  ) =>
    node(id, "state", name, x, y, {
      nodeDh: id.replaceAll("-", "").toUpperCase(),
      stateCode: id.replaceAll("-", "").toUpperCase(),
      jdmc: name,
      displayName: name,
      stateType: terminal ? "terminal" : "business",
    });
  const operation = (
    id: string,
    name: string,
    x: number,
    y: number,
    relation: "create" | "consume",
    config: Record<string, unknown> = {}
  ) =>
    node(id, "operate", name, x, y, {
      nodeDh: id.toUpperCase(),
      czmc: name,
      instruction: `请确认后${name}。`,
      participantOperation: {
        scope: relation === "create" ? "actor_and_receivers" : "relation",
        relation,
      },
      outcomeMode: "explicit",
      outcomes: [{ code: id, label: name, sourceHandle: id }],
      ...config,
    });
  const router = (
    id: string,
    name: string,
    x: number,
    y: number,
    left: string,
    right: string,
    senderRole: string
  ) =>
    node(id, "router", name, x, y, {
      nodeDh: id.replaceAll("-", "").toUpperCase(),
      unmatched: "error",
      gbms: false,
      routes: [
        {
          handle: "sender",
          label: "发送人",
          priority: 100,
          roleKeys: [senderRole],
          targetNodeId: left,
        },
        {
          handle: "receiver",
          label: "接收人",
          priority: 50,
          roleKeys: [senderRole === "actor" ? "receiver" : "relation_receiver"],
          targetNodeId: right,
        },
      ],
    });
  const links: Array<[string, string, string?]> = [
    ["start", "draft"],
    ["draft", "submit"],
    ["withdrawn", "submit"],
    ["submit", "after-submit", "submit"],
    ["after-submit", "sent", "sender"],
    ["after-submit", "pending", "receiver"],
    ["sent", "withdraw"],
    ["withdraw", "after-withdraw", "withdraw"],
    ["after-withdraw", "withdrawn", "sender"],
    ["after-withdraw", "recalled", "receiver"],
    ["pending", "handle"],
    ["handle", "after-handle", "handle"],
    ["after-handle", "sender-done", "sender"],
    ["after-handle", "receiver-done", "receiver"],
    ["recalled", "end"],
    ["sender-done", "end"],
    ["receiver-done", "end"],
  ];
  return {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 0.7 },
    settings: { stateModel: PARTICIPANT_STATE_MODEL },
    nodes: [
      node("start", "start", "开始", 0, 100),
      state("draft", "待提交", 220, 100),
      operation("submit", "提交", 450, 100, "create", {
        assigneeMode: "form_user",
        assigneeFormField: "result.receiverUserId",
        formSchema: {
          fields: [
            {
              key: "receiverUserId",
              label: "接收人",
              type: "number",
              required: true,
            },
            {
              key: "description",
              label: "说明",
              type: "textarea",
              required: false,
            },
          ],
        },
      }),
      router(
        "after-submit",
        "按发送人与接收人分配状态",
        690,
        100,
        "sent",
        "pending",
        "actor"
      ),
      state("sent", "已提交", 930, 0),
      state("pending", "待处理", 930, 260),
      operation("withdraw", "撤回", 1170, 0, "consume"),
      operation("handle", "处理", 1170, 260, "consume"),
      router(
        "after-withdraw",
        "撤回后的双方状态",
        1410,
        0,
        "withdrawn",
        "recalled",
        "relation_sender"
      ),
      router(
        "after-handle",
        "处理后的双方状态",
        1410,
        300,
        "sender-done",
        "receiver-done",
        "relation_sender"
      ),
      state("withdrawn", "已撤回待提交", 1650, -140),
      state("recalled", "下级已撤回", 1650, 100, true),
      state("sender-done", "已完成", 1650, 330, true),
      state("receiver-done", "已处理", 1650, 560, true),
      node("end", "end", "全部参与人结束", 1910, 330),
    ],
    edges: links.map(([sourceNodeId, targetNodeId, sourceHandle], index) => ({
      id: `participant-edge-${index}`,
      sourceNodeId,
      targetNodeId,
      sourceHandle: sourceHandle ?? "default",
    })),
  };
}
