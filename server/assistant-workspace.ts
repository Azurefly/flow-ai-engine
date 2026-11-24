import { createHash } from "node:crypto";
import { callTRPCProcedure, TRPCError, type AnyTRPCRouter } from "@trpc/server";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import type { AssistantScope } from "../shared/assistant-scope";
import { canonicalResourcePayload } from "../shared/resource-creation";
import { formatConsoleRoute } from "../shared/console-route";
import type { TrpcContext } from "./_core/context";
import { getSharedPool } from "./db";
import { getWorkflowTask, inspectWorkflowTaskAction } from "./p1-service";
import { dataflowRunReceipt } from "./p2-service";
import { createFolder, getProjectAccess } from "./project-service";
import { getWorkflow, getWorkflowVersion, hasWorkflowPermission } from "./workflow-service";
import { validateWorkflowTaskSubmission } from "./workflow-engine";
import { inspectWorkflowRunReadiness } from "./workflow-run-readiness";
import { assistantRunLink, assistantScalarFields, findWorkspaceInsight, workspaceInsights } from "./assistant-insights";

// This catalog only includes business procedures which can run with a reauthorized actor.
export type AssistantWorkContext = Pick<TrpcContext, "user" | "requestId">;
export type WorkspaceScope = AssistantScope;
type Scope = "global" | "project" | "workflow" | "task" | "run";
function action(label: string, scope: Scope, fields = "") {
  return { label, scope, fields: fields ? fields.split(" ") : [] };
}
export const workspaceQueries = {
  ...workspaceInsights,
  "task.dashboard": action(
    "我的工作台统计（待办、已办、发起与可见实例）",
    "global"
  ),
  "task.page": action(
    "查询待办、已办、已发起或可见任务",
    "project",
    "view projectId status search createdAtFrom createdAtBefore limit cursor"
  ),
  "task.get": action("查询任务详情", "task", "taskId"),
  "task.assignees": action("查找任务可移交或委托的办理人", "task", "taskId search"),
  "task.instancePage": action(
    "查询流程实例",
    "global",
    "view status search createdAtFrom createdAtBefore limit cursor"
  ),
  "task.calendar": action("查询办理日历", "global", "start end limit cursor"),
  "project.page": action(
    "查找业务项目",
    "global",
    "search status limit page createdFrom createdBefore"
  ),
  "project.get": action("查看项目", "project", "projectId"),
  "project.workflows": action(
    "按类型、状态和审核状态查询项目流程",
    "project",
    "projectId flowType auditStatus status keyword"
  ),
  "project.workflowStatistics": action(
    "统计项目内流程数量、发布与审核状态和运行次数",
    "project",
    "projectId flowType auditStatus status keyword"
  ),
  "project.members": action("查看项目成员", "project", "projectId"),
  "project.activeDomains": action("查看可选业务工作域", "global"),
  "project.units": action("查看项目授权组织", "project", "projectId"),
  "project.warehouse": action(
    "查询流程仓库、目录和流程",
    "project",
    "projectId"
  ),
  "project.lifecyclePreview": action(
    "查看项目生命周期状态",
    "project",
    "projectId"
  ),
  "project.workflowAudit": action(
    "查看流程审核记录",
    "workflow",
    "projectId workflowId"
  ),
  "workflow.get": action("查看流程信息和画布节点连线", "workflow", "id"),
  "workflow.templates": action("查看可用节点模板", "global"),
  "workflow.subflows": action("查看可用子流程", "global"),
  "workflow.versions": action("查看流程版本", "workflow", "workflowId"),
  "workflow.members": action("查看流程成员", "workflow", "workflowId"),
  "workflow.customRoles": action("查看流程角色", "workflow", "workflowId"),
  "workflow.runMetrics": action(
    "统计运行次数、成功、失败、失败率和平均耗时，支持时间区间",
    "workflow",
    "workflowId status from to triggeredByQuery"
  ),
  "workflow.runHistoryPage": action(
    "查询运行历史",
    "workflow",
    "workflowId status from to triggeredByQuery searchQuery pageSize cursor"
  ),
  "workflow.alerts": action(
    "查询流程运行告警",
    "workflow",
    "workflowId status from to"
  ),
  "data.resourceOptions": action("列出项目数据资源", "project", "projectId"),
  "data.flows": action("查询数据流", "project", "projectId"),
  "data.runPage": action(
    "查询数据流运行记录",
    "project",
    "projectId workflowId search status limit cursor"
  ),
  "data.schedules": action("查询数据流调度", "project", "projectId"),
  "config.workDomains": action("查询工作域", "global"),
} as const;
export const workspaceMutations = {
  "project.create": action("创建业务项目", "global", "code name description domainId"),
  "project.createFolder": action(
    "创建流程目录",
    "project",
    "projectId name parentId description"
  ),
  "project.updateFolder": action(
    "修改流程目录",
    "project",
    "projectId folderId name description"
  ),
  "project.moveWorkflow": action(
    "移动流程到目录",
    "workflow",
    "projectId workflowId folderId"
  ),
  "project.updateWorkflowInfo": action(
    "编辑流程名称和说明",
    "workflow",
    "projectId workflowId name description expectedConfigToken"
  ),
  "project.auditWorkflow": action(
    "审核流程",
    "workflow",
    "projectId workflowId expectedDefinitionVersion expectedAuditStatus auditStatus"
  ),
  "project.resetWorkflowAudit": action(
    "重置流程审核",
    "workflow",
    "projectId workflowId expectedDefinitionVersion expectedAuditStatus"
  ),
  "workflow.publish": action(
    "发布现有流程草稿",
    "workflow",
    "id expectedDefinitionVersion"
  ),
  "workflow.unpublish": action(
    "取消流程发布",
    "workflow",
    "id expectedDefinitionVersion"
  ),
  "workflow.duplicate": action(
    "复制流程",
    "workflow",
    "id name expectedDefinitionVersion"
  ),
  "workflow.rollbackVersion": action(
    "恢复历史流程版本为草稿",
    "workflow",
    "workflowId targetVersion expectedDefinitionVersion restoreAsDraft"
  ),
  "workflow.run": action(
    "发起正式流程实例",
    "workflow",
    "workflowId input expectedDefinitionVersion expectedExecutionPlanHash"
  ),
  "task.claim": action("领取待办", "task", "taskId"),
  "task.complete": action("提交任务审批意见", "task", "taskId result"),
  "task.execute": action("办理待领取或本人已领取的审批任务", "task", "taskId result expectedOwnerVersion"),
  "task.handover": action("移交任务", "task", "taskId targetUserId"),
  "task.delegate": action("委托办理", "task", "taskId targetUserId"),
  "task.reassign": action(
    "重新指派任务",
    "task",
    "taskId targetUserId ownerVersion reason"
  ),
  "task.addSigner": action(
    "为任务加签",
    "task",
    "taskId targetUserId memberVersion"
  ),
  "task.removeSigner": action(
    "为任务减签",
    "task",
    "taskId memberTaskId memberVersion"
  ),
  "task.returnToPending": action("退回待领取", "task", "taskId"),
  "data.createTag": action("创建数据标签", "project", "projectId name color"),
  "data.run": action(
    "发起数据流程运行，支持正式或测试模式",
    "workflow",
    "projectId workflowId mode data expectedDefinitionVersion expectedExecutionPlanHash"
  ),
  "data.updateAsset": action(
    "更改数据资产名称或状态",
    "project",
    "projectId assetId name status"
  ),
  "data.saveScheduleDraft": action(
    "保存数据流调度草稿",
    "workflow",
    "projectId workflowId cronExpression expectedRevision"
  ),
  "data.activateSchedule": action(
    "启用调度",
    "workflow",
    "projectId workflowId expectedRevision"
  ),
  "data.pauseSchedule": action(
    "暂停调度",
    "workflow",
    "projectId workflowId expectedRevision"
  ),
  "config.createWorkDomain": action(
    "创建工作域",
    "global",
    "code name description"
  ),
  "config.updateWorkDomain": action(
    "修改工作域",
    "global",
    "id name description status"
  ),
} as const;
type Catalog = Record<string, ReturnType<typeof action>>;
function availableInScope(name: string, op: Catalog[string], role: string, scope: WorkspaceScope) {
  if (name.startsWith("config.") && role !== "admin") return false;
  if (op.scope === "global") return !scope.projectId && !scope.workflowId;
  return op.scope !== "project" || !scope.workflowId || op.fields.includes("workflowId");
}
export function scopedWorkspaceSchema(write: boolean, role: string, scope: WorkspaceScope) {
  const entries = Object.entries(write ? workspaceMutations : workspaceQueries);
  return workspaceSchema(Object.fromEntries(entries.filter(([name,op]) => availableInScope(name, op, role, scope))));
}
export function workspaceSchema(catalog: Catalog) {
  return z.strictObject({
    action: z.enum(Object.keys(catalog) as [string, ...string[]]).describe(
      Object.entries(catalog)
        .map(([key, v]) => key + " " + v.label)
        .join("；")
    ),
    describe: z
      .boolean()
      .optional()
      .describe("只查看该操作的参数定义，不执行或准备操作"),
    arguments: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("按该操作的字段填入条件；ID 必须来自系统，日期使用 ISO 8601"),
  });
}
export type WorkspaceInput = {
  action: string;
  arguments: Record<string, unknown>;
};
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
const deny = (): never => {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "该操作超出当前对话范围或账号权限，请打开目标工作区。",
  });
};
async function router(): Promise<AnyTRPCRouter> {
  return (await import("./routers")).appRouter;
}

