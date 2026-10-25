import { taskSummarySelect } from "./task-list-projection";
import { eligibleDirectoryPage } from "./eligible-directory-page";
import { TRPCError } from "@trpc/server";
import { DEFAULT_SYSTEM_SETTINGS as defaultSettings, assertSystemSettingConfigToken, mergeSystemSettingValue, readSystemSettingValue, systemSettingConfigToken } from "./system-setting-config";
import {
  businessStateLabelSql,
  businessStateJoinSql,
  recordedBusinessStateNameSql,
  presentProcessInstance,
} from "./process-instance-state";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedPool } from "./db";
import { hasWorkflowPermission, recordAuthorizationAudit } from "./iam-service";
import { resumeWorkflowTask, validateWorkflowTaskSubmission } from "./workflow-engine";
import { wakeWorkflowWorker } from "./workflow-worker";
import {
  collectAuthorizedPage,
  decodeWorkbenchPageCursor,
  type WorkbenchPageCursor,
} from "./workbench-pagination";

type User = { id: number; role: "user" | "admin"; tokenVersion?: number };
type TaskView = "todo" | "done" | "initiated" | "all";
type JsonRecord = Record<string, unknown>;
const db = () => getSharedPool();
const parseJson = (value: unknown) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export function taskFilter(view: TaskView, userId: number) {
  if (view === "todo")
    return {
      clause:
        "t.status IN ('pending','claimed') AND ((t.status='pending' AND (t.assignedUserId=? OR (t.assignedUserId IS NULL AND JSON_CONTAINS(t.candidateUserIdsJson,?)))) OR (t.status='claimed' AND t.claimedByUserId=?))",
      params: [userId, JSON.stringify(userId), userId],
    };
  if (view === "done")
    return {
      clause: "t.status='completed' AND t.completedByUserId=?",
      params: [userId],
    };
  if (view === "initiated")
    return { clause: "r.triggeredByUserId=?", params: [userId] };
  return { clause: "1=1", params: [] as Array<number | string> };
}

export function processInstanceStatusFilter(status?: string) {
  const normalized = status?.trim();
  if (!normalized) return { clause: "", params: [] as string[] };
  return {
    clause: `(r.status=? OR ${businessStateLabelSql}=?)`,
    params: [normalized, normalized],
  };
}

function candidateIds(task: mysql.RowDataPacket) {
  const parsed = parseJson(task.candidateUserIdsJson);
  return Array.isArray(parsed)
    ? parsed.map(Number).filter(id => Number.isInteger(id) && id > 0)
    : [];
}

export function isTaskActor(userId: number, task: mysql.RowDataPacket) {
  return (
    [
      task.assignedUserId,
      task.claimedByUserId,
      task.completedByUserId,
      task.responsibleUserId,
      task.representedUserId,
    ].some(value => Number(value) === userId) ||
    candidateIds(task).includes(userId)
  );
}

export function isCurrentTaskOwner(userId: number, task: mysql.RowDataPacket) {
  if (String(task.status) === "claimed")
    return Number(task.claimedByUserId) === userId;
  if (String(task.status) === "pending") {
    if (Number(task.assignedUserId) > 0)
      return Number(task.assignedUserId) === userId;
    return candidateIds(task).includes(userId);
  }
  return false;
}

export function isCurrentTaskOperation(input: {
  task:
    | {
        id?: unknown;
        nodeId?: unknown;
        assignedUserId?: unknown;
        candidateUserIdsJson?: unknown;
      }
    | mysql.RowDataPacket;
  state?: { sourceNodeId?: unknown } | mysql.RowDataPacket;
  operations: unknown[];
}) {
  const assigned = Number(input.task.assignedUserId ?? 0) > 0;
  const candidates = Array.isArray(input.task.candidateUserIdsJson)
    ? input.task.candidateUserIdsJson
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0)
    : candidateIds(input.task as mysql.RowDataPacket);
  if (!assigned && candidates.length === 0) return false;
  if (
    !input.state ||
    String(input.state.sourceNodeId ?? "") !== String(input.task.nodeId)
  )
    return false;
  return input.operations.some(item => {
    const operation =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return (
      String(operation.taskId ?? operation.id ?? "") === String(input.task.id)
    );
  });
}

async function canAccessTask(
  user: User,
  task: mysql.RowDataPacket,
  write = false
) {
  if (user.role === "admin" && !write) return true;
  if (write) {
    if (isCurrentTaskOwner(user.id, task)) return true;
    return false;
  }
  if (isTaskActor(user.id, task) || Number(task.triggeredByUserId) === user.id)
    return true;
  return hasWorkflowPermission(user, String(task.workflowId), "workflow:view");
}

function isTaskRunActionable(task: mysql.RowDataPacket) {
  const payload = parseJson(task.payloadJson) as {
    parallelTokens?: unknown;
  } | null;
  return (
    ["running", "waiting"].includes(String(task.runStatus)) ||
    (task.runStatus === "queued" &&
      (Number(task.hasParallelContinuation) === 1 ||
        Array.isArray(payload?.parallelTokens)))
  );
}

export function currentTaskHandlerIds(task: mysql.RowDataPacket) {
  if (!["pending", "claimed"].includes(String(task.status))) return [];
  const ownerId = Number(
    task.status === "claimed" ? task.claimedByUserId : task.assignedUserId
  );
  return Number.isInteger(ownerId) && ownerId > 0
    ? [ownerId]
    : task.status === "pending"
      ? candidateIds(task)
      : [];
}

async function taskReassignmentState(
  task: mysql.RowDataPacket,
  connection?: mysql.PoolConnection
) {
  if (
    !["pending", "claimed"].includes(String(task.status)) ||
    !isTaskRunActionable(task) ||
    (task.approvalGroupId && task.groupStatus !== "waiting")
  )
    return { eligible: false, reason: null };
  const owners = currentTaskHandlerIds(task);
  if (owners.length) {
    const [rows] = await (connection ?? db()).query<mysql.RowDataPacket[]>(
      `SELECT id,status FROM users WHERE id IN (?) ORDER BY id${connection ? " FOR UPDATE" : ""}`,
      [owners]
    );
    if (rows.some(row => row.status === "active"))
      return { eligible: false, reason: null };
  }
  return {
    eligible: true,
    reason: owners.length
      ? "当前处理人已停用，可重新分配给其他可办理人员。"
      : "当前任务没有有效处理人，可重新分配。",
  };
}

async function assertCurrentTaskOperation(
  user: User,
  task: mysql.RowDataPacket
) {
  const [actorRows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT status FROM users WHERE id=? LIMIT 1",
    [user.id]
  );
  if (String(actorRows[0]?.status ?? "") !== "active") {
    throw new Error("当前账号已停用，不能执行人工操作。 ");
  }
  if (!isTaskRunActionable(task))
    throw new Error("流程实例当前不在可操作状态。 ");
  if (!["pending", "claimed"].includes(String(task.status)))
    throw new Error("当前人工操作已结束或被取消。 ");
  const [states] = await db().query<mysql.RowDataPacket[]>(
    `SELECT stateCode,sourceNodeId,availableOperationsJson
       FROM workflow_participant_state
      WHERE runId=? AND userId=? AND roleKey=?
      ORDER BY updatedAt DESC,id DESC LIMIT 1`,
    [task.runId, user.id, String(task.roleKey || "default")]
  );
  const state = states[0];
  const operations = parseJson(state?.availableOperationsJson);
  if (
    !isCurrentTaskOperation({
      task,
      state,
      operations: Array.isArray(operations) ? operations : [],
    })
  ) {
    throw new Error(
      state
        ? "当前操作已不属于该用户的可执行操作集合，请刷新任务状态。 "
        : "当前用户不在该流程实例的当前状态，不能执行此操作。 "
    );
  }
}

