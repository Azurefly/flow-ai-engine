import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { TRPCError } from "@trpc/server";
import {
  childCallOptions,
  isDurableSubflow,
  maxDurableCallSites,
} from "../shared/durable-subflow";
import { getWorkflowAccess } from "./iam-service";
import { getSharedPool } from "./db";
import { loadPublishedChild } from "./durable-subflow-binding";
import {
  WorkflowCompileError,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./workflow-compiler";
import type { WorkflowCheckpoint } from "./workflow-engine";
import { getPath } from "./workflow-routing";

type Json = Record<string, unknown>;
type Actor = { id: number; role: "admin" | "user"; tokenVersion?: number };
type Prepare = (
  id: string,
  definition: WorkflowDefinition,
  input: Json,
  actorId: number,
  requestId: string | null
) => WorkflowCheckpoint;
type Stop = (
  connection: mysql.PoolConnection,
  id: string,
  status: "failed" | "cancelled" | "terminated",
  reason: string,
  details: Json | null
) => Promise<void>;
const terminal = ["success", "failed", "cancelled", "terminated"];
export type ChildDecision = "retry" | "accept_failure" | "fail_parent";

function parse(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

export async function startDurableChild(
  connection: mysql.PoolConnection,
  input: {
    parentWorkflowId: string;
    parentRunId: string;
    node: WorkflowNode;
    actorId: number;
    waitId: string;
    executionKey: string;
    ordinal: number;
    mappedInput: unknown;
    requestId: string | null;
  },
  prepare: Prepare
) {
  if (
    !input.mappedInput ||
    typeof input.mappedInput !== "object" ||
    Array.isArray(input.mappedInput)
  )
    throw new Error("子流程入参必须解析为对象。");
  if (
    !Number.isInteger(input.node.config.childVersion) ||
    !input.node.config.childPlanHash
  )
    throw new Error("子流程尚未绑定发布版本和执行摘要，请重新保存父流程。");
  const child = await loadPublishedChild(
    input.node,
    input.parentWorkflowId,
    input.actorId,
    connection,
    true
  );
  const [active] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM workflow_run_link WHERE parentRunId=? AND waitId<>? AND state IN ('waiting','manual')",
    [input.parentRunId, input.waitId]
  );
  if (Number(active[0].total) >= maxDurableCallSites)
    throw new Error("单个父实例同时等待的子调用已达八个。");
  const options = childCallOptions(input.node.config);
  const runId = randomUUID(),
    linkId = randomUUID();
  const checkpoint = prepare(
    runId,
    child.plan.definition,
    input.mappedInput as Json,
    input.actorId,
    input.requestId
  );
  await connection.query(
    "INSERT INTO workflow_run (id,workflowId,ownerUserId,triggeredByUserId,flowType,triggerType,status,definitionSnapshotJson,inputJson,contextJson,authorizationSnapshotJson,executionPlanJson,executionPlanHash,executionSource,definitionVersion,requestId) VALUES (?,?,?,?,?,'api','queued',?,?,?,?,?,?,'published_plan',?,?)",
    [
      runId,
      child.id,
      child.ownerUserId,
      input.actorId,
      child.flowType,
      JSON.stringify(child.plan.definition),
      JSON.stringify(input.mappedInput),
      JSON.stringify(checkpoint.context),
      JSON.stringify({
        userId: input.actorId,
        permission: "workflow:run",
        source: "durable_child",
      }),
      JSON.stringify(child.plan),
      child.planHash,
      child.version,
      input.requestId,
    ]
  );
  await connection.query(
    "INSERT INTO workflow_run_job (id,runId,jobType,status,idempotencyKey,checkpointJson,maxAttempts,requestId) VALUES (?,?,'start','queued',?,?,3,?)",
    [
      randomUUID(),
      runId,
      "workflow:child:" + linkId,
      JSON.stringify(checkpoint),
      input.requestId,
    ]
  );
  await connection.query(
    "INSERT INTO workflow_run_link (id,parentRunId,childRunId,waitId,nodeId,executionKey,callOrdinal,childVersion,planHash,failurePolicy,cancelPolicy) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      linkId,
      input.parentRunId,
      runId,
      input.waitId,
      input.node.id,
      input.executionKey,
      input.ordinal,
      child.version,
      child.planHash,
      options.failurePolicy,
      options.cancelPolicy,
    ]
  );
}

