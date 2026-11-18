import { TRPCError } from "@trpc/server";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { formatConsoleRoute } from "../shared/console-route";
import { resourceRequestKeyPattern } from "../shared/resource-creation";
import type { Tool } from "./_core/llm";
import { getSharedPool } from "./db";
import {
  getP1SystemSettings,
  listWorkflowTasks,
  updateP1SystemSetting,
} from "./p1-service";
import {
  createProjectWorkflow,
  getProject,
  getProjectAccess,
  listProjectPage,
  type ProjectUser,
} from "./project-service";
import { mergeSystemSettingValue } from "./system-setting-config";
import {
  analyzeWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./workflow-compiler";
import { listWorkflows } from "./workflow-service";

const text = (limit: number) => z.string().trim().min(1).max(limit);
const projectId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const nodeId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/);
const nodeBase = { id: nodeId, name: text(80) };
const operators = {
  equals: "等于",
  notEquals: "不等于",
  greaterThan: "大于",
  lessThan: "小于",
  contains: "包含",
} as const;
const assignees = {
  initiator: "发起人",
  initiator_manager: "发起人的直属主管",
  department_manager: "发起人所在部门的负责人",
  role: "权限角色",
} as const;
const graphNode = z.union([
  z.strictObject({ ...nodeBase, type: z.enum(["start", "end", "state"]) }),
  z.strictObject({
    ...nodeBase,
    type: z.literal("operate"),
    assignee: z.enum([
      "initiator",
      "initiator_manager",
      "department_manager",
      "role",
    ]),
    role: text(100).optional(),
    instruction: text(300).optional(),
  }),
  z.strictObject({
    ...nodeBase,
    type: z.literal("condition"),
    field: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
      .describe("运行输入字段名，如 amount"),
    operator: z.enum([
      "equals",
      "notEquals",
      "greaterThan",
      "lessThan",
      "contains",
    ]),
    value: z.union([z.number(), text(120), z.boolean()]),
  }),
]);
const edge = z.strictObject({
  from: nodeId,
  to: nodeId,
  branch: z.enum(["true", "false", "approved", "rejected"]).optional(),
});
const taskQuery = z.strictObject({
  limit: z.number().int().min(1).max(20).optional(),
});
const workflowQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
const workflowInput = z.strictObject({
  projectId: projectId.optional(),
  projectName: text(160).optional(),
  name: text(160),
  description: text(1200).optional(),
  flowType: z.enum(["control", "state"]),
  nodes: z.array(graphNode).min(3).max(32),
  edges: z.array(edge).min(2).max(60),
});
const watermarkInput = z.strictObject({
  enabled: z.boolean().optional(),
  text: z.string().trim().max(120).optional(),
});

function tool(name: string, description: string, schema: z.ZodObject): Tool {
  const { $schema, ...parameters } = z.toJSONSchema(schema);
  return { type: "function", function: { name, description, parameters } };
}
export const assistantToolDefinitions: Tool[] = [
  tool(
    "listMyTasks",
    "查询登录客户本人的待办；会话有项目时仅查该项目。",
    taskQuery
  ),
  tool(
    "listMyCompletedTasks",
    "查询登录客户本人已经办理完成的任务（我的已办），会话有项目时仅查该项目。每条结果含完成时间和任务详情入口。",
    taskQuery
  ),
  tool(
    "searchWorkflows",
    "搜索登录客户可见的流程，返回匹配的流程与详情入口。",
    workflowQuery
  ),
  tool(
    "createWorkflowDraft",
    "生成并校验项目内状态或控制流程草稿预览，等待客户确认。当前项目优先；无当前项目时提供业务项目完整名称或真实 ID。按业务顺序给出节点和连线。开始和结束各一个；condition 的 true、false 分支各一条；operate 的处理人必须来自客户要求，按角色时 role 填真实角色名或代号。默认拒绝会取消流程，另有拒绝去向时同时连 approved、rejected 两条边。调整审批人或门槛时重发完整新图。信息不足先追问。",
    workflowInput
  ),
  tool(
    "updateWatermark",
    "为管理员预览平台水印开关或文字修改。只提供用户要求修改的字段；确认后对全平台生效。",
    watermarkInput
  ),
];

