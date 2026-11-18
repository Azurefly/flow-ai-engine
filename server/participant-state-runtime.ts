import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  isParticipantStateDefinition,
  participantOperation,
  participantTaskBinding,
  PARTICIPANT_STATE_MODEL,
  type ParticipantCard,
  type ParticipantRelation,
  type ParticipantStateRuntime,
} from "../shared/participant-state";
import { readOperateOutcomes } from "../shared/workflow-node-contract";
import { getSharedPool } from "./db";
import {
  resolveOperateAssignees,
  resolveWorkflowUserRoleKeys,
} from "./organization-service";
import {
  stableWorkflowJson,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./workflow-compiler";
import {
  planParticipantStateChange,
  type ParticipantStateChange,
} from "./participant-state-plan";
import { resolveTemplates } from "./workflow-routing";
import { normalizeReferenceRouterConfig } from "../shared/reference-router-config";
import { participantConditionLeaves } from "../shared/participant-route-condition";
import { participantRouteConditionSchema } from "./participant-route-condition-schema";
import { resolveParticipantDepartments } from "./participant-route-condition";

type JsonRecord = Record<string, any>;
type CommandResult = {
  runId: string;
  status: "waiting" | "success";
  taskId: string;
  stateVersion: number;
  participantState: true;
};
const parse = (value: any): any =>
  typeof value === "string" ? JSON.parse(value) : value;
function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

function runtimeState(context: JsonRecord): ParticipantStateRuntime {
  const state = context.runtime?.participantState;
  if (state?.version !== 1 || !state.cards || !state.relations)
    throw new Error("参与人状态快照无效。");
  return state;
}

function cardOperations(
  definition: WorkflowDefinition,
  card: ParticipantCard,
  state: ParticipantStateRuntime
) {
  const current = definition.nodes.find(node => node.id === card.stateNodeId);
  if (current?.config.stateType === "terminal") return [];
  const targets = new Set(
    definition.edges
      .filter(edge => edge.sourceNodeId === card.stateNodeId)
      .map(edge => edge.targetNodeId)
  );
  const relation = card.relationId
    ? state.relations[card.relationId]
    : undefined;
  return definition.nodes
    .filter(node => node.type === "operate" && targets.has(node.id))
    .filter(node => {
      const operation = participantOperation(node.config);
      if (operation.relation === "consume")
        return relation?.status === "active";
      if (operation.relation === "create") return relation?.status !== "active";
      return true;
    });
}

async function recordNode(
  connection: PoolConnection,
  run: JsonRecord,
  node: WorkflowNode,
  status: "waiting" | "success",
  output: unknown
) {
  const id = randomUUID();
  run.nextNodeSequence = Number(run.nextNodeSequence ?? 0) + 1;
  await connection.query(
    "INSERT INTO workflow_node_run (id,runId,sequenceNo,nodeId,nodeType,nodeName,status,inputJson,outputJson,requestId,startedAt,finishedAt,durationMs) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),IF(?='success',NOW(),NULL),IF(?='success',0,NULL))",
    [
      id,
      run.id,
      run.nextNodeSequence,
      node.id,
      node.type,
      node.name,
      status,
      JSON.stringify({ model: PARTICIPANT_STATE_MODEL }),
      JSON.stringify(output),
      run.requestId ?? null,
      status,
      status,
    ]
  );
  return id;
}

async function cancelTaskSchedules(
  connection: PoolConnection,
  taskIds: string[]
) {
  const [schedules] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM workflow_task_schedule WHERE taskId IN (?) AND status='scheduled'",
    [taskIds]
  );
  if (schedules.length)
    await connection.query(
      "UPDATE workflow_task_schedule SET status='cancelled' WHERE id IN (?) AND status='scheduled'",
      [schedules.map(schedule => schedule.id)]
    );
}