export async function stopDurableChildren(
  connection: mysql.PoolConnection,
  parentRunId: string,
  stop: Stop
) {
  const [links] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT l.id,l.childRunId,l.cancelPolicy,c.status FROM workflow_run_link l JOIN workflow_run c ON c.id=l.childRunId WHERE l.parentRunId=? AND l.state IN ('waiting','manual') ORDER BY l.id FOR UPDATE",
    [parentRunId]
  );
  for (const link of links) {
    const propagate =
      link.cancelPolicy === "propagate" && !terminal.includes(link.status);
    if (propagate)
      await stop(connection, link.childRunId, "cancelled", "parent_ended", {
        message: "父实例已结束，已取消未完成的子调用。",
      });
    await connection.query(
      "UPDATE workflow_run_link SET state=?,settledAt=NOW() WHERE id=?",
      [propagate ? "cancelled" : "detached", link.id]
    );
  }
}

export async function childWaitsToSettle(limit: number) {
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT l.waitId,l.parentRunId,l.childRunId,c.status AS childStatus,p.status AS parentStatus FROM workflow_run_link l JOIN workflow_run p ON p.id=l.parentRunId JOIN workflow_run c ON c.id=l.childRunId " +
      "WHERE (l.state='waiting' AND p.status='waiting' AND c.status IN ('success','failed','cancelled','terminated')) " +
      "OR (l.state IN ('waiting','manual') AND p.status IN ('success','failed','cancelled','terminated')) ORDER BY l.createdAt,l.id LIMIT ?",
    [limit]
  );
  const events = rows
    .filter(row => terminal.includes(row.childStatus))
    .map(row => [
      randomUUID(),
      "workflow.child.terminal",
      "workflow_run",
      row.childRunId,
      "workflow-child-terminal:" + row.childRunId,
      JSON.stringify({ childRunId: row.childRunId, waitId: row.waitId }),
      "queued",
      8,
    ]);
  if (events.length)
    await getSharedPool().query(
      "INSERT INTO workflow_outbox_event (id,eventType,aggregateType,aggregateId,dedupeKey,payloadJson,status,maxAttempts) VALUES ? ON DUPLICATE KEY UPDATE id=id",
      [events]
    );
  return rows;
}