type WorkflowInput = z.infer<typeof workflowInput>;
type WatermarkInput = z.infer<typeof watermarkInput>;
type Preview = { title: string; summary: string; details: string[] };
export type AssistantToolProposal = Preview &
  (
    | {
        tool: "createWorkflowDraft";
        payload: {
          input: WorkflowInput;
          projectId: string;
          definition: WorkflowDefinition;
        };
      }
    | {
        tool: "updateWatermark";
        payload: { input: WatermarkInput; expectedConfigToken: string };
      }
  );
type ToolLink = { label: string; href: string };
type PreparedTool =
  | { kind: "read"; message: string; result: unknown; links: ToolLink[] }
  | { kind: "proposal"; proposal: AssistantToolProposal };
type Context = { projectId?: string | null };
function bad(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function forbidden(message: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}
function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args);
  if (!result.success)
    bad(
      "工具参数无效。" +
        result.error.issues
          .slice(0, 5)
          .map(issue => issue.path.join(".") + " " + issue.message)
          .join("；")
    );
  return result.data;
}
async function targetProject(
  actor: ProjectUser,
  input: WorkflowInput,
  context: Context
) {
  if (
    context.projectId &&
    input.projectId &&
    input.projectId !== context.projectId
  )
    bad("此对话绑定了其他业务项目，请在目标项目发起对话。");
  let id = context.projectId ?? input.projectId;
  if (!id) {
    if (!input.projectName)
      bad("请提供目标业务项目名称，或从目标项目打开助手。");
    const page = await listProjectPage(actor, {
      search: input.projectName,
      limit: 50,
    });
    const matches = page.items.filter(
      item => item.name === input.projectName || item.code === input.projectName
    );
    if (matches.length !== 1 || page.hasMore)
      bad("无法唯一确定有权访问的业务项目，请在目标项目打开助手。");
    id = String(matches[0].id);
  }
  const access = await getProjectAccess(actor, id);
  if (!access.permissions.has("project:workflow:create"))
    forbidden("当前账号无权在该项目创建流程。");
  const project = await getProject(actor, id);
  if (!project) forbidden("当前账号无法访问此项目。");
  if (
    input.projectName &&
    input.projectName !== project.name &&
    input.projectName !== project.code
  )
    bad("指定项目名称与当前业务项目不一致。");
  return { id, name: String(project.name) };
}

async function findRole(name: string) {
  const [roles] = await getSharedPool().query<RowDataPacket[]>(
    "SELECT code,name FROM iam_role WHERE code=? OR name=? LIMIT 2",
    [name, name]
  );
  if (roles.length !== 1)
    bad(
      `无法唯一匹配审批角色“${name}”，请提供系统中已有角色的准确名称或代号。`
    );
  return { name: String(roles[0].name), code: String(roles[0].code) };
}