export function taskActionState(userId: number, task: mysql.RowDataPacket) {
  if (!isTaskRunActionable(task)) {
    const paused = task.runStatus === "blocked";
    return {
      canAct: false,
      blockedReason: paused
        ? "流程已暂停，恢复后才能办理。"
        : "流程当前不可办理，请刷新状态。",
      actionLabel: paused ? "流程已暂停" : "当前不可办理",
    };
  }
  const waiting =
    task.signMode === "sequentialSignFor" &&
    (task.status === "pending" || task.status === "claimed") &&
    Number(task.hasEarlierPendingSigner) === 1;
  return {
    canAct: isCurrentTaskOwner(userId, task) && !waiting,
    blockedReason: waiting
      ? "等待前序审批人完成审批，轮到你后即可办理。"
      : null,
    actionLabel: waiting ? "等待前序审批" : null,
  };
}

const earlierPendingSignerSql = `EXISTS(SELECT 1 FROM workflow_task earlier
  WHERE t.signMode='sequentialSignFor' AND earlier.approvalGroupId=t.approvalGroupId
    AND earlier.approvalOrder<t.approvalOrder AND earlier.status IN ('pending','claimed'))`;

function presentTask(row: mysql.RowDataPacket) {
  const status = String(row.status);
  const result = parseJson(row.resultJson);
  const displayStatus =
    status === "pending"
      ? String(row.pendingStatusName || "待审批")
      : status === "claimed"
        ? "处理中"
        : status === "completed"
          ? result?.decision === "rejected"
            ? "已拒绝"
            : result?.decision === "abstained"
              ? "已弃权"
              : "已审核"
          : "已取消";
  return {
    ...row,
    displayStatus,
    candidateUserIds: candidateIds(row),
    payload: parseJson(row.payloadJson),
    result,
    approvalProgress: row.approvalGroupId
      ? {
          completed: Number(row.approvedApprovals ?? 0),
          approved: Number(row.approvedApprovals ?? 0),
          rejected: Number(row.rejectedApprovals ?? 0),
          decided: Number(row.completedDecisions ?? 0),
          required: Number(row.requiredApprovals ?? 1),
          total: Number(row.totalApprovers ?? 1),
        }
      : null,
  };
}

const taskDisplayStatusSql = `CASE t.status
  WHEN 'pending' THEN COALESCE(NULLIF(t.pendingStatusName,''),'待审批')
  WHEN 'claimed' THEN '处理中'
  WHEN 'completed' THEN CASE JSON_UNQUOTE(JSON_EXTRACT(t.resultJson,'$.decision'))
    WHEN 'rejected' THEN '已拒绝'
    WHEN 'abstained' THEN '已弃权'
    ELSE '已审核'
  END
  ELSE '已取消'
END`;

function taskRank(status: unknown) {
  return status === "pending" ? 0 : status === "claimed" ? 1 : 2;
}

function workflowViewPermissionCache(user: User) {
  const cache = new Map<string, Promise<boolean>>();
  return (workflowId: string) => {
    let result = cache.get(workflowId);
    if (!result) {
      result = hasWorkflowPermission(user, workflowId, "workflow:view");
      cache.set(workflowId, result);
    }
    return result;
  };
}

export async function pageWorkflowTasks(
  user: User,
  input: {
    view: TaskView;
    projectId?: string;
    runId?: string;
    status?: string;
    search?: string;
    createdAtFrom?: Date;
    createdAtBefore?: Date;
    limit?: number;
    scanLimit?: number;
    cursor?: string;
  }
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const initialCursor = decodeWorkbenchPageCursor(input.cursor, "task");
  const filter = taskFilter(input.view, user.id);
  const clauses = [filter.clause];
  const baseParams: unknown[] = [...filter.params];
  if (input.projectId) {
    clauses.push("t.projectId=?");
    baseParams.push(input.projectId);
  }
  if (input.runId) {
    clauses.push("t.runId=?");
    baseParams.push(input.runId);
  }
  if (input.status) {
    clauses.push(`${taskDisplayStatusSql}=?`);
    baseParams.push(input.status);
  }
  if (input.createdAtFrom) {
    clauses.push("t.createdAt>=?");
    baseParams.push(input.createdAtFrom);
  }
  if (input.createdAtBefore) {
    clauses.push("t.createdAt<?");
    baseParams.push(input.createdAtBefore);
  }
  const search = input.search?.trim();
  if (search) {
    clauses.push(
      `LOCATE(LOWER(?),LOWER(CONCAT_WS(' ',w.name,t.nodeName,initiator.name,${taskDisplayStatusSql})))>0`
    );
    baseParams.push(search);
  }

  const hasTaskActorAccess = (row: mysql.RowDataPacket) =>
    isTaskActor(user.id, row) || Number(row.triggeredByUserId) === user.id;
  const canViewWorkflow = workflowViewPermissionCache(user);
  return collectAuthorizedPage<
    mysql.RowDataPacket,
    Extract<WorkbenchPageCursor, { kind: "task" }>
  >({
    limit,
    scanLimit: input.scanLimit,
    cursor: initialCursor?.kind === "task" ? initialCursor : undefined,
    loadBatch: async (after, batchLimit) => {
      const batchClauses = [...clauses];
      const params = [...baseParams];
      if (after) {
        const rankSql =
          "CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END";
        batchClauses.push(
          `(${rankSql}>? OR (${rankSql}=? AND (t.createdAt<? OR (t.createdAt=? AND t.id<?))))`
        );
        params.push(
          after.rank,
          after.rank,
          after.createdAt,
          after.createdAt,
          after.id
        );
      }
      params.push(batchLimit);
      const [rows] = await db().query<mysql.RowDataPacket[]>(
        `SELECT ${taskSummarySelect},w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,
                initiator.name AS initiatedByName,assignee.name AS assignedName,claimant.name AS claimedByName,
                DATE_FORMAT(t.createdAt,'%Y-%m-%d %H:%i:%s.%f') AS cursorCreatedAt,
                g.totalApprovers,g.requiredApprovals,g.memberVersion,
            ${earlierPendingSignerSql} AS hasEarlierPendingSigner,
                (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
                (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
                (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
           FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
           LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
           LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN users assignee ON assignee.id=t.assignedUserId
           LEFT JOIN users claimant ON claimant.id=t.claimedByUserId
          WHERE ${batchClauses.join(" AND ")}
          ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,t.createdAt DESC,t.id DESC
          LIMIT ?`,
        params
      );
      return rows;
    },
    getCursor: row => ({
      kind: "task",
      rank: taskRank(row.status),
      createdAt: String(row.cursorCreatedAt),
      id: String(row.id),
    }),
    isAuthorized: async row =>
      user.role === "admin" ||
      hasTaskActorAccess(row) ||
      (await canViewWorkflow(String(row.workflowId))),
  }).then(page => ({
    ...page,
    items: page.items.map(row => ({
      ...presentTask(row),
      ...taskActionState(user.id, row),
    })),
  }));
}