export async function settleChild(
  connection: mysql.PoolConnection,
  wait: mysql.RowDataPacket,
  prepare: Prepare,
  stop: Stop,
  command?: { decision: ChildDecision; linkId: string; actor: Actor },
  expectedChildRunId?: string
): Promise<{ output?: Json; changed: boolean }> {
  const [links] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT l.*,p.workflowId AS parentWorkflowId,p.ownerUserId AS parentOwner,p.triggeredByUserId AS initiator,p.definitionSnapshotJson AS definition," +
      "c.status AS childStatus,c.inputJson AS childInput,c.finalOutputJson AS childOutput,c.workflowId AS childWorkflowId " +
      "FROM workflow_run_link l JOIN workflow_run p ON p.id=l.parentRunId JOIN workflow_run c ON c.id=l.childRunId WHERE l.waitId=? AND l.state IN ('waiting','manual') ORDER BY l.callOrdinal DESC LIMIT 1 FOR UPDATE",
    [wait.id]
  );
  const link = links[0];
  if (
    !link ||
    (expectedChildRunId !== undefined &&
      link.childRunId !== expectedChildRunId) ||
    wait.runStatus !== "waiting" ||
    !terminal.includes(link.childStatus)
  )
    return { changed: false };
  if (command) {
    if (link.id !== command.linkId || link.state !== "manual")
      return { changed: false };
    const [accounts] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT role,status,tokenVersion FROM users WHERE id=? FOR SHARE",
      [command.actor.id]
    );
    const actor = accounts[0];
    if (
      actor?.status !== "active" ||
      (command.actor.tokenVersion !== undefined &&
        Number(actor.tokenVersion) !== command.actor.tokenVersion) ||
      (command.actor.id !== link.parentOwner &&
        command.actor.id !== link.initiator &&
        actor.role !== "admin")
    )
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "当前账号无权处理本次子调用。",
      });
    for (const id of [link.parentWorkflowId, link.childWorkflowId]) {
      const access = await getWorkflowAccess(
        { id: command.actor.id, role: actor.role },
        id,
        { connection, lock: true }
      );
      if (
        !access.permissions.has("workflow:run") ||
        !access.permissions.has("workflow:view")
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "处理子调用需要父、子流程的运行和查看权限。",
        });
    }
  } else if (link.state === "manual") return { changed: false };
  const definition = parse(link.definition) as WorkflowDefinition;
  const node = definition.nodes.find(
    item => item.id === link.nodeId && isDurableSubflow(item)
  );
  if (!node) throw new Error("父实例固定快照缺少对应的子调用节点。");
  const failed = link.childStatus !== "success";
  if (failed && link.failurePolicy === "manual" && !command) {
    await connection.query(
      "UPDATE workflow_run_link SET state='manual' WHERE id=?",
      [link.id]
    );
    return { changed: true };
  }
  const retry =
    failed &&
    (command?.decision === "retry" ||
      (link.failurePolicy === "retry_once" && link.callOrdinal === 1));
  if (retry) {
    if (Number(link.callOrdinal) >= 3)
      throw new TRPCError({
        code: "CONFLICT",
        message: "此调用已达到三次尝试，请选择结束父流程或接受失败结果。",
      });
    try {
      await startDurableChild(
        connection,
        {
          parentWorkflowId: link.parentWorkflowId,
          parentRunId: link.parentRunId,
          node,
          actorId: Number(link.initiator),
          waitId: wait.id,
          executionKey: link.executionKey,
          ordinal: Number(link.callOrdinal) + 1,
          mappedInput: parse(link.childInput),
          requestId: wait.requestId ?? null,
        },
        prepare
      );
      await connection.query(
        "UPDATE workflow_run_link SET state='retrying',settledAt=NOW(),decisionByUserId=? WHERE id=?",
        [command?.actor.id ?? null, link.id]
      );
      return { changed: true };
    } catch (error) {
      // A retired version or revoked call grant cannot be retried automatically forever.
      if (command || !(error instanceof WorkflowCompileError)) throw error;
    }
  }
  const endParent =
    failed &&
    command?.decision !== "accept_failure" &&
    link.failurePolicy !== "return_result";
  if (endParent) {
    const details = {
      message: "子流程未成功，父实例按失败策略结束。",
      childStatus: link.childStatus,
    };
    await connection.query(
      "UPDATE workflow_run_link SET state='failed',settledAt=NOW(),decisionByUserId=? WHERE id=?",
      [command?.actor.id ?? null, link.id]
    );
    await connection.query(
      "UPDATE workflow_node_run SET status='failed',finishedAt=NOW(),errorJson=? WHERE id=? AND status='waiting'",
      [JSON.stringify(details), wait.nodeRunId]
    );
    await stop(connection, link.parentRunId, "failed", "child_failed", details);
    await stopDurableChildren(connection, link.parentRunId, stop);
    return { changed: true };
  }
  const path = childCallOptions(node.config).resultPath;
  const result = parse(link.childOutput);
  // An end node can carry its entire execution context. Return only its declared result.
  const declared =
    result && typeof result === "object" && Object.hasOwn(result, "result")
      ? result.result
      : result;
  const output = {
    status: String(link.childStatus),
    result: failed ? null : path ? (getPath(declared, path) ?? null) : declared,
    attempt: Number(link.callOrdinal),
  };
  await connection.query(
    "UPDATE workflow_run_link SET state='resumed',settledAt=NOW(),decisionByUserId=? WHERE id=?",
    [command?.actor.id ?? null, link.id]
  );
  return { changed: true, output };
}