async function replaceCardOperations(
  connection: PoolConnection,
  input: {
    run: JsonRecord;
    definition: WorkflowDefinition;
    context: JsonRecord;
    state: ParticipantStateRuntime;
    card: ParticipantCard;
    stateColor: string | null;
  }
) {
  const { run, definition, context, state, card } = input;
  const [oldTasks] = await connection.query<RowDataPacket[]>(
    "SELECT id,payloadJson FROM workflow_task WHERE runId=? AND assignedUserId=? AND roleKey='default' AND status IN ('pending','claimed')",
    [run.id, card.userId]
  );
  for (const task of oldTasks) {
    const nodeRunId = parse(task.payloadJson)?.nodeRunId;
    if (nodeRunId)
      await connection.query(
        "UPDATE workflow_node_run SET status='skipped',finishedAt=NOW(),outputJson=? WHERE id=? AND status='waiting'",
        [JSON.stringify({ reason: "个人状态或本轮提交关系已变化" }), nodeRunId]
      );
  }
  // The run row serializes state changes. Exact task IDs avoid locking adjacent runs' index gaps.
  if (oldTasks.length) {
    const taskIds = oldTasks.map(task => String(task.id));
    await cancelTaskSchedules(connection, taskIds);
    await connection.query(
      "UPDATE workflow_task SET status='cancelled',completedAt=NOW(),ownerVersion=ownerVersion+1 WHERE id IN (?) AND status IN ('pending','claimed')",
      [taskIds]
    );
  }
  const operations: JsonRecord[] = [];
  for (const node of cardOperations(definition, card, state)) {
    const taskId = randomUUID();
    const config = resolveTemplates(node.config, {
      ...context,
      participant: card,
    }) as JsonRecord;
    const outcomes = readOperateOutcomes(config);
    const outcomeHandles = {
      mode: "explicit",
      outcomes,
      handles: Object.fromEntries(
        outcomes.map(outcome => [outcome.code, outcome.sourceHandle])
      ),
    };
    const nodeRunId = await recordNode(connection, run, node, "waiting", {
      taskId,
      userId: card.userId,
      cardVersion: card.version,
    });
    const operationName = String(config.czmc || node.name);
    const operationCode = String(
      config.nodeDh || config.commandCode || node.id
    );
    const binding = {
      model: PARTICIPANT_STATE_MODEL,
      stateNodeId: card.stateNodeId,
      cardVersion: card.version,
      relationId: card.relationId,
    };
    const payload = {
      nodeRunId,
      config,
      context: { input: context.input, vars: context.vars },
      participantState: binding,
    };
    const due = Number(config.dueAfterSeconds ?? 0);
    await connection.query(
      `INSERT INTO workflow_task
        (id,workflowId,projectId,runId,nodeId,nodeName,assignedUserId,candidateUserIdsJson,roleKey,operationName,operationCode,pendingStatusName,instruction,payloadJson,participantSnapshotJson,outcomeHandlesJson,responsibleUserId,formSchemaVersion,dueAt,nextNodeIdsJson,requestId,executionKey)
        VALUES (?,?,?,?,?,?,?,?,'default',?,?,?,?,?,?,?,?,?,IF(? > 0,DATE_ADD(NOW(),INTERVAL ? SECOND),NULL),?,?,?)`,
      [
        taskId,
        run.workflowId,
        run.projectId ?? null,
        run.id,
        node.id,
        node.name,
        card.userId,
        JSON.stringify([card.userId]),
        operationName,
        operationCode,
        card.stateName,
        String(config.instruction || operationName),
        JSON.stringify(payload),
        JSON.stringify({
          userIds: [card.userId],
          cardVersion: card.version,
          relationId: card.relationId,
        }),
        JSON.stringify(outcomeHandles),
        card.userId,
        Number(config.formSchemaVersion || 1),
        due,
        due,
        JSON.stringify(
          definition.edges
            .filter(edge => edge.sourceNodeId === node.id)
            .map(edge => edge.targetNodeId)
        ),
        run.requestId ?? null,
        `participant:${card.version}`,
      ]
    );
    for (const [eventType, field] of [
      ["reminder", "reminderAfterSeconds"],
      ["due", "dueAfterSeconds"],
      ["escalation", "escalationAfterSeconds"],
    ]) {
      const seconds = Number(config[field] ?? 0);
      if (!seconds) continue;
      await connection.query(
        "INSERT INTO workflow_task_schedule (id,taskId,runId,workflowId,recipientUserId,eventType,status,fireAt,payloadJson,requestId) VALUES (?,?,?,?,?,?,'scheduled',DATE_ADD(NOW(),INTERVAL ? SECOND),?,?)",
        [
          randomUUID(),
          taskId,
          run.id,
          run.workflowId,
          eventType === "escalation" ? run.ownerUserId : card.userId,
          eventType,
          seconds,
          JSON.stringify({ nodeId: node.id, operationName }),
          run.requestId ?? null,
        ]
      );
    }
    operations.push({
      taskId,
      code: operationCode,
      name: operationName,
      nodeId: node.id,
      cardVersion: card.version,
      outcomeMode: "explicit",
      outcomes,
    });
  }
  const values = [card.stateCode, card.stateName, card.stateName, input.stateColor, card.stateNodeId, JSON.stringify(operations)];
  const [existing] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM workflow_participant_state WHERE runId=? AND userId=? AND roleKey='default'",
    [run.id, card.userId]
  );
  if (existing.length) {
    await connection.query(
      "UPDATE workflow_participant_state SET stateCode=?,stateName=?,flowStatus=?,stateColor=?,sourceNodeId=?,availableOperationsJson=?,updatedAt=NOW() WHERE id=?",
      [...values, existing[0].id]
    );
  } else {
    await connection.query(
      "INSERT INTO workflow_participant_state (id,runId,workflowId,userId,roleKey,stateCode,stateName,flowStatus,stateColor,sourceNodeId,availableOperationsJson) VALUES (?,?,?,?,'default',?,?,?,?,?,?)",
      [randomUUID(), run.id, run.workflowId, card.userId, ...values]
    );
  }
  return operations;
}