/** Position the graph in dependency order; parallel branches occupy separate rows. */
function layout(nodes: WorkflowNode[], edges: WorkflowDefinition["edges"]) {
  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const levels = new Map<string, number>();
  const rows = new Map<number, number>();
  for (const edge of edges)
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
  const ready = nodes.filter(node => !incoming.get(node.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of ready) {
    const level = levels.get(node.id) ?? 0;
    const row = rows.get(level) ?? 0;
    node.position = { x: level * 280, y: row * 190 };
    rows.set(level, row + 1);
    for (const next of edges.filter(edge => edge.sourceNodeId === node.id)) {
      const target = byId.get(next.targetNodeId);
      if (!target) continue;
      levels.set(target.id, Math.max(level + 1, levels.get(target.id) ?? 0));
      incoming.set(target.id, incoming.get(target.id)! - 1);
      if (!incoming.get(target.id)) ready.push(target);
    }
  }
}

async function buildDraft(input: WorkflowInput) {
  const nodes: WorkflowNode[] = [];
  const details: string[] = [];
  const roles = new Map<string, Awaited<ReturnType<typeof findRole>>>();
  for (const node of input.nodes) {
    const config: Record<string, unknown> = {};
    let description = node.name;
    if (node.type === "operate") {
      Object.assign(config, {
        nodeDh: node.id,
        czmc: node.name,
        assigneeMode: node.assignee,
        assigneeFallback: "error",
        instruction: node.instruction ?? node.name,
      });
      let assignee: string = assignees[node.assignee];
      if (node.assignee === "role") {
        if (!node.role) bad(`请补充“${node.name}”的处理角色。`);
        const role = roles.get(node.role) ?? (await findRole(node.role));
        roles.set(node.role, role);
        config.assigneeRoleCode = role.code;
        assignee = `${role.name}（${role.code}）`;
      } else if (node.role)
        bad(`“${node.name}”指定角色时须选择 role 处理方式。`);
      if (
        input.edges.some(
          edge =>
            edge.from === node.id &&
            (edge.branch === "approved" || edge.branch === "rejected")
        )
      ) {
        config.outcomeMode = "explicit";
        config.outcomes = [
          {
            code: "approved",
            label: "同意",
            sourceHandle: "approved",
            decision: "approved",
          },
          {
            code: "rejected",
            label: "拒绝",
            sourceHandle: "rejected",
            decision: "rejected",
            requireComment: true,
          },
        ];
      } else config.outcomeMode = "legacy_cancel";
      description +=
        ` · 办理人：${assignee}` +
        (node.instruction ? ` · ${node.instruction}` : "");
    } else if (node.type === "condition") {
      if (
        ["greaterThan", "lessThan"].includes(node.operator) &&
        typeof node.value !== "number"
      )
        bad(`“${node.name}”的数值条件必须提供数字。`);
      if (node.operator === "contains" && typeof node.value !== "string")
        bad(`“${node.name}”的包含条件必须提供文字。`);
      Object.assign(config, {
        left: "{{input." + node.field + "}}",
        operator: node.operator,
        right: node.value,
      });
      description += ` · 输入 ${node.field} ${operators[node.operator]} ${node.value}`;
    } else if (node.type === "state") {
      Object.assign(config, {
        nodeDh: node.id,
        jdmc: node.name,
        flowStatus: node.name,
        stateType: "business",
      });
    }
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      position: { x: 0, y: 0 },
      config,
    });
    details.push(description);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const branchNames = {
    true: "成立",
    false: "不成立",
    approved: "同意",
    rejected: "拒绝",
  };
  const edges = input.edges.map((edge, index) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) bad("连线指向不存在的节点。");
    const allowedBranch =
      from.type === "condition"
        ? ["true", "false"]
        : from.type === "operate"
          ? ["approved", "rejected"]
          : [];
    if (edge.branch && !allowedBranch.includes(edge.branch))
      bad(`“${from.name}”不支持该连线分支。`);
    details.push(
      `${from.name}${edge.branch ? "（" + branchNames[edge.branch] + "）" : ""} → ${to.name}`
    );
    return {
      id: "edge-" + (index + 1),
      sourceNodeId: from.id,
      targetNodeId: to.id,
      ...(edge.branch ? { sourceHandle: edge.branch } : {}),
    };
  });
  layout(nodes, edges);
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.85 },
    settings: {},
  };
  const result = analyzeWorkflowDefinition(definition, {
    flowType: input.flowType,
    executable: true,
  });
  if (!result.ok)
    bad(
      result.diagnostics
        .slice(0, 6)
        .map(item => item.message)
        .join("；")
    );
  if (roles.size)
    details.push("审批角色按运行时有效授权分配；无人获授权时该节点将报错。");
  return { definition, details };
}

function watermarkPatch(input: WatermarkInput) {
  return {
    ...(input.enabled === undefined ? {} : { watermarkEnabled: input.enabled }),
    ...(input.text === undefined ? {} : { watermarkText: input.text }),
  };
}