// Only these business fields may leave the service. Workflow configs, raw run inputs,
// connection settings, credentials and uploaded data have no representation here.
const valueKeys = new Set(
  "id projectId workflowId taskId runId nodeId userId name label value disabled description code processCode username displayName role roleCode roleName projectName workflowName nodeName stateName taskName folderId parentId status runStatus flowStatus auditStatus flowType assetType type version revision definitionVersion publishedVersion ownerVersion memberVersion infoConfigToken ownerUserId assigneeName assignedName displayStatus canAct canReassign creatorName createdAt updatedAt dueAt startedAt finishedAt completedAt triggeredByName durationMs runCount totalRuns executingRuns waitingRuns successfulRuns failedRuns averageDurationMs durationSamples maxDurationMs failureRate hasMore nextCursor total page limit count todo done initiated all cronExpression color message title decision comment sourceNodeId targetNodeId sourceHandle targetHandle nextRunAt schedulerType taskConfigured activationAvailable actionLabel blockedReason signMode approved rejected decided required completed".split(
    " "
  )
);
const groupKeys = new Set(
  "items rows counts recent folders workflows sources assets tags udfs schedules nodes edges roles members units alerts runs events definition approvalProgress".split(
    " "
  )
);
function projectResult(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 600);
  if (depth > 5 || typeof value !== "object") return null;
  if (Array.isArray(value))
    return value.slice(0, 25).map(item => projectResult(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      (valueKeys.has(key) &&
        (item == null || typeof item !== "object" || item instanceof Date)) ||
      groupKeys.has(key)
    ) {
      out[key] = projectResult(item, depth + 1);
      if (Array.isArray(item) && item.length > 25)
        out[key + "Returned"] = "前25条，共" + item.length + "条";
    }
  }
  return out;
}
async function prepare(
  ctx: AssistantWorkContext,
  scope: WorkspaceScope,
  write: boolean,
  raw: unknown
) {
  if (!ctx.user) return deny();
  const catalog: Catalog = write ? workspaceMutations : workspaceQueries;
  const parsed = workspaceSchema(catalog).parse(raw);
  const op = catalog[parsed.action];
  if (!availableInScope(parsed.action, op, ctx.user.role, scope)) return deny();
  const path = parsed.action;
  const insight = write ? undefined : findWorkspaceInsight(path);
  const app = insight ? undefined : await router();
  const procedure = app?._def.procedures[path];
  const type = write ? "mutation" : "query";
  if (!insight && procedure?._def.type !== type) return bad("操作尚不可用。");
  const schema = insight?.schema ?? procedure?._def.inputs[0] as z.ZodType | undefined;
  const args = { ...parsed.arguments };
  let targetName = "";
  if (parsed.describe) {
    const shape = schema
      ? z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })
      : {};
    const fields = Object.fromEntries(
      Object.entries(shape.properties ?? {}).filter(([key]) =>
        op.fields.includes(key)
      )
    );
    return {
      description: {
        label: op.label,
        properties: fields,
        required: shape.required?.filter(key => op.fields.includes(key)) ?? [],
      },
    };
  }
  if (
    JSON.stringify(args).length > 6000 ||
    Object.keys(args).some(k => !op.fields.includes(k))
  )
    return bad("参数不在此操作支持范围，请使用 describe 查看。");
  if (
    Object.entries(args).some(
      ([key, v]) =>
        v !== null &&
        typeof v === "object" &&
        !["result", "input", "data"].includes(key)
    )
  )
    return bad("该参数需要标量值。");
  if (args.input !== undefined) args.input = assistantScalarFields.parse(args.input);
  if (args.data !== undefined) args.data = assistantScalarFields.parse(args.data);
  if (args.result !== undefined)
    args.result = z
      .object({
        decision: z.enum(["approved", "rejected", "abstained"]),
        comment: z.string().trim().max(2000).optional(),
        outcome: z.string().trim().min(1).max(120).optional(),
      })
      .catchall(z.union([
        z.boolean(), z.number(), z.string().max(1000), z.null(),
        z.array(z.string().max(160)).max(25),
      ]))
      .parse(args.result);
  if (op.fields.includes("projectId") && scope.projectId) {
    if (args.projectId !== undefined && args.projectId !== scope.projectId)
      return deny();
    args.projectId = scope.projectId;
  }
  if (
    op.scope === "workflow" ||
    (op.fields.includes("workflowId") && (args.workflowId || scope.workflowId))
  ) {
    const key = op.fields.includes("workflowId") ? "workflowId" : "id";
    if (
      scope.workflowId &&
      args[key] !== undefined &&
      scope.workflowId !== args[key]
    )
      return deny();
    args[key] ??= scope.workflowId ?? undefined;
    if (typeof args[key] !== "string") return bad("请先查询并指定目标流程。");
    const flow = await getWorkflow(String(args[key]), ctx.user);
    if (
      !flow ||
      (scope.projectId && flow.projectId !== scope.projectId) ||
      (args.projectId && args.projectId !== flow.projectId)
    )
      return deny();
    targetName = flow.name;
    if (op.fields.includes("projectId")) args.projectId ??= flow.projectId;
    if (write && op.fields.includes("expectedDefinitionVersion"))
      args.expectedDefinitionVersion ??= flow.definitionVersion;
    if (write && op.fields.includes("expectedConfigToken"))
      args.expectedConfigToken ??= flow.infoConfigToken;
    if (path === "workflow.rollbackVersion") {
      if (!(await hasWorkflowPermission(ctx.user, flow.id, "workflow:edit")) ||
        (flow.status === "published" && !(await hasWorkflowPermission(ctx.user, flow.id, "workflow:publish"))))
        return deny();
      const targetVersion = z.number().int().positive().parse(args.targetVersion);
      if (!(await getWorkflowVersion(flow.id, targetVersion, ctx.user))) return bad("找不到要恢复的历史版本。");
      args.restoreAsDraft = true;
      if (flow.status === "published") targetName += " · 将撤回发布并恢复为草稿";
    }
    if (path === "data.workflowSchedule" && flow.flowType !== "data") return bad("目标不是数据流程。");
    if (path === "workflow.run" || path === "data.run") {
      if (path === "data.run" && flow.flowType !== "data") return bad("目标不是数据流程。");
      const mode = path === "data.run"
        ? z.enum(["formal", "test"]).parse(args.mode ?? "formal")
        : "formal";
      if (path === "data.run") args.mode = mode;
      const ready = await inspectWorkflowRunReadiness(ctx.user, {
        workflowId: flow.id,
        input: (path === "data.run" ? args.data : args.input) as Record<string, unknown> | undefined,
        mode,
      });
      if (!ready.canStart)
        return bad(
          "流程未通过启动预检：" +
            ready.issues
              .map(issue => issue.message)
              .slice(0, 3)
              .join("；")
        );
      if (
        args.expectedExecutionPlanHash &&
        args.expectedExecutionPlanHash !== ready.planHash
      )
        return bad("流程已变更，请重新预览。");
      if (ready.planHash) args.expectedExecutionPlanHash = ready.planHash;
    }
  }
  if (op.scope === "task" && !insight) {
    const taskId = z.string().uuid().parse(args.taskId);
    const task = await getWorkflowTask(ctx.user, taskId);
    if (
      !task ||
      (scope.projectId && task.projectId !== scope.projectId) ||
      (scope.workflowId && task.workflowId !== scope.workflowId)
    )
      return deny();
    if (write && parsed.action === "task.complete" && !task.canAct)
      return deny();
    if (path === "task.execute") {
      const eligibility = await inspectWorkflowTaskAction(ctx.user, taskId, task.workflowId);
      if (!eligibility.canAct) return bad(eligibility.reason);
      const input = z.record(z.string(), z.unknown()).parse(args.result);
      if (Object.keys(input).some(key => /^(?:__proto__|constructor|prototype)$/.test(key)))
        return bad("表单包含无效字段。");
      validateWorkflowTaskSubmission(task, input);
      const row: Record<string, unknown> = task;
      const ownerVersion = Number(row.ownerVersion);
      if (args.expectedOwnerVersion !== undefined && args.expectedOwnerVersion !== ownerVersion)
        return bad("任务分配已变化，请重新预览。");
      args.expectedOwnerVersion = ownerVersion;
      targetName = [row.workflowName, row.nodeName].filter(Boolean).join(" · ");
    }
  }
  if (typeof args.projectId === "string") {
    const access = await getProjectAccess(ctx.user, args.projectId);
    if (!access.permissions.has("project:view")) return deny();
    if (
      [
        "project.createFolder",
        "project.updateFolder",
        "project.moveWorkflow",
      ].includes(parsed.action) &&
      !access.permissions.has("project:workflow:edit")
    )
      return deny();
  }
  if (!write && op.fields.includes("limit"))
    args.limit = z
      .number()
      .int()
      .min(1)
      .max(25)
      .parse(args.limit ?? 15);
  if (!write && op.fields.includes("pageSize"))
    args.pageSize = z
      .number()
      .int()
      .min(1)
      .max(25)
      .parse(args.pageSize ?? 15);
  const input = schema ? args : undefined;
  if (insight) return { readInsight: () => insight.read(ctx.user!, args, scope) };
  if (schema) await schema.parseAsync(input);
  const execute = (actionKey?: string): Promise<unknown> =>
    callTRPCProcedure({
      router: app!,
      ctx,
      path,
      type,
      getRawInput: async () => actionKey && input ? {
        ...input, ...(path === "workflow.run" || path === "data.run" ? { idempotencyKey: actionKey } :
          path === "data.createTag" || path === "workflow.duplicate" ? { requestKey: actionKey } : {}),
      } : input,
      signal: undefined,
    });
  return {
    label: op.label,
    targetName,
    input: { action: parsed.action, arguments: args },
    execute,
  };
}