async function persistParticipantCommand(
  connection: PoolConnection,
  input: {
    run: JsonRecord;
    definition: WorkflowDefinition;
    context: JsonRecord;
    state: ParticipantStateRuntime;
    changes: ParticipantStateChange[];
    impactedUserIds: number[];
    actorUserId: number;
    commandCode: string;
    taskId?: string;
    result?: JsonRecord;
    relation?: ParticipantRelation;
  }
) {
  const { run, definition, context, state, changes } = input;
  const nextVersion = Number(run.stateVersion ?? 0) + 1;
  const changesByUser = new Map(changes.map(change => [change.userId, change]));
  const beforeCards = structuredClone(state.cards);
  for (const change of changes) {
    state.cards[String(change.userId)] = {
      userId: change.userId,
      stateNodeId: change.stateNodeId,
      stateCode: change.stateCode,
      stateName: change.stateName,
      version: nextVersion,
      relationId:
        input.relation?.status === "active" &&
        (input.relation.senderUserId === change.userId ||
          input.relation.receiverUserIds.includes(change.userId))
          ? input.relation.id
          : (change.before?.relationId ?? null),
    };
  }
  const impacted = Array.from(
    new Set([...input.impactedUserIds, ...changes.map(change => change.userId)])
  ).sort((a, b) => a - b);
  for (const userId of impacted) {
    const card = state.cards[String(userId)];
    if (!card) throw new Error(`人员 ${userId} 尚未分配状态。`);
    card.version = nextVersion;
    if (
      card.relationId &&
      state.relations[card.relationId]?.status !== "active"
    )
      card.relationId = null;
  }
  const allTerminal = Object.values(state.cards).every(
    card =>
      definition.nodes.find(node => node.id === card.stateNodeId)?.config
        .stateType === "terminal"
  );
  const status = allTerminal ? "success" : "waiting";
  const stateCode = allTerminal ? "PARTICIPANT_COMPLETE" : "PARTICIPANT_ACTIVE";
  const stateName = allTerminal ? "已完成" : "办理中";
  for (const userId of impacted) {
    const card = state.cards[String(userId)];
    const node = definition.nodes.find(node => node.id === card.stateNodeId)!;
    await replaceCardOperations(connection, {
      run,
      definition,
      context,
      state,
      card,
      stateColor:
        changesByUser.get(userId)?.stateColor ??
        (String(node.config.stateColor || "") || null),
    });
  }
  const [pending] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM workflow_task WHERE runId=? AND status IN ('pending','claimed') ORDER BY createdAt,id LIMIT 1",
    [run.id]
  );
  if (!allTerminal && !pending[0])
    throw new Error(
      "变更后所有参与人均无可执行操作且未全部结束，请调整目标状态或关系配置。"
    );
  const response: CommandResult = {
    runId: String(run.id),
    status,
    taskId: String(pending[0]?.id ?? ""),
    stateVersion: nextVersion,
    participantState: true,
  };
  const traces = new Map<string, number[]>();
  for (const change of changes)
    for (const id of change.path)
      traces.set(id, [...(traces.get(id) ?? []), change.userId]);
  for (const [id, userIds] of Array.from(traces))
    await recordNode(
      connection,
      run,
      definition.nodes.find(node => node.id === id)!,
      "success",
      { userIds, stateVersion: nextVersion }
    );
  if (allTerminal) {
    const end = definition.nodes.find(node => node.type === "end")!;
    await recordNode(connection, run, end, "success", { cards: state.cards });
  }
  const details = impacted.map(userId => ({
    userId,
    before: beforeCards[String(userId)] ?? null,
    after: state.cards[String(userId)],
  }));
  context.runtime.participantState = state;
  context.runtime.participantUserIds = Object.values(state.cards).map(
    card => card.userId
  );
  context.runtime.executionQueue = [];
  context.runtime.executionCurrentNodeId = null;
  await connection.query(
    `INSERT INTO workflow_state_transition (id,runId,workflowId,sequenceNo,fromStateCode,toStateCode,transitionCode,taskId,actorUserId,responsibleUserId,payloadJson,resultJson,requestId,executionKey)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      run.id,
      run.workflowId,
      nextVersion,
      run.currentStateCode ?? null,
      stateCode,
      input.commandCode,
      input.taskId ?? null,
      input.actorUserId,
      input.actorUserId,
      JSON.stringify({
        model: PARTICIPANT_STATE_MODEL,
        stateName,
        changes: details,
        relation: input.relation ?? null,
      }),
      JSON.stringify({ request: input.result ?? null, response }),
      run.requestId ?? null,
      `participant:${nextVersion}`,
    ]
  );
  await connection.query(
    "INSERT INTO workflow_outbox_event (id,eventType,aggregateType,aggregateId,dedupeKey,payloadJson,status,maxAttempts) VALUES (?,'workflow.state.changed','workflow_run',?,?,?,'queued',8)",
    [
      randomUUID(),
      run.id,
      `workflow-state-changed:${run.id}:${nextVersion}`,
      JSON.stringify({
        runId: run.id,
        workflowId: run.workflowId,
        sequenceNo: nextVersion,
        changes: details,
      }),
    ]
  );
  await connection.query(
    `UPDATE workflow_run SET status=?,currentStateCode=?,currentStateNodeId=NULL,stateVersion=?,nextNodeSequence=?,contextJson=?,
      finalOutputJson=?,finishedAt=IF(?='success',NOW(),NULL),endReason=IF(?='success','completed',NULL),
      durationMs=IF(?='success',GREATEST(0,TIMESTAMPDIFF(MICROSECOND,startedAt,NOW()) DIV 1000),NULL),executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?`,
    [
      status,
      stateCode,
      nextVersion,
      run.nextNodeSequence,
      JSON.stringify(context),
      allTerminal ? JSON.stringify({ cards: state.cards }) : null,
      status,
      status,
      status,
      run.id,
    ]
  );
  return response;
}

export async function initializeParticipantStateRun(
  runId: string,
  leaseToken?: string
) {
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const [runs] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM workflow_run WHERE id=? FOR UPDATE",
      [runId]
    );
    const run = runs[0];
    if (
      !run ||
      run.status !== "running" ||
      (leaseToken && run.executionLockToken !== leaseToken)
    )
      conflict("运行租约或状态已变化。");
    const [workflows] = await connection.query<RowDataPacket[]>(
      "SELECT projectId,ownerUserId FROM workflow WHERE id=?",
      [run.workflowId]
    );
    run.projectId = workflows[0]?.projectId;
    run.ownerUserId = workflows[0]?.ownerUserId;
    const definition = parse(run.definitionSnapshotJson) as WorkflowDefinition;
    if (!isParticipantStateDefinition(definition))
      throw new Error("此运行未使用参与人状态模式。");
    const context = parse(run.contextJson) as JsonRecord;
    if (context.runtime.participantState) {
      const [tasks] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM workflow_task WHERE runId=? AND status IN ('pending','claimed') ORDER BY createdAt,id LIMIT 1",
        [runId]
      );
      const status = tasks.length ? "waiting" : "success";
      await connection.query(
        "UPDATE workflow_run SET status=?,executionLockToken=NULL,executionLockExpiresAt=NULL WHERE id=?",
        [status, runId]
      );
      await connection.commit();
      return {
        runId,
        status,
        taskId: String(tasks[0]?.id ?? ""),
        output: { cards: runtimeState(context).cards },
      } as const;
    }
    const state: ParticipantStateRuntime = {
      version: 1,
      cards: {},
      relations: {},
    };
    const start = definition.nodes.find(node => node.type === "start")!;
    const initialOutput = resolveTemplates(
      start.config.initialVariables ?? {},
      context
    );
    context.vars = {
      ...context.vars,
      [start.id]: initialOutput,
      ...(initialOutput as JsonRecord),
    };
    context.nodes = { ...context.nodes, [start.id]: initialOutput };
    const initial = definition.edges.find(
      edge => edge.sourceNodeId === start.id
    )!;
    await recordNode(connection, run, start, "success", {
      userId: run.triggeredByUserId,
    });
    const actorUserId = Number(run.triggeredByUserId);
    const changes = planParticipantStateChange({
      definition,
      entryNodeId: initial.targetNodeId,
      actorUserId,
      initiatorUserId: actorUserId,
      userIds: [actorUserId],
      receiverUserIds: [],
      cards: state.cards,
      roles: new Map(),
      context,
    });
    const response = await persistParticipantCommand(connection, {
      run,
      definition,
      context,
      state,
      changes,
      impactedUserIds: [actorUserId],
      actorUserId,
      commandCode: "initialize",
    });
    await connection.commit();
    return { ...response, output: { cards: state.cards } };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** The caller already holds the run lock. No statement in this function commits separately. */
export async function completeParticipantStateTask(
  connection: PoolConnection,
  input: {
    taskId: string;
    actorUserId: number;
    result: JsonRecord;
    runId: string;
  }
) {
  const [runs] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM workflow_run WHERE id=? FOR UPDATE",
    [input.runId]
  );
  const run = runs[0];
  const [tasks] = await connection.query<RowDataPacket[]>(
    "SELECT * FROM workflow_task WHERE id=? FOR UPDATE",
    [input.taskId]
  );
  const task = tasks[0];
  if (
    !run ||
    run.status !== "waiting" ||
    !task ||
    task.status !== "claimed" ||
    Number(task.claimedByUserId) !== input.actorUserId ||
    Number(task.assignedUserId) !== input.actorUserId
  )
    conflict("个人状态操作已结束或发生变化，请刷新后重试。");
  const [users] = await connection.query<RowDataPacket[]>(
    "SELECT status FROM users WHERE id=? FOR SHARE",
    [input.actorUserId]
  );
  if (users[0]?.status !== "active")
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号已停用。" });
  const [workflows] = await connection.query<RowDataPacket[]>(
    "SELECT projectId,ownerUserId FROM workflow WHERE id=?",
    [run.workflowId]
  );
  run.projectId = workflows[0]?.projectId;
  run.ownerUserId = workflows[0]?.ownerUserId;
  const definition = parse(run.definitionSnapshotJson) as WorkflowDefinition;
  const context = parse(run.contextJson) as JsonRecord;
  const state = runtimeState(context);
  const binding = participantTaskBinding(task.payloadJson);
  const card = state.cards[String(input.actorUserId)];
  if (
    !binding ||
    !card ||
    binding.cardVersion !== card.version ||
    binding.stateNodeId !== card.stateNodeId ||
    binding.relationId !== card.relationId
  )
    conflict("此操作属于旧状态或旧提交轮次，请打开最新待办。");
  const node = cardOperations(definition, card, state).find(
    node => node.id === task.nodeId
  );
  if (!node) conflict("当前个人状态不允许执行此操作。");
  const outcome = readOperateOutcomes(node.config).find(
    outcome => outcome.code === input.result.outcome
  );
  const edge =
    outcome &&
    definition.edges.find(
      edge =>
        edge.sourceNodeId === node.id &&
        (edge.sourceHandle || "default") === outcome.sourceHandle
    );
  if (!edge) throw new Error("业务结果缺少有效路由。");
  const operation = participantOperation(node.config);
  const previousRelation = card.relationId
    ? state.relations[card.relationId]
    : undefined;
  let relation: ParticipantRelation | undefined;
  let receiverUserIds: number[] = [];
  const affected = new Set<number>([input.actorUserId]);
  const nextVersion = Number(run.stateVersion ?? 0) + 1;
  context.result = input.result;
  context.vars = { ...context.vars, [node.id]: input.result };
  context.nodes = { ...context.nodes, [node.id]: input.result };
  context.runtime.lastActorUserId = input.actorUserId;
  if (operation.relation === "create") {
    if (previousRelation?.status === "active")
      conflict("请先结束当前提交关系再创建新一轮提交。");
    const assignment = await resolveOperateAssignees({
      config: resolveTemplates(node.config, context) as JsonRecord,
      context,
      workflowId: String(run.workflowId),
      connection,
    });
    receiverUserIds = assignment.candidateUserIds;
    if (!receiverUserIds.length) throw new Error("请选择有效接收人。");
    const [activeReceivers] = await connection.query<RowDataPacket[]>(
      "SELECT id,status FROM users WHERE id IN (?) ORDER BY id FOR SHARE",
      [receiverUserIds]
    );
    if (
      activeReceivers.length !== receiverUserIds.length ||
      activeReceivers.some(user => user.status !== "active")
    )
      conflict("接收人不存在或已停用，请重新选择。");
    for (const userId of receiverUserIds) {
      const receiverCard = state.cards[String(userId)];
      if (
        receiverCard?.relationId &&
        state.relations[receiverCard.relationId]?.status === "active"
      )
        conflict(`接收人 ${userId} 仍在另一轮提交关系中。`);
    }
    relation = {
      id: randomUUID(),
      senderUserId: input.actorUserId,
      receiverUserIds,
      status: "active",
      createdVersion: nextVersion,
    };
    state.relations[relation.id] = relation;
  } else if (operation.relation === "consume") {
    if (!previousRelation || previousRelation.status !== "active")
      conflict("本轮提交已被处理或撤回。");
    relation = {
      ...previousRelation,
      status: "closed",
      closedVersion: nextVersion,
    };
    state.relations[relation.id] = relation;
    for (const userId of [relation.senderUserId, ...relation.receiverUserIds])
      affected.add(userId);
  }
  let userIds = [input.actorUserId];
  if (operation.scope === "actor_and_receivers")
    userIds.push(...receiverUserIds);
  if (operation.scope === "relation" && relation)
    userIds = [relation.senderUserId, ...relation.receiverUserIds];
  if (operation.scope === "all")
    userIds = [
      ...Object.values(state.cards).map(card => card.userId),
      input.actorUserId,
      ...receiverUserIds,
    ];
  context.action = {
    actorUserId: input.actorUserId,
    receiverUserIds,
    relation: relation ?? null,
    operationNodeId: node.id,
    result: input.result,
  };
  const resultRelationId = relation?.id ?? card.relationId;
  state.operationResults ??= {};
  const previousResults = state.operationResults[String(input.actorUserId)];
  state.operationResults[String(input.actorUserId)] = {
    relationId: resultRelationId,
    results: {
      ...(previousResults?.relationId === resultRelationId
        ? previousResults.results
        : {}),
      [node.id]: input.result,
    },
  };
  const roles = await resolveWorkflowUserRoleKeys(
    userIds,
    String(run.workflowId),
    connection
  );
  const departmentConditions = definition.nodes
    .filter(node => node.type === "router")
    .flatMap(node => normalizeReferenceRouterConfig(node.config).rules)
    .filter(rule => rule.participantCondition !== undefined)
    .flatMap(rule =>
      participantConditionLeaves(
        participantRouteConditionSchema.parse(rule.participantCondition)
      )
    )
    .filter(condition => condition.kind === "department");
  const departments = await resolveParticipantDepartments(
    connection,
    userIds,
    departmentConditions.flatMap(condition => condition.unitIds)
  );
  const plannedChanges = planParticipantStateChange({
    definition,
    entryNodeId: edge.targetNodeId,
    actorUserId: input.actorUserId,
    initiatorUserId: Number(run.triggeredByUserId),
    userIds,
    receiverUserIds,
    relation,
    cards: state.cards,
    roles,
    departments,
    operationResults: state.operationResults,
    context,
  });
  // Keep another person's current task and deadline when a shared vote leaves their state intact.
  const changes = plannedChanges.filter(
    change =>
      change.userId === input.actorUserId ||
      operation.relation !== "none" ||
      change.before?.stateNodeId !== change.stateNodeId ||
      change.before.stateCode !== change.stateCode ||
      change.before.stateName !== change.stateName ||
      String(
        definition.nodes.find(node => node.id === change.stateNodeId)?.config
          .stateColor ?? ""
      ).includes("{{")
  );
  // Every member of a new relationship must receive a card bound to that exact submission.
  if (
    operation.relation === "create" &&
    [input.actorUserId, ...receiverUserIds].some(
      id => !changes.some(change => change.userId === id)
    )
  )
    throw new Error("新提交的发送人和接收人必须匹配明确的目标状态。");
  await connection.query(
    "UPDATE workflow_task SET status='completed',completedByUserId=?,resultJson=?,completedAt=NOW() WHERE id=?",
    [input.actorUserId, JSON.stringify(input.result), task.id]
  );
  await cancelTaskSchedules(connection, [String(task.id)]);
  const taskPayload = parse(task.payloadJson);
  await connection.query(
    "UPDATE workflow_node_run SET status='success',outputJson=?,finishedAt=NOW(),durationMs=GREATEST(0,TIMESTAMPDIFF(MICROSECOND,startedAt,NOW()) DIV 1000) WHERE id=? AND status='waiting'",
    [JSON.stringify(input.result), taskPayload.nodeRunId]
  );
  return persistParticipantCommand(connection, {
    run,
    definition,
    context,
    state,
    changes,
    impactedUserIds: Array.from(affected),
    actorUserId: input.actorUserId,
    commandCode: String(
      node.config.nodeDh || node.config.commandCode || node.id
    ),
    taskId: input.taskId,
    result: input.result,
    relation,
  });
}

export async function replayParticipantTask(
  task: JsonRecord,
  userId: number,
  result: JsonRecord
) {
  if (
    !participantTaskBinding(task.payloadJson ?? task.payload) ||
    task.status !== "completed"
  )
    return null;
  if (Number(task.completedByUserId) !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "无权重试他人的个人状态操作。",
    });
  if (
    stableWorkflowJson(parse(task.resultJson ?? task.result)) !==
    stableWorkflowJson(result)
  )
    conflict("该操作已成功提交，重试内容与原提交不一致。");
  const [rows] = await getSharedPool().query<RowDataPacket[]>(
    "SELECT resultJson FROM workflow_state_transition WHERE runId=? AND taskId=? AND actorUserId=? LIMIT 1",
    [task.runId, task.id, userId]
  );
  const response = parse(rows[0]?.resultJson)?.response as
    | CommandResult
    | undefined;
  if (!response) throw new Error("未找到已提交操作的状态变更记录。");
  return { ...response, deduplicated: true };
}
