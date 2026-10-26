import { TRPCError } from "@trpc/server";
import { getSharedPool } from "./db";
import { getWorkflow, hasWorkflowPermission } from "./workflow-service";
import { getProjectAccess } from "./project-service";
import {
  analyzeWorkflowDefinition,
  assertWorkflowExecutionPlan,
  compileWorkflowDefinition,
  hashWorkflowExecutionPlan,
  type WorkflowCompileDiagnostic,
  type WorkflowDefinition,
  type WorkflowExecutionPlan,
} from "./workflow-compiler";
import { resolveWorkflowExecutionSource } from "../shared/workflow-execution-source";
import { normalizeReferenceOperateConfig } from "../shared/reference-operate-config";
import { previewOperateApproval } from "./workflow-approval-preview";
import { dataflowResourceDiagnostics } from "./dataflow-resource-readiness";

const parse = (value: unknown) =>
  typeof value === "string" ? JSON.parse(value) : value;
type User = Parameters<typeof getWorkflow>[1];
export type ParticipantCheck = {
  nodeId: string;
  name: string;
  status: "checked" | "deferred" | "automatic" | "blocked";
  message: string;
};

/** Uses the real participant resolver, without executing conditions or upstream nodes. */
export async function inspectRunParticipants(
  workflowId: string,
  definition: WorkflowDefinition,
  userId: number,
  input: Record<string, unknown>
) {
  const checks: ParticipantCheck[] = [];
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  const previews = new Map<string, ReturnType<typeof previewOperateApproval>>();
  // A shared first human node is unavoidable only when every side-effect-free path reaches it.
  const immediate = new Set<string>();
  const first = definition.nodes.find(node => node.type === "start");
  const queue = first ? [first] : [];
  const candidates = new Set<string>();
  let uncertain = !first;
  const seen = new Set<string>();
  for (const cursor of queue) {
    if (seen.has(cursor.id)) continue;
    seen.add(cursor.id);
    if (cursor.type === "operate") {
      candidates.add(cursor.id);
      continue;
    }
    if (
      ![
        "start",
        "state",
        "milestone",
        "router",
        "condition",
        "transform",
        "convert",
      ].includes(cursor.type)
    ) {
      uncertain = true;
      continue;
    }
    const edges = definition.edges.filter(
      edge => edge.sourceNodeId === cursor.id
    );
    if (!edges.length || edges.some(edge => edge.loop)) {
      uncertain = true;
      continue;
    }
    for (const edge of edges) {
      const next = definition.nodes.find(node => node.id === edge.targetNodeId);
      if (next) queue.push(next);
      else uncertain = true;
    }
  }
  if (!uncertain && candidates.size === 1) immediate.add(Array.from(candidates)[0]);
  for (const node of definition.nodes) {
    if (node.type !== "operate") continue;
    const reference = normalizeReferenceOperateConfig(node.config);
    const add = (status: ParticipantCheck["status"], message: string) =>
      checks.push({ nodeId: node.id, name: node.name, status, message });
    if (
      reference.autoExecute &&
      !reference.autoExecuteConditions.length &&
      !reference.hasUnsafeAutoExecuteCode
    ) {
      add("automatic", "按配置自动执行，未执行任何节点代码。");
      continue;
    }
    const mode = String(
      node.config.assigneeMode ||
        (node.config.assigneeUserId ? "user" : "receivers")
    );
    const formField = String(node.config.assigneeFormField || "input.userId");
    if (
      reference.autoExecute ||
      !(
        [
          "user",
          "role",
          "department",
          "department_manager",
          "initiator",
          "none",
          "initiator_manager",
          "initiator_manager_n",
        ].includes(mode) ||
        /^initiator_manager_[0-9]+$/.test(mode) ||
        (mode === "form_user" && /^input\./.test(formField))
      )
    ) {
      add("deferred", "依赖前序办理、接收方或运行中数据，到达节点时检查。");
      continue;
    }
    try {
      const key = JSON.stringify(node.config);
      if (!previews.has(key))
        previews.set(
          key,
          previewOperateApproval({
            workflowId,
            config: node.config,
            context: {
              input,
              vars: {},
              nodes: {},
              runtime: {
                triggeredByUserId: userId,
                lastActorUserId: userId,
                receiverUserIds: [],
              },
            },
          })
        );
      const result = await previews.get(key)!;
      add(
        "checked",
        `当前可解析 ${result.totalApprovers} 名处理人${result.fallbackApplied ? "，已使用兜底" : ""}；${result.signModeLabel}。`
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      const message =
        error instanceof Error ? error.message : "无法解析处理人。";
      if (immediate.has(node.id)) {
        add("blocked", message);
        diagnostics.push({
          code: "WF_PARTICIPANTS_UNAVAILABLE",
          message: `“${node.name}”：${message}`,
          location: { kind: "node", nodeId: node.id, field: "assigneeMode" },
        });
      } else
        add(
          "deferred",
          `当前解析未通过：${message} 此节点依赖后续路径，到达时重新检查。`
        );
    }
  }
  return { checks, diagnostics };
}

/** Read-only checkpoint for the exact server version used by run admission. No jobs or external probes. */
export async function inspectWorkflowRunReadiness(
  user: User,
  input: {
    workflowId: string;
    input?: Record<string, unknown>;
    mode: "formal" | "test";
  }
) {
  const workflow = (await getWorkflow(input.workflowId, user)) as
    | (NonNullable<Awaited<ReturnType<typeof getWorkflow>>> & {
        projectStatus?: string;
        auditStatus?: string;
        publishedExecutionPlanJson?: unknown;
        publishedExecutionPlanHash?: string | null;
      })
    | null;
  if (!workflow)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "流程不存在或无访问权限。",
    });
  if (
    workflow.archivedAt ||
    (workflow.projectId && workflow.projectStatus !== "active")
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "流程或所属业务已归档，无法运行。",
    });
  if (workflow.flowType === "data") {
    if (!workflow.projectId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "数据流程缺少所属业务。",
      });
    const access = await getProjectAccess(user, workflow.projectId);
    if (
      !access.exists ||
      !access.permissions.has(
        input.mode === "test" ? "project:workflow:edit" : "project:workflow:run"
      )
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "无权检查此数据流程的运行条件。",
      });
    if (input.mode !== "test" && workflow.status !== "published")
      throw new TRPCError({
        code: "CONFLICT",
        message: "数据流程尚未发布，请使用草稿测试。",
      });
  } else {
    if (!(await hasWorkflowPermission(user, input.workflowId, "workflow:run")))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "无权检查此流程的运行条件。",
      });
    if (
      workflow.projectId &&
      input.mode !== "test" &&
      (workflow.status !== "published" || workflow.auditStatus !== "approved")
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "项目流程尚未发布或审核通过。",
      });
  }
  let executionSource = resolveWorkflowExecutionSource({
    workflowStatus: workflow.status,
    publishedPlan: workflow.publishedExecutionPlanJson,
    publishedPlanHash: workflow.publishedExecutionPlanHash,
  });
  const issues: WorkflowCompileDiagnostic[] = [];
  let checks: ParticipantCheck[] = [];
  let planHash: string | null = null;
  let plan: WorkflowExecutionPlan | undefined;
  try {
    const storedPlan =
      workflow.status === "published"
        ? parse(workflow.publishedExecutionPlanJson)
        : null;
    executionSource = resolveWorkflowExecutionSource({
      workflowStatus: workflow.status,
      publishedPlan: storedPlan,
      publishedPlanHash: workflow.publishedExecutionPlanHash,
    });
    plan =
      executionSource === "published_plan"
        ? assertWorkflowExecutionPlan(
            storedPlan,
            String(workflow.publishedExecutionPlanHash),
            workflow.flowType
          )
        : compileWorkflowDefinition(workflow.definition, {
            flowType: workflow.flowType,
          }).plan;
    planHash = hashWorkflowExecutionPlan(plan);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "diagnostics" in error &&
      Array.isArray(error.diagnostics)
    )
      issues.push(...error.diagnostics);
    else
      issues.push({
        code: "WF_EXECUTION_PLAN_INVALID",
        message: error instanceof Error ? error.message : "执行计划无法读取。",
        location: { kind: "definition" },
      });
  }
  if (plan && planHash) {
    const structural = analyzeWorkflowDefinition(plan.definition, {
      flowType: workflow.flowType,
      executable: true,
    });
    if (!structural.ok) issues.push(...structural.diagnostics);
    else if (workflow.flowType === "data")
      issues.push(
        ...(await dataflowResourceDiagnostics(
          getSharedPool(),
          workflow.projectId!,
          plan.definition
        ))
      );
    else {
      const participants = await inspectRunParticipants(
        input.workflowId,
        plan.definition,
        user.id,
        input.input ?? {}
      );
      checks = participants.checks;
      issues.push(...participants.diagnostics);
    }
  }
  return {
    canStart: issues.length === 0,
    definitionVersion: Number(workflow.definitionVersion),
    planHash,
    executionSource,
    checkedAt: new Date().toISOString(),
    checks,
    issues,
  };
}