const fieldLabels: Record<string, string> = {
  projectId: "项目 ID",
  workflowId: "流程 ID",
  taskId: "任务 ID",
  id: "对象 ID",
  folderId: "目录 ID",
  parentId: "上级目录 ID",
  name: "名称",
  description: "说明",
  code: "代号",
  color: "颜色",
  assetId: "数据资产 ID",
  status: "状态",
  result: "办理意见",
  targetUserId: "接收人 ID",
  reason: "原因",
  memberTaskId: "会签任务 ID",
  input: "启动参数",
  auditStatus: "审核结论",
  expectedAuditStatus: "当前审核状态",
  expectedDefinitionVersion: "流程版本",
  expectedConfigToken: "配置校验值",
  expectedExecutionPlanHash: "执行计划校验值",
  expectedRevision: "调度版本",
  memberVersion: "会签成员版本",
  ownerVersion: "办理人版本",
  expectedOwnerVersion: "办理人版本",
  cronExpression: "调度表达式",
  targetVersion: "恢复版本",
  restoreAsDraft: "恢复为草稿",
  mode: "运行模式",
  data: "启动参数",
};
export async function prepareWorkspace(
  ctx: AssistantWorkContext,
  scope: WorkspaceScope,
  write: boolean,
  raw: unknown
) {
  const res = await prepare(ctx, scope, write, raw);
  if (res.readInsight) return { kind: "read" as const, ...await res.readInsight() };
  if (res.description)
    return {
      kind: "read" as const,
      message: "已查询操作参数。",
      result: res.description,
      links: [],
    };
  if (write)
    return {
      kind: "proposal" as const,
      proposal: {
        tool: "workspaceWrite" as const,
        title: res.label,
        summary: res.targetName || "确认后按当前账号权限执行一次",
        details: Object.entries(res.input.arguments).map(
          ([k, v]) =>
            (fieldLabels[k] ?? k) +
            " · " +
            (typeof v === "string" ? v : JSON.stringify(v))
        ),
        payload: { input: res.input, scope },
      },
    };
  const value = await res.execute();
  const result =
    res.input.action === "project.workflowStatistics"
      ? value
      : Array.isArray(value)
        ? {
            totalMatched: value.length,
            items: projectResult(value),
            returned: Math.min(25, value.length),
          }
        : projectResult(value);
  const args = res.input.arguments;
  const links =
    typeof args.taskId === "string"
      ? [
          {
            label: "打开任务",
            href: formatConsoleRoute({
              section: "runs",
              view: "workbench",
              taskId: args.taskId,
            }),
          },
        ]
      : res.targetName
        ? [
            {
              label: res.targetName,
              href: formatConsoleRoute({
                section: "flows",
                view: "detail",
                workflowId: String(args.workflowId ?? args.id),
              }),
            },
          ]
        : typeof args.projectId === "string"
          ? [
              {
                label: "打开业务项目",
                href: formatConsoleRoute({
                  section: "flows",
                  view: "workspace",
                  projectId: args.projectId,
                }),
              },
            ]
          : [];
  if (["task.page", "workflow.runHistoryPage", "data.runPage"].includes(res.input.action)) {
    const items = value && typeof value === "object" && "items" in value && Array.isArray(value.items)
      ? value.items : [];
    for (const item of items.slice(0, 4)) {
      if (typeof item?.id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(item.id)) continue;
      if (res.input.action === "task.page") {
        links.push({
          label: `任务 · ${String(item.nodeName ?? item.id.slice(0, 8)).slice(0, 60)}`,
          href: formatConsoleRoute({ section: "runs", view: "workbench", taskId: item.id }),
        });
      } else {
        const workflowId = args.workflowId ?? item.workflowId;
        if (typeof workflowId === "string") links.push({
          ...assistantRunLink(workflowId, item.id),
          label: `运行 · ${item.id.slice(0, 8)}`,
        });
      }
    }
  }
  return {
    kind: "read" as const,
    message: "已查询：" + res.label,
    result,
    links,
  };
}