export async function listWorkflowTasks(
  user: User,
  input: {
    view: TaskView;
    projectId?: string;
    runId?: string;
    summaryOnly?: boolean;
    status?: "pending" | "claimed" | "completed" | "cancelled";
    createdAtFrom?: Date;
    createdAtBefore?: Date;
    limit?: number;
  }
) {
  const filter = taskFilter(input.view, user.id);
  const clauses = [filter.clause];
  const params: unknown[] = [...filter.params];
  if (input.projectId) {
    clauses.push("t.projectId=?");
    params.push(input.projectId);
  }
  if (input.runId) {
    clauses.push("t.runId=?");
    params.push(input.runId);
  }
  if (input.status) {
    clauses.push("t.status=?");
    params.push(input.status);
  }
  if (input.createdAtFrom) {
    clauses.push("t.createdAt>=?");
    params.push(input.createdAtFrom);
  }
  if (input.createdAtBefore) {
    clauses.push("t.createdAt<?");
    params.push(input.createdAtBefore);
  }
  params.push(Math.min(Math.max(input.limit ?? 100, 1), 200));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT ${input.summaryOnly ? taskSummarySelect : "t.*"},w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,claimant.name AS claimedByName,
            g.totalApprovers,g.requiredApprovals,g.memberVersion,
            ${earlierPendingSignerSql} AS hasEarlierPendingSigner,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId LEFT JOIN users claimant ON claimant.id=t.claimedByUserId
      WHERE ${clauses.join(" AND ")} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,t.createdAt DESC LIMIT ?`,
    params
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows)
    if (await canAccessTask(user, row))
      accessible.push({
        ...presentTask(row),
        ...taskActionState(user.id, row),
      });
  return accessible;
}

export async function getWorkflowTask(user: User, taskId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,w.ownerUserId,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,claimant.name AS claimedByName,
            responsible.name AS responsibleName,represented.name AS representedName,
            g.totalApprovers,g.requiredApprovals,g.memberVersion,g.status AS groupStatus,
            ${earlierPendingSignerSql} AS hasEarlierPendingSigner,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
       LEFT JOIN users assignee ON assignee.id=t.assignedUserId
       LEFT JOIN users claimant ON claimant.id=t.claimedByUserId
       LEFT JOIN users responsible ON responsible.id=t.responsibleUserId
       LEFT JOIN users represented ON represented.id=t.representedUserId
      WHERE t.id=? LIMIT 1`,
    [taskId]
  );
  const task = rows[0];
  if (!task || !(await canAccessTask(user, task))) return null;
  let approvalMembers: mysql.RowDataPacket[] = [];
  if (task.approvalGroupId) {
    const [memberRows] = await db().query<mysql.RowDataPacket[]>(
      `SELECT member.id,member.assignedUserId,member.status,member.approvalOrder,
              assignee.name AS assignedName,assignee.username AS assignedUsername
         FROM workflow_task member
         LEFT JOIN users assignee ON assignee.id=member.assignedUserId
        WHERE member.approvalGroupId=? ORDER BY member.approvalOrder,member.createdAt,member.id`,
      [task.approvalGroupId]
    );
    approvalMembers = memberRows;
  }
  const reassignment = (await hasWorkflowPermission(
    user,
    String(task.workflowId),
    "workflow:members:manage"
  ))
    ? await taskReassignmentState(task)
    : { eligible: false, reason: null };
  return {
    ...presentTask(task),
    viewerUserId: user.id,
    ...taskActionState(user.id, task),
    canReassign: reassignment.eligible,
    reassignmentReason: reassignment.reason,
    canViewRun: await hasWorkflowPermission(
      user,
      String(task.workflowId),
      "workflow:view"
    ),
    nextNodeIds: parseJson(task.nextNodeIdsJson),
    approvalMembers,
  };
}

/** Read-only eligibility check sharing the task execution guards. Does not validate or submit form values. */
export async function inspectWorkflowTaskAction(user: User, taskId: string, workflowId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task || String(task.workflowId) !== workflowId)
    return { id: taskId, canAct: false, reason: "任务不存在、不可见或不属于当前流程。" };
  const blocked = taskActionState(user.id, task as mysql.RowDataPacket);
  if (!(await canAccessTask(user, task as mysql.RowDataPacket, true)) || !blocked.canAct)
    return { id: taskId, canAct: false, reason: blocked.blockedReason || "当前账号不是该任务的有效处理人，或任务已经结束。" };
  try {
    await assertCurrentTaskOperation(user, task as mysql.RowDataPacket);
    return { id: taskId, canAct: true, reason: "当前具备办理资格，提交时仍会校验表单、任务版本与实时状态。" };
  } catch (error) {
    if (error && typeof error === "object" && ("sqlState" in error || ("code" in error && /^(ER_|ECONN|PROTOCOL_|ETIMEDOUT)/.test(String(error.code))))) throw error;
    return { id: taskId, canAct: false, reason: error instanceof Error ? error.message : "当前任务不可办理。" };
  }
}

export async function claimWorkflowTask(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "人工任务不存在或无访问权限。",
    });
  if (!(await canAccessTask(user, task, true)))
    throw new TRPCError({ code: "FORBIDDEN", message: "无权领取该人工任务。" });
  if (task.assignedUserId && Number(task.assignedUserId) !== user.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该人工任务已指定其他处理人。",
    });
  if (task.approvalGroupId && task.signMode === "sequentialSignFor") {
    const [prior] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE approvalGroupId=? AND approvalOrder<? AND status IN ('pending','claimed') LIMIT 1",
      [task.approvalGroupId, Number(task.approvalOrder ?? 0)]
    );
    if (prior[0])
      throw new TRPCError({
        code: "CONFLICT",
        message: "顺序会签尚未轮到当前审批人。",
      });
  }
  await assertCurrentTaskOperation(user, task);
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow_task SET status='claimed',claimedByUserId=?,claimedAt=NOW(),ownerVersion=ownerVersion+1 WHERE id=? AND status='pending' AND ownerVersion=?",
    [user.id, taskId, Number(task.ownerVersion ?? 0)]
  );
  if (!result.affectedRows)
    throw new TRPCError({
      code: "CONFLICT",
      message: "人工任务已被领取或已结束。",
    });
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow_task",
    resourceId: taskId,
    details: { operation: "task_claimed" },
  });
  return getWorkflowTask(user, taskId);
}

export async function executeWorkflowTask(
  user: User,
  taskId: string,
  result: JsonRecord
) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "人工任务不存在或无访问权限。",
    });
  if (
    task.status !== "pending" &&
    (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "当前操作不可执行，请刷新任务状态。",
    });
  if (!(await canAccessTask(user, task, true)))
    throw new TRPCError({ code: "FORBIDDEN", message: "无权执行该人工任务。" });
  await assertCurrentTaskOperation(user, task);
  validateWorkflowTaskSubmission(task, result);
  if (task.status === "pending") await claimWorkflowTask(user, taskId);
  return completeWorkflowTask(user, taskId, result);
}

export async function completeWorkflowTask(
  user: User,
  taskId: string,
  result: JsonRecord
) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "人工任务不存在或无访问权限。",
    });
  if (!(await canAccessTask(user, task, true)))
    throw new TRPCError({ code: "FORBIDDEN", message: "无权完成该人工任务。" });
  if (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id)
    throw new TRPCError({
      code: "CONFLICT",
      message: "仅当前领取人可完成已领取的人工任务。",
    });
  await assertCurrentTaskOperation(user, task);
  const resumed = await resumeWorkflowTask({
    taskId,
    completedBy: user,
    result,
  });
  if (resumed.status === "queued") wakeWorkflowWorker();
  const auditOperation =
    result.decision === "rejected"
      ? "task_rejected"
      : result.decision === "abstained"
        ? "task_abstained"
        : "task_approved";
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow_task",
    resourceId: taskId,
    details: {
      operation: auditOperation,
      decision: result.decision,
      runId: resumed.runId,
      status: resumed.status,
      responsibleUserId: task.responsibleUserId ?? user.id,
      representedUserId: task.representedUserId ?? null,
      delegationId: task.delegationId ?? null,
    },
  });
  return { ...resumed, canViewRun: task.canViewRun === true };
}

async function getEligibleAssignee(task: mysql.RowDataPacket, userId: number) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,username,name,email,role,status FROM users WHERE id=? AND status='active' LIMIT 1",
    [userId]
  );
  const candidate = rows[0];
  if (!candidate) throw new Error("目标处理人不存在或已停用。 ");
  const candidateUser: User = {
    id: Number(candidate.id),
    role: candidate.role === "admin" ? "admin" : "user",
  };
  if (
    !(await hasWorkflowPermission(
      candidateUser,
      String(task.workflowId),
      "workflow:run"
    ))
  )
    throw new Error("目标处理人没有该流程的运行权限。 ");
  return candidate;
}

