import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { getSharedPool } from "./db";
import { hasWorkflowPermission, recordAuthorizationAudit } from "./iam-service";
import { resumeWorkflowTask } from "./workflow-engine";
import { wakeWorkflowWorker } from "./workflow-worker";

type User = { id: number; role: "user" | "admin" };
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

function taskFilter(view: TaskView, userId: number) {
  if (view === "todo")
    return {
      clause:
        "t.status IN ('pending','claimed') AND (t.assignedUserId=? OR t.claimedByUserId=? OR (t.assignedUserId IS NULL AND (t.candidateUserIdsJson IS NULL OR JSON_LENGTH(t.candidateUserIdsJson)=0 OR JSON_CONTAINS(t.candidateUserIdsJson,?))))",
      params: [userId, userId, JSON.stringify(userId)],
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
    ].some(value => Number(value) === userId) || candidateIds(task).includes(userId)
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
  if (!["running", "waiting"].includes(String(task.runStatus)))
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

export async function listWorkflowTasks(
  user: User,
  input: {
    view: TaskView;
    projectId?: string;
    status?: "pending" | "claimed" | "completed" | "cancelled";
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
  if (input.status) {
    clauses.push("t.status=?");
    params.push(input.status);
  }
  params.push(Math.min(Math.max(input.limit ?? 100, 1), 200));
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,
            g.totalApprovers,g.requiredApprovals,g.memberVersion,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId LEFT JOIN users assignee ON assignee.id=t.assignedUserId
      WHERE ${clauses.join(" AND ")} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,t.createdAt DESC LIMIT ?`,
    params
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows)
    if (await canAccessTask(user, row)) accessible.push(presentTask(row));
  return accessible;
}

export async function getWorkflowTask(user: User, taskId: string) {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    `SELECT t.*,w.name AS workflowName,w.flowType,w.ownerUserId,r.status AS runStatus,r.triggeredByUserId,initiator.name AS initiatedByName,assignee.name AS assignedName,
            responsible.name AS responsibleName,represented.name AS representedName,
            g.totalApprovers,g.requiredApprovals,g.memberVersion,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed') AS completedDecisions,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='approved') AS approvedApprovals,
            (SELECT COUNT(*) FROM workflow_task gt WHERE gt.approvalGroupId=t.approvalGroupId AND gt.status='completed' AND JSON_UNQUOTE(JSON_EXTRACT(gt.resultJson,'$.decision'))='rejected') AS rejectedApprovals
       FROM workflow_task t JOIN workflow w ON w.id=t.workflowId JOIN workflow_run r ON r.id=t.runId
       LEFT JOIN workflow_task_group g ON g.id=t.approvalGroupId
       LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
       LEFT JOIN users assignee ON assignee.id=t.assignedUserId
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
  return {
    ...presentTask(task),
    nextNodeIds: parseJson(task.nextNodeIdsJson),
    approvalMembers,
  };
}

export async function claimWorkflowTask(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true)))
    throw new Error("无权领取该人工任务。 ");
  await assertCurrentTaskOperation(user, task);
  if (task.assignedUserId && Number(task.assignedUserId) !== user.id)
    throw new Error("该人工任务已指定其他处理人。 ");
  if (task.approvalGroupId && task.signMode === "sequentialSignFor") {
    const [prior] = await db().query<mysql.RowDataPacket[]>(
      "SELECT id FROM workflow_task WHERE approvalGroupId=? AND approvalOrder<? AND status IN ('pending','claimed') LIMIT 1",
      [task.approvalGroupId, Number(task.approvalOrder ?? 0)]
    );
    if (prior[0]) throw new Error("顺序会签尚未轮到当前审批人。 ");
  }
  const [result] = await db().query<mysql.ResultSetHeader>(
    "UPDATE workflow_task SET status='claimed',claimedByUserId=?,claimedAt=NOW(),ownerVersion=ownerVersion+1 WHERE id=? AND status='pending' AND ownerVersion=?",
    [user.id, taskId, Number(task.ownerVersion ?? 0)]
  );
  if (!result.affectedRows) throw new Error("人工任务已被领取或已结束。 ");
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
  if (!task) throw new Error("人工任务不存在或无访问权限。");
  if (task.status === "pending") await claimWorkflowTask(user, taskId);
  else if (
    task.status !== "claimed" ||
    Number(task.claimedByUserId) !== user.id
  )
    throw new Error("当前操作不可执行，请刷新任务状态。");
  await assertCurrentTaskOperation(user, task);
  return completeWorkflowTask(user, taskId, result);
}