function workspaceReceipt(input: WorkspaceInput, message: string) {
  const { taskId, workflowId } = input.arguments;
  const runId = /^已提交(?:数据流程)?运行。运行 ID：([A-Za-z0-9_-]{8,64})[，。]/.exec(message)?.[1];
  if (runId && typeof workflowId === "string")
    return { message, links: [assistantRunLink(workflowId, runId)] };
  if (typeof taskId === "string")
    return { message, links: [{ label: "打开任务", href: formatConsoleRoute({ section: "runs", view: "workbench", taskId }) }] };
  if (input.action === "workflow.rollbackVersion" && typeof workflowId === "string")
    return { message, links: [{ label: "打开恢复后的流程草稿", href: formatConsoleRoute({ section: "flows", view: "editor", workflowId }) }] };
  return { message };
}

// A receipt is reserved before dispatch. An interruption between the business commit
// and acknowledgement leaves a detectable uncertain result and never redispatches it.
export async function commitWorkspace(
  ctx: AssistantWorkContext,
  scope: WorkspaceScope,
  input: WorkspaceInput,
  key: string
) {
  if (!ctx.user) return deny();
  const db = getSharedPool();
  const hash = createHash("sha256")
    .update(canonicalResourcePayload({ user: ctx.user.id, input, scope }))
    .digest("hex");
  async function findReceipt() {
    const [rows] = await db.query<RowDataPacket[]>(
      "SELECT payloadHash,message FROM assistant_action_receipt WHERE id=?",
      [key]
    );
    if (!rows[0]) return null;
    if (rows[0].payloadHash !== hash) return deny();
    const op = (workspaceMutations as Catalog)[input.action];
    if (!op || !availableInScope(input.action, op, ctx.user!.role, scope)) return deny();
    if (op.scope === "task") {
      const taskId = input.arguments.taskId;
      const task = typeof taskId === "string" ? await getWorkflowTask(ctx.user!, taskId) : null;
      if (!task || (scope.projectId && task.projectId !== scope.projectId) ||
        (scope.workflowId && task.workflowId !== scope.workflowId)) return deny();
    } else {
      const project = scope.projectId ?? input.arguments.projectId;
      if (typeof project === "string" && !(await getProjectAccess(ctx.user!, project, { includeArchived: true })).permissions.has("project:view")) return deny();
      const workflow = scope.workflowId ?? input.arguments.workflowId ?? (op.scope === "workflow" ? input.arguments.id : null);
      if (typeof workflow === "string" && !(await getWorkflow(workflow, ctx.user!))) return deny();
    }
    if (rows[0].message === "!rejected") return bad("原业务请求已被拒绝，请重新预览。");
    if (!rows[0].message) {
      let message: string | undefined;
      const args = input.arguments;
      if (input.action === "workflow.run" && typeof args.workflowId === "string") {
        const [runs] = await db.query<RowDataPacket[]>("SELECT runId FROM workflow_run_job WHERE idempotencyKey=?",
          [`workflow:start:${args.workflowId}:${ctx.user!.id}:${key}`]);
        if (runs[0]) message = "已提交运行。运行 ID：" + runs[0].runId + "，可在流程运行历史中查看进度。";
      }
      if (input.action === "data.run" && typeof args.projectId === "string" && typeof args.workflowId === "string") {
        const run = await dataflowRunReceipt(ctx.user!, {
          projectId: args.projectId, workflowId: args.workflowId,
          mode: args.mode === "test" ? "test" : "formal", idempotencyKey: key,
        });
        if (run) message = "已提交数据流程运行。运行 ID：" + run.runId + "，可打开实例查看进度。";
      }
      if (input.action === "data.createTag" && typeof args.projectId === "string") {
        const [tags] = await db.query<RowDataPacket[]>(
          "SELECT resourceId FROM resource_creation_request WHERE resourceKind='tag' AND actorUserId=? AND projectId=? AND requestKeyHash=?",
          [ctx.user!.id, args.projectId, createHash("sha256").update(key).digest("hex")]);
        if (tags[0]) message = "已执行：创建数据标签（" + tags[0].resourceId + "）。";
      }
      if (input.action === "workflow.duplicate" && typeof args.id === "string") {
        const [copies] = await db.query<RowDataPacket[]>(
          "SELECT workflowId FROM workflow_creation_request WHERE actorUserId=? AND requestKind='duplicate' AND requestKeyHash=?",
          [ctx.user!.id, createHash("sha256").update(key).digest("hex")]);
        if (copies[0]) message = "已执行：复制流程（" + copies[0].workflowId + "）。";
      }
      if (!message) throw new WorkspaceOutcomeUnknown();
      await db.execute("UPDATE assistant_action_receipt SET message=? WHERE id=? AND payloadHash=? AND message IS NULL", [message, key, hash]);
      return workspaceReceipt(input, message);
    }
    return workspaceReceipt(input, String(rows[0].message));
  }
  const existing = await findReceipt();
  if (existing) return existing;
  const res = await prepare(ctx, scope, true, input);
  if (!res.execute) return bad("无效的业务提案。");
  if (input.action === "project.createFolder") {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("INSERT INTO assistant_action_receipt (id,payloadHash) VALUES (?,?)", [key,hash]);
      const args = res.input!.arguments as Parameters<typeof createFolder>[1];
      const folderId = await createFolder(ctx.user, args, connection);
      const message = "已执行：" + res.label + "（" + folderId + "）。";
      await connection.execute("UPDATE assistant_action_receipt SET message=? WHERE id=?", [message,key]);
      await connection.commit();
      return { message };
    } catch (error) {
      await connection.rollback();
      if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
        const prior = await findReceipt();
        if (prior) return prior;
        return bad("同名目录已经存在。");
      }
      throw error;
    } finally { connection.release(); }
  }
  try {
    await db.execute(
      "INSERT INTO assistant_action_receipt (id,payloadHash) VALUES (?,?)",
      [key, hash]
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "ER_DUP_ENTRY") throw e;
    const receipt = await findReceipt();
    if (receipt) return receipt;
    throw new WorkspaceOutcomeUnknown();
  }
  let value: unknown;
  try {
    value = await res.execute(key);
  } catch (e) {
    if (
      e instanceof TRPCError &&
      [
        "FORBIDDEN",
        "BAD_REQUEST",
        "PRECONDITION_FAILED",
        "NOT_FOUND",
        "CONFLICT",
        "UNAUTHORIZED",
      ].includes(e.code)
    ) {
      await db.execute("UPDATE assistant_action_receipt SET message='!rejected' WHERE id=? AND payloadHash=? AND message IS NULL", [key,hash]);
      throw e;
    }
    throw new WorkspaceOutcomeUnknown();
  }
  if (
    value === false ||
    (value &&
      typeof value === "object" &&
      "success" in value &&
      value.success === false)
  ) {
    await db.execute("UPDATE assistant_action_receipt SET message='!rejected' WHERE id=? AND payloadHash=? AND message IS NULL", [key,hash]);
    return bad("业务操作未生效，请检查目标状态。");
  }
  const id =
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
      ? value.id
      : null;
  const runId = value && typeof value === "object" && "runId" in value && typeof value.runId === "string" ? value.runId : undefined;
  const message = runId && (input.action === "workflow.run" || input.action === "data.run")
    ? (input.action === "data.run" ? "已提交数据流程运行。运行 ID：" : "已提交运行。运行 ID：") + runId + "，可打开实例查看进度。"
    : "已执行：" + res.label + (id ? "（" + id + "）" : "") + "。";
  await db.execute(
    "UPDATE assistant_action_receipt SET message=? WHERE id=? AND payloadHash=?",
    [message, key, hash]
  );
  return workspaceReceipt(input, message);
}
export class WorkspaceOutcomeUnknown extends Error {}