async function moveScheduledTaskNotifications(
  connection: mysql.PoolConnection,
  task: mysql.RowDataPacket,
  previousUserIds: number[],
  targetUserId: number
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT * FROM workflow_task_schedule WHERE taskId=? AND status='scheduled' FOR UPDATE",
    [task.id]
  );
  const ownerUserId = Number(task.ownerUserId ?? 0);
  const eventFireAt = new Map<string, unknown>();
  for (const row of rows) {
    const eventType = String(row.eventType);
    if (!eventFireAt.has(eventType)) eventFireAt.set(eventType, row.fireAt);
  }
  if (previousUserIds.length)
    await connection.query(
      `UPDATE workflow_task_schedule
          SET status='cancelled'
        WHERE taskId=? AND status='scheduled' AND recipientUserId IN (?)
          AND NOT (eventType='escalation' AND recipientUserId=?)`,
      [task.id, previousUserIds, ownerUserId]
    );
  for (const [eventType, fireAt] of Array.from(eventFireAt.entries()))
    await connection.query(
      `INSERT INTO workflow_task_schedule
        (id,taskId,runId,workflowId,recipientUserId,eventType,status,fireAt,payloadJson,requestId)
       VALUES (?,?,?,?,?,?,'scheduled',?,?,?)
       ON DUPLICATE KEY UPDATE status='scheduled',fireAt=VALUES(fireAt),payloadJson=VALUES(payloadJson),requestId=VALUES(requestId),firedAt=NULL`,
      [
        randomUUID(),
        task.id,
        task.runId,
        task.workflowId,
        targetUserId,
        eventType,
        fireAt,
        JSON.stringify({
          taskId: task.id,
          nodeId: task.nodeId,
          operationName: task.operationName,
        }),
        task.requestId ?? null,
      ]
    );
}

async function copyScheduledTaskNotifications(
  connection: mysql.PoolConnection,
  sourceTask: mysql.RowDataPacket,
  newTaskId: string,
  targetUserId: number
) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT eventType,fireAt FROM workflow_task_schedule WHERE taskId=? AND status='scheduled' ORDER BY fireAt FOR UPDATE",
    [sourceTask.id]
  );
  const scheduleByEvent = new Map<string, mysql.RowDataPacket>();
  for (const row of rows)
    if (!scheduleByEvent.has(String(row.eventType)))
      scheduleByEvent.set(String(row.eventType), row);
  const ownerUserId = Number(sourceTask.ownerUserId ?? 0);
  for (const row of Array.from(scheduleByEvent.values())) {
    const recipients =
      String(row.eventType) === "escalation"
        ? Array.from(new Set([targetUserId, ownerUserId])).filter(
            userId => Number.isInteger(userId) && userId > 0
          )
        : [targetUserId];
    for (const recipientUserId of recipients)
      await connection.query(
        `INSERT INTO workflow_task_schedule
          (id,taskId,runId,workflowId,recipientUserId,eventType,status,fireAt,payloadJson,requestId)
         VALUES (?,?,?,?,?,?,'scheduled',?,?,?)
         ON DUPLICATE KEY UPDATE id=id`,
        [
          randomUUID(),
          newTaskId,
          sourceTask.runId,
          sourceTask.workflowId,
          recipientUserId,
          row.eventType,
          row.fireAt,
          JSON.stringify({
            taskId: newTaskId,
            nodeId: sourceTask.nodeId,
            operationName: sourceTask.operationName,
          }),
          sourceTask.requestId ?? null,
        ]
      );
  }
}

async function grantParticipantTaskOperation(
  connection: mysql.PoolConnection,
  input: {
    runId: string;
    workflowId: string;
    userId: number;
    roleKey: string;
    nodeId: string;
    stateName: string;
    operation: JsonRecord;
  }
) {
  const [stateRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,availableOperationsJson FROM workflow_participant_state WHERE runId=? AND userId=? AND roleKey=? LIMIT 1 FOR UPDATE",
    [input.runId, input.userId, input.roleKey]
  );
  const state = stateRows[0];
  const existing = parseJson(state?.availableOperationsJson);
  const taskId = String(input.operation.taskId ?? input.operation.id ?? "");
  const operations = [
    ...(Array.isArray(existing)
      ? existing.filter(item => {
          const operation =
            item && typeof item === "object" ? (item as JsonRecord) : {};
          return String(operation.taskId ?? operation.id ?? "") !== taskId;
        })
      : []),
    input.operation,
  ];
  if (state) {
    await connection.query(
      "UPDATE workflow_participant_state SET stateCode=?,stateName=?,flowStatus=?,sourceNodeId=?,availableOperationsJson=?,updatedAt=NOW() WHERE id=?",
      [
        input.nodeId,
        input.stateName,
        input.stateName,
        input.nodeId,
        JSON.stringify(operations),
        state.id,
      ]
    );
    return;
  }
  await connection.query(
    "INSERT INTO workflow_participant_state (id,runId,workflowId,userId,roleKey,stateCode,stateName,flowStatus,sourceNodeId,availableOperationsJson) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      input.runId,
      input.workflowId,
      input.userId,
      input.roleKey,
      input.nodeId,
      input.stateName,
      input.stateName,
      input.nodeId,
      JSON.stringify(operations),
    ]
  );
}

export async function listWorkflowTaskAssignees(
  user: User,
  taskId: string,
  search?: string
) {
  const task: any = await getWorkflowTask(user, taskId);
  if (
    !task ||
    (!(await canAccessTask(user, task, true)) && task.canReassign !== true)
  )
    throw new Error("人工任务不存在或无分配权限。 ");
  const query = search?.trim().toLocaleLowerCase();
  if (search !== undefined && !query) return [];
  const rows = await eligibleDirectoryPage<
    mysql.RowDataPacket & { id: number }
  >(
    async afterId => {
      const [page] = await db().query<(mysql.RowDataPacket & { id: number })[]>(
        "SELECT id,username,name,role FROM users WHERE status='active' AND id>? AND (? IS NULL OR LOCATE(?,LOWER(COALESCE(name,'')))>0 OR LOCATE(?,LOWER(username))>0) ORDER BY id LIMIT 200",
        [afterId, query ?? null, query ?? null, query ?? null]
      );
      return page;
    },
    candidate =>
      hasWorkflowPermission(
        {
          id: Number(candidate.id),
          role: candidate.role === "admin" ? "admin" : "user",
        },
        String(task.workflowId),
        "workflow:run"
      ),
    search === undefined ? 200 : 51
  );
  return rows.map(candidate => ({
    id: Number(candidate.id),
    username: String(candidate.username),
    name: candidate.name ?? null,
  }));
}

