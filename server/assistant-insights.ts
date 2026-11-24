import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { formatConsoleRoute, type ConsoleRoute } from "../shared/console-route";
import type { AssistantScope } from "../shared/assistant-scope";
import { outcomeDecision } from "../shared/operate-signing-outcomes";
import { taskFormViewFields } from "../shared/task-form-view";
import { inspectWorkflowTaskAction, getWorkflowTask } from "./p1-service";
import { getDataflowRun, getDataflowRunLineage, listDataResourceOptions, listDataflowSchedules } from "./p2-service";
import type { ProjectUser } from "./project-service";
import { analyzeWorkflowDefinition, type WorkflowCompileDiagnostic } from "./workflow-compiler";
import { getWorkflowRun } from "./workflow-engine";
import { inspectWorkflowRunReadiness } from "./workflow-run-readiness";
import { diffWorkflowVersions, getWorkflow } from "./workflow-service";

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const version = z.number().int().positive();
export const assistantScalarFields = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).refine(key => key !== "constructor" && key !== "prototype"),
  z.union([z.boolean(), z.number(), z.string().max(1000)])
);

type Link = { label: string; href: string };
type InsightResult = { message: string; result: unknown; links: Link[] };
type InsightScope = "project" | "workflow" | "run" | "task";

function insight<Shape extends z.ZodRawShape>(
  label: string,
  scope: InsightScope,
  schema: z.ZodObject<Shape>,
  read: (actor: ProjectUser, args: z.output<z.ZodObject<Shape>>, scope: AssistantScope) => Promise<InsightResult>
) {
  return {
    label, scope, schema, fields: Object.keys(schema.shape),
    read: (actor: ProjectUser, args: unknown, scope: AssistantScope) => read(actor, schema.parse(args), scope),
  };
}