export async function completeWorkflowTask(
  user: User,
  taskId: string,
  result: JsonRecord
) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task) throw new Error("人工任务不存在或无访问权限。 ");
  if (!(await canAccessTask(user, task, true)))
    throw new Error("无权完成该人工任务。 ");
  if (task.status !== "claimed" || Number(task.claimedByUserId) !== user.id)
    throw new Error("仅当前领取人可完成已领取的人工任务。 ");
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
  return resumed;
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

export async function listWorkflowTaskAssignees(user: User, taskId: string) {
  const task: any = await getWorkflowTask(user, taskId);
  if (!task || !(await canAccessTask(user, task, true)))
    throw new Error("人工任务不存在或无分配权限。 ");
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT id,username,name,email,role FROM users WHERE status='active' ORDER BY COALESCE(name,username),id LIMIT 200"
  );
  const eligible: Array<{
    id: number;
    username: string;
    name: string | null;
    email: string | null;
  }> = [];
  for (const candidate of rows) {
    const candidateUser: User = {
      id: Number(candidate.id),
      role: candidate.role === "admin" ? "admin" : "user",
    };
    if (
      await hasWorkflowPermission(
        candidateUser,
        String(task.workflowId),
        "workflow:run"
      )
    ) {
      eligible.push({
        id: Number(candidate.id),
        username: String(candidate.username),
        name: candidate.name ?? null,
        email: candidate.email ?? null,
      });
    }
  }
  return eligible;
}

export async function handoverWorkflowTask(
  user: User,
  input: { taskId: string; targetUserId: number; delegation?: boolean }
) {
  const actionLabel = input.delegation ? "代理" : "移交";
  const task: any = await getWorkflowTask(user, input.taskId);
  if (!task || !(await canAccessTask(user, task, true)))
    throw new Error(`人工任务不存在或无${actionLabel}权限。 `);
  if (
    !["pending", "claimed"].includes(String(task.status)) ||
    !["running", "waiting"].includes(String(task.runStatus))
  )
    throw new Error(`仅可${actionLabel}正在等待处理的人工任务。 `);
  if (task.status === "claimed" && Number(task.claimedByUserId) !== user.id)
    throw new Error(`仅当前处理人可${actionLabel}已领取任务。 `);
  await assertCurrentTaskOperation(user, task);
  const target = await getEligibleAssignee(task, input.targetUserId);
  const currentOwnerId =
    Number(task.claimedByUserId ?? task.assignedUserId ?? 0) || user.id;
  if (currentOwnerId === input.targetUserId)
    throw new Error("目标处理人已经是当前任务处理人。 ");
  const delegationId = input.delegation ? randomUUID() : null;
  const connection = await db().getConnection();
  try {
    await connection.beginTransaction();
    const [lockedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
      [input.taskId]
    );
    const locked = lockedRows[0];
    if (
      !locked ||
      String(locked.status) !== String(task.status) ||
      Number(locked.ownerVersion ?? 0) !== Number(task.ownerVersion ?? 0) ||
      !isCurrentTaskOwner(user.id, locked)
    ) {
      throw new Error("人工任务状态已变化，请刷新后重试。 ");
    }
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
          input.totalApprovers *
            Math.min(Math.max(input.passPercentBasisPoints, 1), 10000) /
            10000
        )
      )
    );
  return 1;
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
      "INSERT INTO workflow_task (id,workflowId,projectId,runId,nodeId,nodeName,assignedUserId,candidateUserIdsJson,approvalGroupId,signMode,approvalOrder,roleKey,operationName,operationCode,pendingStatusName,instruction,payloadJson,participantSnapshotJson,outcomeHandlesJson,responsibleUserId,formSchemaVersion,dueAt,nextNodeIdsJson,requestId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        source.payloadJson,
        JSON.stringify(participantSnapshot),
        source.outcomeHandlesJson,
        input.targetUserId,
        source.formSchemaVersion,
        source.dueAt,
        source.nextNodeIdsJson,
        source.requestId,
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
            return String(operation.taskId ?? operation.id ?? "") !== input.memberTaskId;
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
      listWorkflowTasks(user, { view: "todo", limit: 200 }),
      listWorkflowTasks(user, { view: "done", limit: 200 }),
      listWorkflowTasks(user, { view: "initiated", limit: 200 }),
      listProcessInstances(user, { view: "initiated", limit: 200 }),
      listProcessInstances(user, { view: "all", limit: 200 }),
    ]);
  const recent = Array.from(
    new Map(
      [...todo, ...done, ...initiatedTasks].map(task => [String(task.id), task])
    ).values()
  )
    .sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime()
    )
    .slice(0, 8);
  return {
    counts: {
      todo: todo.length,
      done: done.length,
      initiated: initiatedInstances.length,
      all: allInstances.length,
    },
    recent,
  };
}