export async function prepareAssistantTool(
  actor: ProjectUser,
  name: string,
  args: unknown,
  context: Context
): Promise<PreparedTool> {
  if (name === "listMyTasks" || name === "listMyCompletedTasks") {
    const input = parse(taskQuery, args);
    const completed = name === "listMyCompletedTasks";
    const rows = await listWorkflowTasks(actor, {
      view: completed ? "done" : "todo",
      projectId: context.projectId ?? undefined,
      summaryOnly: true,
      limit: input.limit ?? 10,
    });
    const result = rows.map(row => ({
      id: String(row.id),
      nodeName: String(row.nodeName),
      workflowId: String(row.workflowId),
      workflowName: String(row.workflowName),
      status: String(row.status),
      ...(completed ? { completedAt: row.completedAt ?? null } : { dueAt: row.dueAt ?? null }),
    }));
    const links = result.map(task => ({
      label: task.workflowName + " · " + task.nodeName + (completed ? " · 查看已办" : " · 打开待办"),
      href: formatConsoleRoute({
        section: "runs",
        view: "workbench",
        taskId: task.id,
      }),
    }));
    return { kind: "read", message: completed ? "已查询我的已办。" : "已查询我的待办。", result, links };
  }
  if (name === "searchWorkflows") {
    const input = parse(workflowQuery, args);
    const rows = await listWorkflows(actor, {
      search: input.search,
      projectId: context.projectId ?? undefined,
      summaryOnly: true,
      offset: 0,
      limit: input.limit ?? 10,
    });
    const result = rows.map(({ id, name, status, flowType }) => ({
      id,
      name,
      status,
      flowType,
    }));
    return {
      kind: "read",
      message: "已查询可见流程。",
      result,
      links: result.map(item => ({
        label: item.name,
        href: formatConsoleRoute({
          section: "flows",
          view: "detail",
          workflowId: item.id,
        }),
      })),
    };
  }
  if (name === "createWorkflowDraft") {
    const input = parse(workflowInput, args);
    const project = await targetProject(actor, input, context);
    const draft = await buildDraft(input);
    return {
      kind: "proposal",
      proposal: {
        tool: name,
        title: `创建“${input.name}”草稿`,
        summary: `${project.name} · ${input.flowType === "state" ? "状态流程" : "控制流程"} · ${draft.definition.nodes.length} 个节点，${draft.definition.edges.length} 条连线`,
        details: [
          ...(input.description ? [input.description] : []),
          ...draft.details,
        ],
        payload: { input, projectId: project.id, definition: draft.definition },
      },
    };
  }
  if (name === "updateWatermark") {
    if (actor.role !== "admin") forbidden("仅系统管理员可以修改平台水印。");
    const input = parse(watermarkInput, args);
    if (input.enabled === undefined && input.text === undefined)
      bad("请说明要调整的水印文字或开关。");
    const { general, configTokens } = await getP1SystemSettings();
    const next = mergeSystemSettingValue(
      "general",
      general,
      watermarkPatch(input)
    );
    return {
      kind: "proposal",
      proposal: {
        tool: name,
        title: "修改平台水印",
        summary: "作用范围为整个平台",
        details: [
          `水印开关：${general.watermarkEnabled ? "开启" : "关闭"} → ${next.watermarkEnabled ? "开启" : "关闭"}`,
          `水印文字：${general.watermarkText || "（空）"} → ${next.watermarkText || "（空）"}`,
        ],
        payload: { input, expectedConfigToken: configTokens.general },
      },
    };
  }
  bad("助手工具不存在。");
}

export async function commitAssistantTool(
  actor: ProjectUser,
  proposal: AssistantToolProposal,
  requestKey: string
): Promise<{ message: string; workflowId?: string; projectId?: string }> {
  if (proposal.tool === "createWorkflowDraft") {
    if (!resourceRequestKeyPattern.test(requestKey)) bad("草稿确认标识无效。");
    const { input, projectId, definition } = proposal.payload;
    const created = await createProjectWorkflow(actor, {
      projectId,
      requestKey,
      name: input.name,
      description: input.description,
      flowType: input.flowType,
      definition,
    });
    return {
      message: `已创建流程草稿“${created.name}”。`,
      workflowId: created.id,
      projectId,
    };
  }
  if (proposal.tool !== "updateWatermark") bad("待确认工具无效。");
  if (actor.role !== "admin") forbidden("仅系统管理员可以修改平台水印。");
  const receipt = await updateP1SystemSetting(
    actor,
    "general",
    watermarkPatch(proposal.payload.input),
    proposal.payload.expectedConfigToken,
    undefined,
    requestKey
  );
  return {
    message: receipt.replayed ? "此水印提案已确认并保存。" : "平台水印已保存。",
  };
}