export async function handoverWorkflowTask(
  user: User,
  input: {
    taskId: string;
    targetUserId: number;
    delegation?: boolean;
    recovery?: { reason: string; ownerVersion: number };
  }
) {
  if (input.recovery && input.delegation)
    throw new Error("重新分配不能同时设置代理关系。");
  const actionLabel = input.recovery
    ? "重新分配"
    : input.delegation
      ? "代理"
      : "移交";
  const task: any = await getWorkflowTask(user, input.taskId);
  if (
    !task ||
    (input.recovery
      ? task.canReassign !== true
      : !(await canAccessTask(user, task, true)))
  )
    throw new Error(`人工任务不存在或无${actionLabel}权限。 `);
  if (
    input.recovery &&
    (!Number.isInteger(input.recovery.ownerVersion) ||
      input.recovery.ownerVersion < 0 ||
      input.recovery.reason.trim().length < 3 ||
      input.recovery.reason.trim().length > 500)
  )
    throw new Error("重新分配需填写 3 至 500 字的原因，并使用当前任务版本。");
  if (
    !["pending", "claimed"].includes(String(task.status)) ||
    !isTaskRunActionable(task)
  )
    throw new Error(`仅可${actionLabel}正在等待处理的人工任务。 `);
  if (
    !input.recovery &&
    task.status === "claimed" &&
    Number(task.claimedByUserId) !== user.id
  )
    throw new Error(`仅当前处理人可${actionLabel}已领取任务。 `);
  if (!input.recovery) await assertCurrentTaskOperation(user, task);
  const target = await getEligibleAssignee(task, input.targetUserId);
  const currentOwnerId =
    Number(task.claimedByUserId ?? task.assignedUserId ?? 0) ||
    (input.recovery ? 0 : user.id);
  if (currentOwnerId === input.targetUserId)
    throw new Error("目标处理人已经是当前任务处理人。 ");
  const delegationId = input.delegation ? randomUUID() : null;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [runs] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT status FROM workflow_run WHERE id=? FOR UPDATE",
      [task.runId]
    );
    if (
      !runs[0] ||
      !isTaskRunActionable({
        ...task,
        runStatus: runs[0].status,
      } as mysql.RowDataPacket)
    )
      throw new Error("流程实例当前不在可操作状态。");
    if (task.approvalGroupId) {
      const [groups] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,status FROM workflow_task_group WHERE id=? FOR UPDATE",
        [task.approvalGroupId]
      );
      if (groups[0]?.status !== "waiting")
        throw new Error("审批组已结束，无法变更处理人。");
    }
    const [lockedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
      [input.taskId]
    );
    const locked = lockedRows[0];
    if (
      !locked ||
      String(locked.status) !== String(task.status) ||
      Number(locked.ownerVersion ?? 0) !==
        Number(input.recovery?.ownerVersion ?? task.ownerVersion ?? 0) ||
      String(locked.approvalGroupId ?? "") !==
        String(task.approvalGroupId ?? "") ||
      (!input.recovery && !isCurrentTaskOwner(user.id, locked))
    ) {
      throw new Error("人工任务状态已变化，请刷新后重试。 ");
    }
    if (input.recovery) {
      if (
        !(await hasWorkflowPermission(
          user,
          String(locked.workflowId),
          "workflow:members:manage"
        ))
      )
        throw new Error("无重新分配权限。");
      const state = await taskReassignmentState(
        {
          ...locked,
          runStatus: runs[0].status,
          groupStatus: task.groupStatus,
        } as mysql.RowDataPacket,
        connection
      );
      if (!state.eligible)
        throw new Error("当前任务仍有启用的处理人，不能重新分配。");
    }
    const [targetRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,status FROM users WHERE id=? FOR UPDATE",
      [input.targetUserId]
    );
    if (targetRows[0]?.status !== "active")
      throw new Error("目标处理人不存在或已停用。");
    await getEligibleAssignee(locked, input.targetUserId);
    if (locked.approvalGroupId) {
      const [duplicates] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id FROM workflow_task WHERE approvalGroupId=? AND id<>? AND assignedUserId=? LIMIT 1",
        [locked.approvalGroupId, input.taskId, input.targetUserId]
      );
      if (duplicates[0])
        throw new Error("目标处理人已经在当前或签/会签组中，不能重复移交。 ");
    }
    const previousUserIds = Array.from(
      new Set(
        [
          Number(locked.assignedUserId),
          Number(locked.claimedByUserId),
          ...candidateIds(locked),
        ].filter(
          id => Number.isInteger(id) && id > 0 && id !== input.targetUserId
        )
      )
    );
    const roleKey = String(locked.roleKey || "default");
    for (const previousUserId of previousUserIds) {
      const [stateRows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT id,availableOperationsJson FROM workflow_participant_state WHERE runId=? AND userId=? AND roleKey=? LIMIT 1 FOR UPDATE",
        [locked.runId, previousUserId, roleKey]
      );
      const state = stateRows[0];
      if (!state) continue;
      const operations = parseJson(state.availableOperationsJson);
      const remaining = Array.isArray(operations)
        ? operations.filter(item => {
            const operation =
              item && typeof item === "object" ? (item as JsonRecord) : {};
            return (
              String(operation.taskId ?? operation.id ?? "") !== input.taskId
            );
          })
        : [];
      await connection.query(
        "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE id=?",
        [JSON.stringify(remaining), state.id]
      );
    }
    const availableOperation = {
      taskId: input.taskId,
      name: String(locked.operationName ?? locked.nodeName ?? "人工操作"),
      ...(String(locked.signMode ?? "single") === "single"
        ? {}
        : { signMode: String(locked.signMode) }),
    };
    await grantParticipantTaskOperation(connection, {
      runId: String(locked.runId),
      workflowId: String(locked.workflowId),
      userId: input.targetUserId,
      roleKey,
      nodeId: String(locked.nodeId),
      stateName: String(locked.pendingStatusName ?? "待审批"),
      operation: availableOperation,
    });
    locked.ownerUserId = task.ownerUserId;
    await moveScheduledTaskNotifications(
      connection,
      locked,
      previousUserIds,
      input.targetUserId
    );
    const [result] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_task SET assignedUserId=?,candidateUserIdsJson=?,responsibleUserId=?,representedUserId=?,delegationId=?,status='pending',claimedByUserId=NULL,claimedAt=NULL,ownerVersion=ownerVersion+1 WHERE id=? AND status=? AND ownerVersion=?",
      [
        input.targetUserId,
        JSON.stringify([input.targetUserId]),
        input.targetUserId,
        input.delegation ? currentOwnerId : null,
        delegationId,
        input.taskId,
        locked.status,
        Number(locked.ownerVersion ?? 0),
      ]
    );
    if (!result.affectedRows)
      throw new Error("人工任务状态已变化，请刷新后重试。 ");
    if (input.recovery) {
      const recovery = {
        actorUserId: user.id,
        fromUserIds: previousUserIds,
        toUserId: input.targetUserId,
        reason: input.recovery.reason.trim(),
        reassignedAt: new Date().toISOString(),
      };
      await connection.query(
        "UPDATE workflow_task SET payloadJson=? WHERE id=?",
        [
          JSON.stringify({
            ...parseJson(locked.payloadJson),
            assignmentRecovery: recovery,
          }),
          input.taskId,
        ]
      );
      if (locked.approvalGroupId)
        await connection.query(
          "UPDATE workflow_task_group SET memberVersion=memberVersion+1 WHERE id=? AND status='waiting'",
          [locked.approvalGroupId]
        );
      await recordAuthorizationAudit(
        {
          actorUserId: user.id,
          targetUserId: input.targetUserId,
          action: "user_updated",
          resourceType: "workflow_task",
          resourceId: input.taskId,
          details: { operation: "task_reassigned", ...recovery },
        },
        connection
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (!input.recovery)
    await recordAuthorizationAudit({
      actorUserId: user.id,
      targetUserId: Number(target.id),
      action: "user_updated",
      resourceType: "workflow_task",
      resourceId: input.taskId,
      details: {
        operation: input.delegation ? "task_delegated" : "task_handover",
        fromUserId: task.assignedUserId ?? task.claimedByUserId ?? null,
        toUserId: input.targetUserId,
        responsibleUserId: input.targetUserId,
        representedUserId: input.delegation ? currentOwnerId : null,
        delegationId,
      },
    });
  return getWorkflowTask(user, input.taskId);
}

export async function delegateWorkflowTask(
  user: User,
  input: { taskId: string; targetUserId: number }
) {
  return handoverWorkflowTask(user, { ...input, delegation: true });
}

export async function reassignWorkflowTask(
  user: User,
  input: {
    taskId: string;
    targetUserId: number;
    reason: string;
    ownerVersion: number;
  }
) {
  return handoverWorkflowTask(user, {
    taskId: input.taskId,
    targetUserId: input.targetUserId,
    recovery: { reason: input.reason, ownerVersion: input.ownerVersion },
  });
}

export function approvalRequirementAfterMemberChange(input: {
  signMode: string;
  totalApprovers: number;
  passPercentBasisPoints: number;
}) {
  if (input.totalApprovers <= 0) return 0;
  if (input.signMode === "orSignFor") return 1;
  if (input.signMode === "sequentialSignFor") return input.totalApprovers;
  if (input.signMode === "andSignFor")
    return Math.max(
      1,
      Math.min(
        input.totalApprovers,
        Math.ceil(
          (input.totalApprovers *
            Math.min(Math.max(input.passPercentBasisPoints, 1), 10000)) /
            10000
        )
      )
    );
  return 1;
}

export function taskJsonColumnValue(value: unknown) {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
}

export async function addWorkflowTaskSigner(
  user: User,
  input: { taskId: string; targetUserId: number; memberVersion: number }
) {
  const task: any = await getWorkflowTask(user, input.taskId);
  if (!task || !(await canAccessTask(user, task, true)))
    throw new Error("人工任务不存在或无加签权限。 ");
  if (!task.approvalGroupId)
    throw new Error("单人任务不支持动态加签，请先在流程定义中启用或签/会签。 ");
  await assertCurrentTaskOperation(user, task);
  const target = await getEligibleAssignee(task, input.targetUserId);
  const newTaskId = randomUUID();
  const connection = await db().getConnection();
  let nextMemberVersion = input.memberVersion;
  try {
    await connection.beginTransaction();
    const [groupRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task_group WHERE id=? FOR UPDATE",
      [task.approvalGroupId]
    );
    const group = groupRows[0];
    if (
      !group ||
      String(group.status) !== "waiting" ||
      Number(group.memberVersion) !== input.memberVersion
    )
      throw new Error("任务组成员已变化，请刷新后重试。 ");
    const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
      [input.taskId]
    );
    const source = sourceRows[0];
    if (
      !source ||
      !["pending", "claimed"].includes(String(source.status)) ||
      Number(source.ownerVersion ?? 0) !== Number(task.ownerVersion ?? 0) ||
      !isCurrentTaskOwner(user.id, source)
    )
      throw new Error("当前任务状态已变化，无法加签。 ");
    const [duplicates] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE approvalGroupId=? AND assignedUserId=? LIMIT 1",
      [task.approvalGroupId, input.targetUserId]
    );
    if (duplicates[0]) throw new Error("目标用户已在当前审批组中。 ");
    const [orderRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COALESCE(MAX(approvalOrder),-1)+1 AS nextOrder FROM workflow_task WHERE approvalGroupId=?",
      [task.approvalGroupId]
    );
    const nextOrder = Number(orderRows[0]?.nextOrder ?? 0);
    const participantSnapshot = {
      ...(parseJson(source.participantSnapshotJson) as JsonRecord),
      assignedUserId: input.targetUserId,
      candidateUserIds: [input.targetUserId],
      addedSignByUserId: user.id,
    };
    await connection.query(
      "INSERT INTO workflow_task (id,workflowId,projectId,runId,nodeId,nodeName,assignedUserId,candidateUserIdsJson,approvalGroupId,signMode,approvalOrder,roleKey,operationName,operationCode,pendingStatusName,instruction,payloadJson,participantSnapshotJson,outcomeHandlesJson,responsibleUserId,formSchemaVersion,dueAt,nextNodeIdsJson,requestId,executionKey) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        newTaskId,
        source.workflowId,
        source.projectId,
        source.runId,
        source.nodeId,
        source.nodeName,
        input.targetUserId,
        JSON.stringify([input.targetUserId]),
        source.approvalGroupId,
        source.signMode,
        nextOrder,
        source.roleKey,
        source.operationName,
        source.operationCode,
        source.pendingStatusName,
        source.instruction,
        taskJsonColumnValue(source.payloadJson),
        JSON.stringify(participantSnapshot),
        taskJsonColumnValue(source.outcomeHandlesJson),
        input.targetUserId,
        source.formSchemaVersion,
        source.dueAt,
        taskJsonColumnValue(source.nextNodeIdsJson),
        source.requestId,
        source.executionKey ?? "legacy",
      ]
    );
    const newTotal = Number(group.totalApprovers) + 1;
    const newRequired = approvalRequirementAfterMemberChange({
      signMode: String(group.signMode),
      totalApprovers: newTotal,
      passPercentBasisPoints: Number(group.passPercentBasisPoints ?? 10000),
    });
    const [groupUpdate] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_task_group SET totalApprovers=?,requiredApprovals=?,memberVersion=memberVersion+1 WHERE id=? AND status='waiting' AND memberVersion=?",
      [newTotal, newRequired, group.id, input.memberVersion]
    );
    if (!groupUpdate.affectedRows)
      throw new Error("任务组成员已变化，请刷新后重试。 ");
    nextMemberVersion = input.memberVersion + 1;
    source.ownerUserId = task.ownerUserId;
    await copyScheduledTaskNotifications(
      connection,
      source,
      newTaskId,
      input.targetUserId
    );
    if (String(group.signMode) !== "sequentialSignFor") {
      const availableOperation = {
        taskId: newTaskId,
        name: String(source.operationName ?? source.nodeName),
        signMode: String(group.signMode),
      };
      await grantParticipantTaskOperation(connection, {
        runId: String(source.runId),
        workflowId: String(source.workflowId),
        userId: input.targetUserId,
        roleKey: String(source.roleKey || "default"),
        nodeId: String(source.nodeId),
        stateName: String(source.pendingStatusName || "待审批"),
        operation: availableOperation,
      });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: Number(target.id),
    action: "user_updated",
    resourceType: "workflow_task_group",
    resourceId: String(task.approvalGroupId),
    details: {
      operation: "task_signer_added",
      sourceTaskId: input.taskId,
      addedTaskId: newTaskId,
      addedUserId: input.targetUserId,
      memberVersion: nextMemberVersion,
    },
  });
  return { taskId: newTaskId, memberVersion: nextMemberVersion };
}