export async function listProcessInstances(
  user: User,
  input: { view: "initiated" | "all"; limit?: number }
) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    input.view === "initiated"
      ? `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName,ps.stateCode,ps.stateName,ps.flowStatus,ps.stateColor,ps.availableOperationsJson
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
          WHERE r.triggeredByUserId=? ORDER BY r.createdAt DESC LIMIT ?`
      : `SELECT r.*,w.name AS workflowName,w.flowType,w.projectId,initiator.name AS initiatedByName,ps.stateCode,ps.stateName,ps.flowStatus,ps.stateColor,ps.availableOperationsJson
           FROM workflow_run r JOIN workflow w ON w.id=r.workflowId LEFT JOIN users initiator ON initiator.id=r.triggeredByUserId
           LEFT JOIN workflow_participant_state ps ON ps.id=(SELECT latest.id FROM workflow_participant_state latest WHERE latest.runId=r.id AND latest.userId=? ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 1)
          ORDER BY r.createdAt DESC LIMIT ?`,
    input.view === "initiated" ? [user.id, user.id, limit] : [user.id, limit]
  );
  const accessible: mysql.RowDataPacket[] = [];
  for (const row of rows) {
    if (
      row.stateName ||
      (await hasWorkflowPermission(
        user,
        String(row.workflowId),
        "workflow:view"
      ))
    ) {
      accessible.push({
        ...row,
        displayStatus: row.stateName || row.status,
        availableOperations: parseJson(row.availableOperationsJson),
      });
    }
  }
  return accessible;
}

export async function getTaskCalendar(user: User, month: Date) {
  const start = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)
  );
  const end = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)
  );
  const tasks = await listWorkflowTasks(user, { view: "all", limit: 200 });
  return tasks
    .filter(task => {
      const date = new Date(String(task.createdAt));
      return date >= start && date < end;
    })
    .map(task => ({
      id: task.id,
      title: `${task.workflowName} · ${task.nodeName}`,
      start: task.createdAt,
      status: task.status,
      workflowId: task.workflowId,
      runId: task.runId,
    }));
}

export type ReviewerMode = "project_owner_or_admin" | "independent_reviewer";

const defaultSettings = {
  general: {
    platformName: "Flow AI Engine",
    watermarkEnabled: false,
    watermarkText: "",
  },
  approval: {
    requireProjectApproval: true,
    reviewerMode: "project_owner_or_admin" as ReviewerMode,
  },
};

export async function getP1SystemSettings() {
  const [rows] = await db().query<mysql.RowDataPacket[]>(
    "SELECT * FROM system_setting WHERE `key` IN ('general','approval')"
  );
  const settings: Record<string, unknown> = { ...defaultSettings };
  rows.forEach(row => {
    settings[row.key] = parseJson(row.valueJson);
  });
  return settings as typeof defaultSettings;
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

export async function isProjectApprovalRequired() {
  return Boolean((await getP1SystemSettings()).approval.requireProjectApproval);
}

export async function updateP1SystemSetting(
  user: User,
  key: "general" | "approval",
  value: JsonRecord
) {
  if (
    key === "approval" &&
    value.reviewerMode !== undefined &&
    !["project_owner_or_admin", "independent_reviewer"].includes(
      String(value.reviewerMode)
    )
  )
    throw new Error("审核人模式无效。");
  const merged = { ...(defaultSettings[key] as JsonRecord), ...value };
  await db().query(
    "INSERT INTO system_setting (`key`,valueJson,updatedByUserId) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valueJson=VALUES(valueJson),updatedByUserId=VALUES(updatedByUserId),updatedAt=NOW()",
    [key, JSON.stringify(merged), user.id]
  );
  await recordAuthorizationAudit({
    actorUserId: user.id,
    action: "user_updated",
    resourceType: "system_setting",
    resourceId: key,
    details: { operation: "setting_updated" },
  });
  return merged;
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