export async function readDurableRunLinks(runId: string, viewer: Actor) {
  const [rows] = await getSharedPool().query<mysql.RowDataPacket[]>(
    "SELECT l.*,p.workflowId AS parentWorkflowId,p.ownerUserId AS parentOwner,p.triggeredByUserId AS initiator,c.workflowId AS childWorkflowId,c.status AS childStatus " +
      "FROM workflow_run_link l JOIN workflow_run p ON p.id=l.parentRunId JOIN workflow_run c ON c.id=l.childRunId WHERE l.parentRunId=? OR l.childRunId=? ORDER BY l.createdAt,l.callOrdinal,l.id",
    [runId, runId]
  );
  const accessByWorkflow = new Map<string, ReturnType<typeof getWorkflowAccess>>();
  function accessTo(id: string) {
    let promise = accessByWorkflow.get(id);
    if (!promise) {
      promise = getWorkflowAccess(viewer,id);
      accessByWorkflow.set(id,promise);
    }
    return promise;
  }
  const links = [];
  for (const row of rows) {
    const parentSide = runId === row.parentRunId;
    const otherWorkflowId = parentSide
      ? row.childWorkflowId
      : row.parentWorkflowId;
    const access = await accessTo(otherWorkflowId);
    if (!access.permissions.has("workflow:view")) continue;
    const selfAccess =
      row.state === "manual" && parentSide
        ? await accessTo(row.parentWorkflowId)
        : null;
    links.push({
      id: String(row.id),
      direction: parentSide ? ("child" as const) : ("parent" as const),
      workflowId: String(otherWorkflowId),
      runId: String(parentSide ? row.childRunId : row.parentRunId),
      state: String(row.state),
      childStatus: String(row.childStatus),
      version: Number(row.childVersion),
      planHash: String(row.planHash),
      nodeId: String(row.nodeId),
      attempt: Number(row.callOrdinal),
      failurePolicy: String(row.failurePolicy),
      cancelPolicy: String(row.cancelPolicy),
      canDecide: Boolean(
        selfAccess?.permissions.has("workflow:run") &&
          access.permissions.has("workflow:run") &&
          (viewer.role === "admin" ||
            viewer.id === row.parentOwner ||
            viewer.id === row.initiator)
      ),
    });
  }
  return links;
}

/** The executable snapshot remains intact in storage. Observers only receive identifiers for workflows they can view. */
export async function redactHiddenChildReferences<
  T extends { [key: string]: unknown },
>(run: T, viewer: Actor): Promise<T> {
  const definition = parse(
    run.definitionSnapshotJson
  ) as WorkflowDefinition | null;
  const targets = new Set<string>(
    (definition?.nodes ?? [])
      .filter(isDurableSubflow)
      .map(node => String(node.config.subflowId))
  );
  const hidden = new Set<string>();
  for (const id of Array.from(targets))
    if (!(await getWorkflowAccess(viewer, id)).permissions.has("workflow:view"))
      hidden.add(id);
  if (!hidden.size) return run;
  function clean(value: unknown): unknown {
    if (!value || typeof value !== "object" || value instanceof Date)
      return value;
    if (Array.isArray(value)) return value.map(clean);
    const next: Json = {};
    const object = value as Json;
    const privateBinding =
      object.executionMode === "durable_child" &&
      hidden.has(String(object.subflowId));
    for (const [key, item] of Object.entries(object)) {
      if (
        privateBinding &&
        ["subflowId", "childPlanHash", "childVersion", "zlcxz"].includes(key)
      )
        continue;
      if (/Json$/.test(key) && typeof item === "string") {
        try {
          next[key] = JSON.stringify(clean(JSON.parse(item)));
        } catch {
          next[key] = item;
        }
      } else next[key] = clean(item);
    }
    return next;
  }
  return clean(run) as T;
}
