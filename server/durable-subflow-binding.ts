import type mysql from "mysql2/promise";
import {
  childCallOptions,
  isDurableSubflow,
  maxDurableCallSites,
} from "../shared/durable-subflow";
import { isParticipantStateDefinition } from "../shared/participant-state";
import { getSharedPool } from "./db";
import { getWorkflowAccess } from "./iam-service";
import {
  assertWorkflowExecutionPlan,
  WorkflowCompileError,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./workflow-compiler";

function diagnostic(node: WorkflowNode, message: string): never {
  throw new WorkflowCompileError([
    {
      code: "WF_DURABLE_SUBFLOW_TARGET",
      message,
      location: { kind: "node", nodeId: node.id, field: "config.subflowId" },
    },
  ]);
}

export function assertDurableAdmission(definition: WorkflowDefinition) {
  if (process.env.FLOW_DURABLE_SUBFLOW_ADMISSION !== "false") return;
  const call = definition.nodes.find(isDurableSubflow);
  if (call)
    diagnostic(
      call,
      "运维已暂停新持久父流程的发布和发起。正在运行的父子实例会继续处理。"
    );
}

export async function loadPublishedChild(
  node: WorkflowNode,
  parentWorkflowId: string,
  actorId: number,
  connection?: mysql.PoolConnection,
  checkParentRunAccess = false
) {
  const config = node.config;
  const childId = String(config.subflowId ?? "").trim();
  if (!childId || childId === parentWorkflowId)
    diagnostic(node, "子调用必须选择另一个已发布流程，不能调用自身。");
  childCallOptions(config);
  const executor = connection ?? getSharedPool();
  const lock = connection ? " FOR SHARE" : "";
  const [accounts] = await executor.query<mysql.RowDataPacket[]>(
    "SELECT id,role,status FROM users WHERE id=?" + lock,
    [actorId]
  );
  const account = accounts[0];
  if (account?.status !== "active")
    diagnostic(node, "发起人账号已停用，无法调用子流程。");
  if (checkParentRunAccess) {
    const parent = await getWorkflowAccess(
      { id: actorId, role: account.role },
      parentWorkflowId,
      connection ? { connection, lock: true } : undefined
    );
    if (
      !parent.permissions.has("workflow:view") ||
      !parent.permissions.has("workflow:run")
    )
      diagnostic(node, "发起人的父流程调用权限已变化，子实例未创建。");
  }
  const access = await getWorkflowAccess(
    { id: actorId, role: account.role },
    childId,
    connection ? { connection, lock: true } : undefined
  );
  if (
    !access.permissions.has("workflow:view") ||
    !access.permissions.has("workflow:run")
  )
    diagnostic(node, "目标子流程不可调用，请核对项目及流程的查看、运行权限。");
  const [rows] = await executor.query<mysql.RowDataPacket[]>(
    "SELECT w.ownerUserId,w.projectId,w.flowType,w.name,v.version,v.executionPlanJson,v.executionPlanHash " +
      "FROM workflow w JOIN workflow_version v ON v.workflowId=w.id AND v.version=COALESCE(?,w.definitionVersion) " +
      "WHERE w.id=? AND w.archivedAt IS NULL AND w.status='published' AND (w.projectId IS NULL OR w.auditStatus='approved') " +
      "AND w.flowType IN ('state','control') AND v.status='published'" +
      lock,
    [config.childVersion ?? null, childId]
  );
  const row = rows[0];
  if (!row?.executionPlanJson || !row.executionPlanHash)
    diagnostic(
      node,
      "目标流程或所选发布版本不可调用，请核对发布、审核和归档状态。"
    );
  if (config.childPlanHash && config.childPlanHash !== row.executionPlanHash)
    diagnostic(node, "子流程固定版本的执行摘要不匹配，请重新选择版本。");
  const plan = assertWorkflowExecutionPlan(
    typeof row.executionPlanJson === "string"
      ? JSON.parse(row.executionPlanJson)
      : row.executionPlanJson,
    String(row.executionPlanHash),
    row.flowType
  );
  if (plan.definition.nodes.some(child => child.type === "subflow"))
    diagnostic(
      node,
      "持久调用当前限定一层，目标版本含有子调用。请选用无嵌套的已发布流程。"
    );
  return {
    id: childId,
    ownerUserId: Number(row.ownerUserId),
    flowType: row.flowType as "state" | "control",
    version: Number(row.version),
    planHash: String(row.executionPlanHash),
    plan,
  };
}

export async function bindDurableCalls(
  definition: WorkflowDefinition,
  parentWorkflowId: string,
  actorId: number,
  connection?: mysql.PoolConnection
) {
  const calls = definition.nodes.filter(isDurableSubflow);
  if (!calls.length) return definition;
  if (
    calls.length > maxDurableCallSites ||
    isParticipantStateDefinition(definition)
  )
    diagnostic(
      calls[0],
      "持久调用适用于普通状态或控制流程，每份父定义最多可设置八个调用节点。"
    );
  const nodes: WorkflowNode[] = [];
  for (const node of definition.nodes) {
    if (!isDurableSubflow(node)) {
      nodes.push(node);
      continue;
    }
    const child = await loadPublishedChild(
      node,
      parentWorkflowId,
      actorId,
      connection
    );
    const {
      resolvedSubflowDefinition,
      resolvedSubflowId,
      resolvedSubflowUpdatedAt,
      resolvedSubflowName,
      ...config
    } = node.config;
    nodes.push({
      ...node,
      config: {
        ...config,
        childVersion: child.version,
        childPlanHash: child.planHash,
      },
    });
  }
  return { ...definition, nodes };
}