function missing(message: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

function workflowLink(workflowId: string, label = "打开流程", view: "detail" | "editor" = "detail"): Link {
  return { label, href: formatConsoleRoute({ section: "flows", view, workflowId }) };
}

export function assistantRunLink(workflowId: string, runId: string): Link {
  return { label: "打开运行实例", href: formatConsoleRoute({ section: "runs", view: "monitor", workflowId, runId }) };
}

function projectLink(projectId: string): Link {
  return { label: "打开业务项目", href: formatConsoleRoute({ section: "flows", view: "workspace", projectId }) };
}

function taskLink(taskId: string): Link {
  return { label: "打开任务", href: formatConsoleRoute({ section: "runs", view: "workbench", taskId }) };
}

function taskOutcomes(value: unknown) {
  const contract = record(typeof value === "string" ? JSON.parse(value) : value);
  if (contract.mode !== "explicit" || !Array.isArray(contract.outcomes))
    return [
      { code: "approved", label: "同意", decision: "approved" as const, requireComment: false },
      { code: "rejected", label: "拒绝", decision: "rejected" as const, requireComment: true },
      { code: "abstained", label: "弃权", decision: "abstained" as const, requireComment: false },
    ];
  return contract.outcomes.map(record).map(outcome => ({
    code: scalar(outcome.code), label: scalar(outcome.label), decision: outcomeDecision(outcome),
    requireComment: outcome.requireComment === true,
  }));
}

const sampleSize = 16;
function selection<T>(values: readonly T[]) {
  return { total: values.length, items: values.slice(0, sampleSize) };
}

function diagnostics(issues: readonly WorkflowCompileDiagnostic[]) {
  return selection(issues.map(issue => ({
    code: issue.code,
    message: issue.message.slice(0, 350),
    location: issue.location,
  })));
}

function nodeHistory<T extends { status: unknown }>(nodes: readonly T[]) {
  const statusCounts: Record<string, number> = Object.create(null);
  for (const node of nodes) {
    const status = String(node.status);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const stages = ["failed", "waiting", "running"];
  return {
    total: nodes.length,
    statusCounts,
    attention: selection(nodes.filter(node => stages.includes(String(node.status))).reverse()),
    recent: selection(nodes.slice(-8).reverse()),
  };
}

function scalar(value: unknown) {
  return typeof value === "string" ? value.slice(0, 160)
    : typeof value === "number" || typeof value === "boolean" || value instanceof Date ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function dataQuality(status: string, output: unknown, error: unknown) {
  const quality = record(record(output).quality);
  if (quality.passed === true) {
    return {
      passed: true,
      rowCount: typeof quality.rowCount === "number" ? quality.rowCount : null,
      nullRate: typeof quality.nullRate === "number" ? quality.nullRate : null,
    };
  }
  if (status !== "failed") return null;
  const message = record(error).message;
  const numbers = typeof message === "string"
    ? /^质量门失败：行数 (\d+)\/(\d+)，空值率 (\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)。$/.exec(message)
    : null;
  return numbers ? {
    passed: false, rowCount: Number(numbers[1]), minRows: Number(numbers[2]),
    nullRate: Number(numbers[3]), maxNullRate: Number(numbers[4]),
  } : { passed: false };
}

export const workspaceInsights = {
  "workflow.checkDraft": insight(
    "检查已保存画布的结构，定位节点、连线和字段问题",
    "workflow", z.strictObject({ workflowId: id }),
    async (actor, { workflowId }) => {
      const workflow = await getWorkflow(workflowId, actor);
      if (!workflow) return missing("流程不存在或无访问权限。");
      const analysis = analyzeWorkflowDefinition(workflow.definition, { flowType: workflow.flowType, executable: true });
      return {
        message: analysis.ok ? "已检查保存的流程画布，结构检查通过。" : "已检查保存的流程画布，发现结构问题。",
        result: {
          workflowId, name: workflow.name, flowType: workflow.flowType, definitionVersion: workflow.definitionVersion,
          ok: analysis.ok, issues: diagnostics(analysis.diagnostics),
        },
        links: [workflowLink(workflowId)],
      };
    }
  ),
  "workflow.preflight": insight(
    "执行只读运行预检，核对版本、运行准入、参与人和资源",
    "workflow", z.strictObject({ workflowId: id, mode: z.enum(["formal", "test"]).default("formal"), input: assistantScalarFields.optional() }),
    async (actor, { workflowId, mode, input }) => {
      const ready = await inspectWorkflowRunReadiness(actor, { workflowId, mode, input });
      return {
        message: ready.canStart ? "已完成运行预检。" : "运行预检发现阻塞项。",
        result: {
          workflowId, mode, canStart: ready.canStart, definitionVersion: ready.definitionVersion,
          executionSource: ready.executionSource, checkedAt: ready.checkedAt, issues: diagnostics(ready.issues),
          participants: selection(ready.checks.map(check => ({ ...check, message: check.message.slice(0, 350) }))),
        },
        links: [workflowLink(workflowId)],
      };
    }
  ),
  "workflow.compareVersions": insight(
    "对比两个已保存版本的节点、连线和变更字段",
    "workflow", z.strictObject({ workflowId: id, fromVersion: version, toVersion: version }),
    async (actor, { workflowId, fromVersion, toVersion }) => {
      const diff = await diffWorkflowVersions(workflowId, fromVersion, toVersion, actor);
      if (!diff) return missing("找不到可比较的流程版本。");
      const edge = ({ id, sourceNodeId, targetNodeId, sourceHandle }: typeof diff.addedEdges[number]) =>
        ({ id, sourceNodeId, targetNodeId, sourceHandle });
      return {
        message: `已对比流程版本 v${fromVersion} 与 v${toVersion}。`,
        result: {
          workflowId, fromVersion, toVersion, summary: diff.summary,
          addedNodes: selection(diff.addedNodes), removedNodes: selection(diff.removedNodes),
          changedNodes: selection(diff.changedNodes), addedEdges: selection(diff.addedEdges.map(edge)),
          removedEdges: selection(diff.removedEdges.map(edge)), changedEdges: selection(diff.changedEdges),
        },
        links: [workflowLink(workflowId)],
      };
    }
  ),
  "workflow.inspectRun": insight(
    "诊断状态/控制流程实例，定位失败、等待节点及审批进度",
    "run", z.strictObject({ runId: id }),
    async (actor, { runId }, scope) => {
      const run = await getWorkflowRun(runId, actor.id);
      if (!run || (scope.workflowId && run.workflowId !== scope.workflowId))
        return missing("运行实例不存在、超出当前对话范围或无权查看。");
      const workflow = await getWorkflow(run.workflowId, actor);
      if (!workflow || (scope.projectId && workflow.projectId !== scope.projectId))
        return missing("运行实例不存在、超出当前对话范围或无权查看。");
      const execution = nodeHistory(run.nodeRuns.map(node => ({
        nodeId: scalar(node.nodeId), name: scalar(node.nodeName), type: scalar(node.nodeType),
        status: scalar(node.status), sequenceNo: scalar(node.sequenceNo), durationMs: scalar(node.durationMs),
        startedAt: scalar(node.startedAt), finishedAt: scalar(node.finishedAt),
      })));
      return {
        message: "已核对实例状态和节点执行记录。",
        result: {
          runId, workflowId: run.workflowId, workflowName: scalar(run.workflowName),
          status: scalar(run.status), definitionVersion: scalar(run.definitionVersion),
          executionSource: scalar(run.executionSource), currentStateName: scalar(run.currentStateName),
          startedAt: scalar(run.startedAt), finishedAt: scalar(run.finishedAt),
          execution, approvalGroups: selection(run.approvalGroups.map(group => ({
            nodeId: group.nodeId, signMode: group.signMode, total: group.total, required: group.required,
            approved: group.approved, rejected: group.rejected,
          }))),
        },
        links: [assistantRunLink(run.workflowId, runId)],
      };
    }
  ),
  "task.inspect": insight(
    "检查指定任务的办理资格、阻塞原因和会签进度",
    "task", z.strictObject({ taskId: z.uuid() }),
    async (actor, { taskId }, scope) => {
      const task = await getWorkflowTask(actor, taskId);
      if (!task || (scope.projectId && task.projectId !== scope.projectId) ||
        (scope.workflowId && task.workflowId !== scope.workflowId))
        return missing("任务不存在、超出当前对话范围或无权查看。");
      const eligibility = await inspectWorkflowTaskAction(actor, taskId, task.workflowId);
      const fields = taskFormViewFields(record(record(task.payload).config).formSchema);
      const metadata = record(task);
      return {
        message: eligibility.canAct ? "已核对任务，当前具备办理资格。" : "已核对任务，当前无法办理。",
        result: {
          taskId, runId: scalar(metadata.runId), nodeId: scalar(metadata.nodeId), workflowId: task.workflowId,
          workflowName: scalar(metadata.workflowName), status: task.displayStatus, runStatus: scalar(metadata.runStatus),
          dueAt: scalar(metadata.dueAt), canAct: eligibility.canAct, reason: eligibility.reason.slice(0, 350),
          approvalProgress: task.approvalProgress,
          outcomes: selection(taskOutcomes(metadata.outcomeHandlesJson)),
          formFields: selection(fields.map(({ key, label, type, required, readOnly }) => ({
            key, label: label.slice(0, 160), type, required, readOnly,
          }))),
        },
        links: [taskLink(taskId)],
      };
    }
  ),
  "data.assetProfile": insight(
    "查看项目活跃数据资产的可读取状态、字段名和可用连接器版本",
    "project", z.strictObject({ projectId: id, assetId: id }),
    async (actor, { projectId, assetId }) => {
      const resources = await listDataResourceOptions(actor, projectId, { includeAssetMetadata: true });
      const asset = resources.assets.find(item => item.value === assetId);
      if (!asset) return missing("活跃资产不存在或不属于此项目。");
      const versions = resources.connectorVersions.filter(item => item.assetId === assetId);
      return {
        message: "已查询数据资产的字段和读取能力。",
        result: {
          projectId, assetId, name: asset.name, readable: !asset.disabled, nativeReadable: asset.nativeReadable,
          fields: selection(asset.fields.map(field => field.slice(0, 160))),
          versions: selection(versions.map(({ id, kind, label, enabled }) => ({ id, kind, label, enabled }))),
        },
        links: [projectLink(projectId)],
      };
    }
  ),
  "data.inspectRun": insight(
    "诊断数据流实例，检查节点处理行数、质量门结果及上下游血缘",
    "run", z.strictObject({ projectId: id, runId: id }),
    async (actor, { projectId, runId }, scope) => {
      const run = await getDataflowRun(actor, { projectId, runId });
      if (!run || (scope.workflowId && run.workflowId !== scope.workflowId))
        return missing("数据流实例不存在、超出当前对话范围或无权查看。");
      const lineage = await getDataflowRunLineage(actor, { projectId, runId });
      const execution = nodeHistory(run.nodeRuns.map(node => ({
        nodeId: node.nodeId, type: node.nodeType, status: node.status,
        sequenceNo: node.sequenceNo, attempt: node.attempt, rows: node.rowCount,
        durationMs: node.durationMs,
        ...(node.nodeType === "quality_gate" ? { quality: dataQuality(node.status, node.output, node.error) } : {}),
      })));
      return {
        message: "已核对数据流实例、质量门与血缘。",
        result: {
          projectId, workflowId: run.workflowId, workflowName: run.workflowName, runId, status: run.status,
          definitionVersion: run.definitionVersion, durationMs: run.durationMs, execution,
          artifacts: selection(lineage.artifacts.map(record).map(artifact => ({
            id: scalar(artifact.id), nodeId: scalar(artifact.nodeId), format: scalar(artifact.format),
            rows: scalar(artifact.rowCount), expiresAt: scalar(artifact.expiresAt),
          }))),
          lineage: selection(lineage.lineage.map(record).map(edge => ({
            sourceNodeId: scalar(edge.sourceNodeId), targetNodeId: scalar(edge.targetNodeId),
            sourceArtifactId: scalar(edge.sourceArtifactId), targetArtifactId: scalar(edge.targetArtifactId),
          }))),
        },
        links: [assistantRunLink(run.workflowId, runId)],
      };
    }
  ),
  "data.workflowSchedule": insight(
    "检查指定数据流程的调度状态、下次运行时间与版本",
    "workflow", z.strictObject({ projectId: id, workflowId: id }),
    async (actor, { projectId, workflowId }) => {
      const schedules = await listDataflowSchedules(actor, projectId);
      const schedule = schedules.find(item => record(item).workflowId === workflowId);
      const metadata = record(schedule);
      return {
        message: schedule ? "已核对数据流程调度。" : "此流程当前没有调度配置。",
        result: {
          projectId, workflowId, schedule: schedule ? {
            status: schedule.status, revision: schedule.revision, schedulerType: scalar(metadata.schedulerType),
            cronExpression: scalar(metadata.cronExpression), nextRunAt: scalar(metadata.nextRunAt),
            taskConfigured: schedule.taskConfigured, activationAvailable: schedule.activationAvailable,
          } : null,
        },
        links: [workflowLink(workflowId)],
      };
    }
  ),
};

export function findWorkspaceInsight(name: string) {
  return Object.hasOwn(workspaceInsights, name) ? workspaceInsights[name as keyof typeof workspaceInsights] : undefined;
}