export async function removeWorkflowTaskSigner(
  user: User,
  input: { taskId: string; memberTaskId: string; memberVersion: number }
) {
  const task: any = await getWorkflowTask(user, input.taskId);
  if (!task || !(await canAccessTask(user, task, true)))
    throw new Error("人工任务不存在或无减签权限。 ");
  if (!task.approvalGroupId) throw new Error("当前任务不属于审批组。 ");
  if (input.memberTaskId === input.taskId)
    throw new Error("不能将当前操作人自身从审批组移除。 ");
  await assertCurrentTaskOperation(user, task);
  const connection = await db().getConnection();
  let removedUserId = 0;
  let nextMemberVersion = input.memberVersion;
  try {
    await connection.beginTransaction();
    const [groupRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task_group WHERE id=? FOR UPDATE",
      [task.approvalGroupId]
    );
    const group = groupRows[0];
    if (
      !group ||
      String(group.status) !== "waiting" ||
      Number(group.memberVersion) !== input.memberVersion
    )
      throw new Error("任务组成员已变化，请刷新后重试。 ");
    if (Number(group.totalApprovers) <= 1)
      throw new Error("审批组至少必须保留一名成员。 ");
    const [sourceRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
      [input.taskId]
    );
    const source = sourceRows[0];
    if (
      !source ||
      Number(source.ownerVersion ?? 0) !== Number(task.ownerVersion ?? 0) ||
      !isCurrentTaskOwner(user.id, source)
    )
      throw new Error("当前任务所有人已变化，请刷新后重试。 ");
    const [memberRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? AND approvalGroupId=? FOR UPDATE",
      [input.memberTaskId, task.approvalGroupId]
    );
    const member = memberRows[0];
    if (!member || String(member.status) !== "pending")
      throw new Error("仅可移除尚未领取且未做出决定的加签/会签成员。 ");
    removedUserId = Number(member.assignedUserId);
    const newTotal = Number(group.totalApprovers) - 1;
    const newRequired = approvalRequirementAfterMemberChange({
      signMode: String(group.signMode),
      totalApprovers: newTotal,
      passPercentBasisPoints: Number(group.passPercentBasisPoints ?? 10000),
    });
    const [decisionRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS approved
         FROM workflow_task
        WHERE approvalGroupId=? AND status='completed'
          AND JSON_UNQUOTE(JSON_EXTRACT(resultJson,'$.decision'))='approved'`,
      [task.approvalGroupId]
    );
    if (Number(decisionRows[0]?.approved ?? 0) >= newRequired)
      throw new Error(
        "减签后已完成票数将直接达到新门槛，请由当前处理人先完成决定。 "
      );
    await connection.query(
      "UPDATE workflow_task SET status='cancelled',completedAt=NOW(),ownerVersion=ownerVersion+1 WHERE id=? AND status='pending'",
      [input.memberTaskId]
    );
    await connection.query(
      "UPDATE workflow_task_schedule SET status='cancelled' WHERE taskId=? AND status='scheduled'",
      [input.memberTaskId]
    );
    const [stateRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id,availableOperationsJson FROM workflow_participant_state WHERE runId=? AND userId=? AND roleKey=? LIMIT 1 FOR UPDATE",
      [member.runId, removedUserId, String(member.roleKey || "default")]
    );
    const state = stateRows[0];
    if (state) {
      const operations = parseJson(state.availableOperationsJson);
      const remaining = Array.isArray(operations)
        ? operations.filter(item => {
            const operation =
              item && typeof item === "object" ? (item as JsonRecord) : {};
            return (
              String(operation.taskId ?? operation.id ?? "") !==
              input.memberTaskId
            );
          })
        : [];
      await connection.query(
        "UPDATE workflow_participant_state SET availableOperationsJson=?,updatedAt=NOW() WHERE id=?",
        [JSON.stringify(remaining), state.id]
      );
    }
    const [groupUpdate] = await connection.query<mysql.ResultSetHeader>(
      "UPDATE workflow_task_group SET totalApprovers=?,requiredApprovals=?,memberVersion=memberVersion+1 WHERE id=? AND status='waiting' AND memberVersion=?",
      [newTotal, newRequired, group.id, input.memberVersion]
    );
    if (!groupUpdate.affectedRows)
      throw new Error("任务组成员已变化，请刷新后重试。 ");
    nextMemberVersion = input.memberVersion + 1;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  await recordAuthorizationAudit({
    actorUserId: user.id,
    targetUserId: removedUserId || undefined,
    action: "user_updated",
    resourceType: "workflow_task_group",
    resourceId: String(task.approvalGroupId),
    details: {
      operation: "task_signer_removed",
      sourceTaskId: input.taskId,
      removedTaskId: input.memberTaskId,
      removedUserId,
      memberVersion: nextMemberVersion,
    },
  });
  return { memberVersion: nextMemberVersion };
}

export async function returnWorkflowTaskToPending(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task || !(await canAccessTask(user, task, true)))
    throw new Error("人工任务不存在或无退回权限。 ");
  if (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id)
    throw new Error("仅当前处理人可将已领取任务退回待处理。 ");
  await assertCurrentTaskOperation(user, task);
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow_task SET status='pending',claimedByUserId=NULL,claimedAt=NULL,ownerVersion=ownerVersion+1 WHERE id=? AND status='claimed' AND claimedByUserId=? AND ownerVersion=?",
    [taskId, Number(task.claimedByUserId), Number(task.ownerVersion ?? 0)]
  );
  if (!result.affectedRows)
    throw new Error("人工任务状态已变化，请刷新后重试。 ");
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "workflow_task",
    resourceId: taskId,
    details: {
      operation: "task_returned_to_pending",
      assignedUserId: task.assignedUserId ?? null,
    },
  });
  return getWorkflowTask(user, taskId);
}

export async function batchClaimWorkflowTasks(user: User, taskIds: string[]) {
  return Promise.all(
    taskIds.map(async taskId => {
      try {
        await claimWorkflowTask(user, taskId);
        return { taskId, success: true as const };
      } catch (error) {
        return {
          taskId,
          success: false as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
}

export async function batchCompleteWorkflowTasks(
  user: User,
  taskIds: string[],
  result: JsonRecord
) {
  return Promise.all(
    taskIds.map(async taskId => {
      try {
        const completed = await executeWorkflowTask(user, taskId, result);
        return {
          taskId,
          success: true as const,
          runId: completed.runId,
          status: completed.status,
          canViewRun: completed.canViewRun,
        };
      } catch (error) {
        return {
          taskId,
          success: false as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );
}

export async function getTaskDashboard(user: User) {
  const [todo, done, initiatedTasks, initiatedInstances, allInstances] =
    await Promise.all([
      pageWorkflowTasks(user, { view: "todo", limit: 200, scanLimit: 200 }),
      pageWorkflowTasks(user, { view: "done", limit: 200, scanLimit: 200 }),
      pageWorkflowTasks(user, {
        view: "initiated",
        limit: 200,
        scanLimit: 200,
      }),
      pageProcessInstances(user, {
        view: "initiated",
        limit: 200,
        scanLimit: 200,
      }),
      pageProcessInstances(user, { view: "all", limit: 200, scanLimit: 200 }),
    ]);
  const recentTasks: any[] = [
    ...todo.items,
    ...done.items,
    ...initiatedTasks.items,
  ];
  const recent = Array.from(
    new Map<string, any>(
      recentTasks.map(task => [String(task.id), task])
    ).values()
  )
    .sort(
      (a: any, b: any) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime()
    )
    .slice(0, 8);
  return {
    counts: {
      todo: dashboardPageCount(todo),
      done: dashboardPageCount(done),
      initiated: dashboardPageCount(initiatedInstances),
      all: dashboardPageCount(allInstances),
    },
    recent,
  };
}

function dashboardPageCount(page: { items: unknown[]; hasMore: boolean }) {
  if (!page.hasMore) return page.items.length;
  return page.items.length ? `≥${page.items.length}` : "待确认";
}

export async function listProcessInstances(
  user: User,
  input: { view: "initiated" | "all"; limit?: number }
) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    input.view === "initiated"
      ? `SELECT r.*,w.name AS workflowName,w.projectId,initiator.name AS initiatedByName,ps.stateCode AS participantStateCode,ps.stateName AS participantStatusName,ps.flowStatus AS participantFlowStatus,ps.stateColor,ps.availableOperationsJson,${businessStateLabelSql} AS stateName,${recordedBusinessStateNameSql} AS currentStateName
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
           ${businessStateJoinSql}
          WHERE r.triggeredByUserId=? ORDER BY r.createdAt DESC LIMIT ?`
      : `SELECT r.*,w.name AS workflowName,w.projectId,initiator.name AS initiatedByName,ps.stateCode AS participantStateCode,ps.stateName AS participantStatusName,ps.flowStatus AS participantFlowStatus,ps.stateColor,ps.availableOperationsJson,${businessStateLabelSql} AS stateName,${recordedBusinessStateNameSql} AS currentStateName
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
           ${businessStateJoinSql}
          ORDER BY r.createdAt DESC LIMIT ?`,
    input.view === "initiated" ? [user.id, user.id, limit] : [user.id, limit]
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) {
    if (
      row.participantStatusName ||
      (await hasWorkflowPermission(
        user,
        String(row.workflowId),
        "workflow:view"
      ))
    ) {
      accessible.push(presentProcessInstance(row) as mysql.RowDataPacket);
    }
  }
  return accessible;
}

export async function pageProcessInstances(
  user: User,
  input: {
    view: "initiated" | "all";
    status?: string;
    search?: string;
    createdAtFrom?: Date;
    createdAtBefore?: Date;
    limit?: number;
    scanLimit?: number;
    cursor?: string;
  }
) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const initialCursor = decodeWorkbenchPageCursor(input.cursor, "instance");
  const clauses: string[] = [];
  const baseParams: unknown[] = [user.id];
  if (input.view === "initiated") {
    clauses.push("r.triggeredByUserId=?");
    baseParams.push(user.id);
  }
  const statusFilter = processInstanceStatusFilter(input.status);
  if (statusFilter.clause) {
    clauses.push(statusFilter.clause);
    baseParams.push(...statusFilter.params);
  }
  if (input.createdAtFrom) {
    clauses.push("r.createdAt>=?");
    baseParams.push(input.createdAtFrom);
  }
  if (input.createdAtBefore) {
    clauses.push("r.createdAt<?");
    baseParams.push(input.createdAtBefore);
  }
  const search = input.search?.trim();
  if (search) {
    clauses.push(
      `LOCATE(LOWER(?),LOWER(CONCAT_WS(' ',w.name,initiator.name,${businessStateLabelSql},ps.stateName,r.status)))>0`
    );
    baseParams.push(search);
  }

  const canViewWorkflow = workflowViewPermissionCache(user);
  return collectAuthorizedPage<
    mysql.RowDataPacket,
    Extract<WorkbenchPageCursor, { kind: "instance" }>
  >({
    limit,
    scanLimit: input.scanLimit,
    cursor: initialCursor?.kind === "instance" ? initialCursor : undefined,
    loadBatch: async (after, batchLimit) => {
      const batchClauses = [...clauses];
      const params = [...baseParams];
      if (after) {
        batchClauses.push("(r.createdAt<? OR (r.createdAt=? AND r.id<?))");
        params.push(after.createdAt, after.createdAt, after.id);
      }
      params.push(batchLimit);
      const [rows] = await db().query<mysql.RowDataPacket[]>(
        `SELECT r.*,w.name AS workflowName,w.projectId,
                initiator.name AS initiatedByName,ps.stateCode AS participantStateCode,ps.stateName AS participantStatusName,ps.flowStatus AS participantFlowStatus,
                ${businessStateLabelSql} AS stateName,${recordedBusinessStateNameSql} AS currentStateName,
                ps.stateColor,ps.availableOperationsJson,
                DATE_FORMAT(r.createdAt,'%Y-%m-%d %H:%i:%s.%f') AS cursorCreatedAt
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId
           LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(
             SELECT latest.id FROM workflow_participant_state latest
              WHERE latest.runId=r.id AND latest.userId=?
              ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1
           )
           ${businessStateJoinSql}
          ${batchClauses.length ? `WHERE ${batchClauses.join(" AND ")}` : ""}
          ORDER BY r.createdAt DESC,r.id DESC
          LIMIT ?`,
        params
      );
      return rows;
    },
    getCursor: row => ({
      kind: "instance",
      createdAt: String(row.cursorCreatedAt),
      id: String(row.id),
    }),
    isAuthorized: async row =>
      user.role === "admin" ||
      Boolean(row.participantStatusName) ||
      (await canViewWorkflow(String(row.workflowId))),
  }).then(page => ({
    ...page,
    items: page.items.map(presentProcessInstance),
  }));
}

export async function getTaskCalendar(
  user: User,
  range: { start: Date; end: Date; limit?: number; cursor?: string }
) {
  if (
    Number.isNaN(range.start.getTime()) ||
    Number.isNaN(range.end.getTime()) ||
    range.start >= range.end
  ) {
    throw new Error("日历查询的起止时间无效。 ");
  }
  const page = await pageWorkflowTasks(user, {
    view: "all",
    createdAtFrom: range.start,
    createdAtBefore: range.end,
    limit: range.limit ?? 200,
    cursor: range.cursor,
  });
  return {
    ...page,
    items: page.items.map((task: any) => ({
      id: task.id,
      title: `${task.workflowName} · ${task.nodeName}`,
      start: task.createdAt,
      status: task.status,
      workflowId: task.workflowId,
      runId: task.runId,
    })),
  };
}

export type ReviewerMode = "project_owner_or_admin" | "independent_reviewer";

export async function getP1SystemSettings(options?: { connection?: mysql.PoolConnection; lock?: boolean }) {
  const [rows] = await (options?.connection ?? db()).query<mysql.RowDataPacket[]>(
    "SELECT * FROM system_setting WHERE `key` IN ('general','approval')" + (options?.lock ? " FOR SHARE" : "")
  );
  const settings: Record<string, unknown> = { ...defaultSettings };
  rows.forEach(row => {
    settings[row.key] = parseJson(row.valueJson);
  });
  const values = settings as typeof defaultSettings;
  return { ...values, configTokens: {
    general: systemSettingConfigToken("general", values.general),
    approval: systemSettingConfigToken("approval", values.approval),
  } };
}

export async function getPublicGeneralSettings() {
  const settings = await getP1SystemSettings();
  return {
    platformName: String(
      settings.general.platformName || "Flow AI Engine"
    ).slice(0, 120),
    watermarkEnabled: Boolean(settings.general.watermarkEnabled),
    watermarkText: String(settings.general.watermarkText || "").slice(0, 120),
  };
}

export async function isProjectApprovalRequired(connection?: mysql.PoolConnection) {
  return Boolean((await getP1SystemSettings(connection ? { connection, lock: true } : undefined)).approval.requireProjectApproval);
}

export async function updateP1SystemSetting(
  user: User,
  key: "general" | "approval",
  value: JsonRecord,
  expectedConfigToken?: string
) {
  if (!expectedConfigToken) assertSystemSettingConfigToken(key, expectedConfigToken, null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const connection = await db().getConnection();
    let retry = false;
    try {
      await connection.beginTransaction();
      const [actors] = await connection.query<mysql.RowDataPacket[]>("SELECT id,role,status,tokenVersion FROM users WHERE id=? FOR UPDATE", [user.id]);
      const actor = actors[0];
      if (!actor || actor.role !== "admin" || actor.status !== "active" || (user.tokenVersion !== undefined && Number(actor.tokenVersion) !== user.tokenVersion)) throw new TRPCError({ code: "FORBIDDEN", message: "当前账号无权维护系统设置，请刷新权限后重试。" });
      const [rows] = await connection.query<mysql.RowDataPacket[]>("SELECT valueJson FROM system_setting WHERE `key`=? FOR UPDATE", [key]);
      const existing = readSystemSettingValue(key, parseJson(rows[0]?.valueJson));
      assertSystemSettingConfigToken(key, expectedConfigToken, existing);
      const merged = mergeSystemSettingValue(key, existing, value);
      const configToken = systemSettingConfigToken(key, merged);
      if (configToken !== expectedConfigToken) {
        await connection.query("INSERT INTO system_setting (`key`,valueJson,updatedByUserId) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valueJson=VALUES(valueJson),updatedByUserId=VALUES(updatedByUserId),updatedAt=NOW()", [key, JSON.stringify(merged), user.id]);
        await recordAuthorizationAudit({ actorUserId: user.id, action: "user_updated", resourceType: "system_setting", resourceId: key, details: { operation: "setting_updated" } }, connection);
      }
      await connection.commit();
      return { value: merged, configToken };
    } catch (error) {
      await connection.rollback();
      const failure = error as { errno?: number; code?: string };
      const deadlock = failure.errno === 1213 || failure.code === "ER_LOCK_DEADLOCK";
      if (deadlock && attempt < 2) retry = true;
      else if (deadlock) throw new TRPCError({ code: "CONFLICT", message: "配置正被其他操作占用，本次未保存。请稍后重试，当前填写已保留。" });
      else throw error;
    } finally { connection.release(); }
    if (retry) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 10));
  }
  throw new Error("系统设置保存未完成。");
}

export async function listWorkDomains() {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT d.*,u.name AS creatorName,u.username AS creatorUsername,(SELECT COUNT(*) FROM flow_project p WHERE p.domainId=d.id AND p.status='active') AS projectCount FROM work_domain d LEFT JOIN users u ON u.id=d.createdByUserId ORDER BY d.status,d.updatedAt DESC"
  );
  return rows;
}

export async function listActiveWorkDomains() {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,code,name,description FROM work_domain WHERE status='active' ORDER BY code"
  );
  return rows;
}

export async function createWorkDomain(
  user: User,
  input: { code: string; name: string; description?: string }
) {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(code))
    throw new Error(
      "工作域代号须以字母开头，且仅包含大写字母、数字、下划线或连字符。 "
    );
  const id = randomUUID();
  await db().query(
    "INSERT INTO work_domain (id,code,name,description,createdByUserId) VALUES (?,?,?,?,?)",
    [id, code, input.name.trim(), input.description?.trim() || null, user.id]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "work_domain",
    resourceId: id,
    details: { operation: "domain_created", code },
  });
  return id;
}

export async function updateWorkDomain(
  user: User,
  input: {
    id: string;
    name?: string;
    description?: string | null;
    status?: "active" | "disabled";
  }
) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM work_domain WHERE id=? LIMIT 1",
    [input.id]
  );
  const domain = rows[0];
  if (!domain) throw new Error("工作域不存在。 ");
  await db().query(
    "UPDATE work_domain SET name=?,description=?,status=?,updatedAt=NOW() WHERE id=?",
    [
      input.name?.trim() || domain.name,
      input.description === undefined
        ? domain.description
        : input.description?.trim() || null,
      input.status ?? domain.status,
      input.id,
    ]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "work_domain",
    resourceId: input.id,
    details: { operation: "domain_updated" },
  });
  return true;
}
