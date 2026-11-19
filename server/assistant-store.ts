import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import {
  canonicalResourcePayload,
  resourceRequestKeyPattern,
} from "../shared/resource-creation";
import { getSharedPool } from "./db";
import { getWorkflowAccess, recordAuthorizationAudit } from "./iam-service";
import { getProjectAccess, type ProjectUser } from "./project-service";

export const ASSISTANT_DEFAULT_ID = "flow-assistant";
export const assistantConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    greeting: z.string().trim().max(1200),
    instructions: z.string().trim().max(16000),
    model: z.string().trim().max(200),
    tools: z
      .array(
        z.enum([
          "listMyTasks",
          "listMyCompletedTasks",
          "workspaceRead",
          "workspaceWrite",
          "searchWorkflows",
          "createWorkflowDraft",
          "updateWatermark",
        ])
      )
      .max(7),
    enabled: z.boolean(),
    roles: z
      .array(z.enum(["user", "admin"]))
      .min(1)
      .max(2),
    projectIds: z.array(z.string().min(1).max(64)).max(200),
  })
  .strict();
export type AssistantConfig = z.infer<typeof assistantConfigSchema>;
export type AssistantUser = ProjectUser;
export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  turnRevision?: number;
  turnIndex?: number;
  links?: Array<{ label: string; href: string }>;
};
export type AssistantChange = {
  title?: string;
  messages?: AssistantMessage[];
  task?: Record<string, unknown> | null;
};

type StoredAgent = {
  agentId: string;
  draft: AssistantConfig;
  published: AssistantConfig | null;
  draftVersion: number;
  publishedVersion: number;
};
export type SessionSummary = {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  trial: boolean;
  revision: number;
  configVersion: number;
  projectId: string | null;
  workflowId: string | null;
  updatedAt: string;
};
export type AssistantSession = SessionSummary & {
  config: AssistantConfig;
  messages: AssistantMessage[];
  olderBefore?: number | null;
  task: Record<string, unknown> | null;
};

const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "未找到助手或会话。" });
const denied = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message: "当前账号或项目无权使用此助手。",
  });
const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "内容已更新，请刷新后重试。" });

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

async function transaction<T>(fn: (connection: PoolConnection) => Promise<T>) {
  const connection = await getSharedPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function mapAgent(row: RowDataPacket): StoredAgent {
  return {
    agentId: row.id,
    draft: assistantConfigSchema.parse(parseJson(row.draftJson)),
    published: row.publishedJson
      ? assistantConfigSchema.parse(parseJson(row.publishedJson))
      : null,
    draftVersion: row.draftVersion,
    publishedVersion: row.publishedVersion,
  };
}

async function readAgent(
  agentId: string,
  connection?: PoolConnection,
  lock = false
) {
  const db = connection ?? getSharedPool();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT * FROM assistant_agent WHERE id=?" + (lock ? " FOR SHARE" : ""),
    [agentId]
  );
  if (!rows[0]) throw missing();
  return mapAgent(rows[0]);
}

export function getAssistantConfig(agentId = ASSISTANT_DEFAULT_ID) {
  return readAgent(agentId);
}

export async function listAssistantConfigs() {
  const [rows] = await getSharedPool().query<RowDataPacket[]>(
    "SELECT * FROM assistant_agent ORDER BY updatedAt DESC,id"
  );
  return rows.map(mapAgent);
}

async function verifyAdmin(user: AssistantUser, connection: PoolConnection) {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT role,status,tokenVersion FROM users WHERE id=? FOR SHARE",
    [user.id]
  );
  const actor = rows[0];
  if (
    !actor ||
    actor.role !== "admin" ||
    actor.status !== "active" ||
    (user.tokenVersion !== undefined &&
      actor.tokenVersion !== user.tokenVersion)
  )
    throw denied();
}

export async function saveAssistantDraft(
  user: AssistantUser,
  expectedVersion: number,
  config: AssistantConfig,
  agentId?: string
) {
  const draft = assistantConfigSchema.parse(config);
  if (user.role !== "admin") throw denied();
  return transaction(async connection => {
    const id = agentId ?? randomUUID();
    if (expectedVersion === 0) {
      if (id.length > 64 || !resourceRequestKeyPattern.test(id))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "助手创建标识无效。",
        });
      try {
        await connection.query(
          "INSERT INTO assistant_agent (id,draftJson,draftVersion,updatedByUserId) VALUES (?,?,1,?)",
          [id, JSON.stringify(draft), user.id]
        );
      } catch (error) {
        if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
        const [rows] = await connection.query<RowDataPacket[]>(
          "SELECT * FROM assistant_agent WHERE id=? FOR SHARE",
          [id]
        );
        const row = rows[0];
        await verifyAdmin(user, connection);
        if (
          !row ||
          row.updatedByUserId !== user.id ||
          row.draftVersion !== 1 ||
          row.publishedVersion !== 0 ||
          canonicalResourcePayload(parseJson(row.draftJson)) !==
            canonicalResourcePayload(draft)
        )
          throw conflict();
        return mapAgent(row);
      }
    } else {
      if (!agentId) throw conflict();
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT draftVersion FROM assistant_agent WHERE id=? FOR UPDATE",
        [id]
      );
      if (!rows[0]) throw missing();
      if (rows[0].draftVersion !== expectedVersion) throw conflict();
      await connection.query(
        "UPDATE assistant_agent SET draftJson=?,draftVersion=draftVersion+1,updatedByUserId=? WHERE id=?",
        [JSON.stringify(draft), user.id, id]
      );
    }
    // Confirmations lock the agent before checking the actor in the business transaction.
    await verifyAdmin(user, connection);
    await recordAuthorizationAudit(
      {
        actorUserId: user.id,
        action: "user_updated",
        resourceType: "assistant_agent",
        resourceId: id,
        details: { operation: "save_draft", version: expectedVersion + 1 },
      },
      connection
    );
    return readAgent(id, connection);
  });
}

export async function publishAssistantConfig(
  user: AssistantUser,
  expectedVersion: number,
  agentId = ASSISTANT_DEFAULT_ID
) {
  if (user.role !== "admin") throw denied();
  return transaction(async connection => {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM assistant_agent WHERE id=? FOR UPDATE",
      [agentId]
    );
    await verifyAdmin(user, connection);
    if (!rows[0]) throw missing();
    const current = mapAgent(rows[0]);
    if (current.draftVersion !== expectedVersion) throw conflict();
    if (current.publishedVersion === expectedVersion) return current;
    await connection.query(
      "UPDATE assistant_agent SET publishedJson=draftJson,publishedVersion=draftVersion,updatedByUserId=? WHERE id=?",
      [user.id, agentId]
    );
    await recordAuthorizationAudit(
      {
        actorUserId: user.id,
        action: "user_updated",
        resourceType: "assistant_agent",
        resourceId: agentId,
        details: { operation: "publish", version: expectedVersion },
      },
      connection
    );
    return readAgent(agentId, connection);
  });
}

function inScope(
  config: AssistantConfig | null,
  user: AssistantUser,
  projectId?: string | null
) {
  return Boolean(
    config?.enabled &&
      config.roles.includes(user.role) &&
      (!config.projectIds.length ||
        (projectId && config.projectIds.includes(projectId)))
  );
}

async function canViewProject(
  user: AssistantUser,
  projectId?: string | null,
  connection?: PoolConnection
) {
  return (
    !projectId ||
    (await getProjectAccess(user, projectId, { connection })).permissions.has(
      "project:view"
    )
  );
}

async function authorizedConfig(
  user: AssistantUser,
  trial: boolean,
  projectId: string | null | undefined,
  agentId: string,
  connection?: PoolConnection,
  lock = false
) {
  if (trial && user.role !== "admin") throw denied();
  const agent = await readAgent(agentId, connection, lock);
  const config = trial ? agent.draft : agent.published;
  if (
    !config ||
    (!trial && !inScope(config, user, projectId)) ||
    !(await canViewProject(user, projectId, connection))
  )
    throw denied();
  return {
    agentId,
    config,
    version: trial ? agent.draftVersion : agent.publishedVersion,
  };
}

export async function listAvailableAssistantConfigs(
  user: AssistantUser,
  projectId?: string | null
) {
  if (!(await canViewProject(user, projectId))) return [];
  const agents = await listAssistantConfigs();
  return agents.flatMap(agent =>
    agent.published && inScope(agent.published, user, projectId)
      ? [
          {
            agentId: agent.agentId,
            config: agent.published,
            version: agent.publishedVersion,
          },
        ]
      : []
  );
}

export function resolveAssistantConfig(
  user: AssistantUser,
  trial: boolean,
  projectId?: string | null,
  agentId = ASSISTANT_DEFAULT_ID
) {
  return authorizedConfig(user, trial, projectId, agentId);
}

function sessionSummary(row: RowDataPacket): SessionSummary {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName,
    title: row.title,
    projectId: row.projectId,
    workflowId: row.workflowId,
    trial: Boolean(row.trial),
    configVersion: row.configVersion,
    revision: row.revision,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function readSession(
  user: AssistantUser,
  id: string,
  connection: PoolConnection,
  lock = false,
  page?: { size: number; beforeRevision?: number }
): Promise<AssistantSession> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT *,configJson->>'$.name' AS agentName FROM assistant_session WHERE id=? AND ownerUserId=?" +
      (lock ? " FOR UPDATE" : ""),
    [id, user.id]
  );
  const session = rows[0];
  if (!session) throw missing();
  if (session.workflowId) {
    const access = await getWorkflowAccess(user, session.workflowId, {
      connection,
    });
    if (!access.permissions.has("workflow:view")) throw denied();
  }
  const active = await authorizedConfig(
    user,
    Boolean(session.trial),
    session.projectId,
    session.agentId,
    connection,
    lock
  );
  const pinned = assistantConfigSchema.parse(parseJson(session.configJson));
  const [turns] = page
    ? await connection.query<RowDataPacket[]>(
        "SELECT revision,messagesJson FROM assistant_turn WHERE sessionId=? AND revision<? ORDER BY revision DESC LIMIT ?",
        [id, page.beforeRevision ?? Number(session.revision) + 1, page.size + 1]
      )
    : await connection.query<RowDataPacket[]>(
        "SELECT revision,messagesJson FROM assistant_turn WHERE sessionId=? ORDER BY revision", [id]
      );
  const hasOlder = Boolean(page && turns.length > page.size);
  if (hasOlder) turns.pop();
  if (page) turns.reverse();
  return {
    ...sessionSummary(session),
    ...(page ? { olderBefore: hasOlder ? Number(turns[0].revision) : null } : {}),
    task: parseJson(session.taskJson),
    messages: turns.flatMap(turn =>
      parseJson<AssistantMessage[]>(turn.messagesJson).map((message, index) => ({ ...message, turnRevision: Number(turn.revision), turnIndex: index }))
    ),
    config: {
      ...pinned,
      tools: pinned.tools.filter(tool => active.config.tools.includes(tool)),
    },
  };
}

export async function createAssistantSession(
  user: AssistantUser,
  trial: boolean,
  title?: string,
  projectId?: string | null,
  agentId = ASSISTANT_DEFAULT_ID,
  workflowId?: string | null,
  options: { sessionId?: string; expectedConfigVersion?: number } = {}
) {
  const id = options.sessionId ?? randomUUID();
  if (!z.string().uuid().safeParse(id).success)
    throw new TRPCError({ code: "BAD_REQUEST", message: "会话标识无效。" });
  try {
    return await transaction(async connection => {
      const { config, version } = await authorizedConfig(
        user,
        trial,
        projectId,
        agentId,
        connection,
        true
      );
      await connection.query(
        "INSERT INTO assistant_session (id,ownerUserId,agentId,title,trial,projectId,workflowId,configVersion,configJson) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          id,
          user.id,
          agentId,
          title?.trim().slice(0, 160) || "新会话",
          trial,
          projectId ?? null,
          workflowId ?? null,
          version,
          JSON.stringify(config),
        ]
      );
      if (
        options.expectedConfigVersion !== undefined &&
        options.expectedConfigVersion !== version
      )
        throw conflict();
      return readSession(user, id, connection);
    });
  } catch (error) {
    if (
      !options.sessionId ||
      (error as { code?: string }).code !== "ER_DUP_ENTRY"
    )
      throw error;
    // A separate transaction sees the winner even when the losing insert started first.
    const existing = await getAssistantSession(user, id);
    if (
      existing.agentId !== agentId ||
      existing.trial !== trial ||
      existing.projectId !== (projectId ?? null) ||
      existing.workflowId !== (workflowId ?? null) ||
      (options.expectedConfigVersion !== undefined &&
        options.expectedConfigVersion !== existing.configVersion)
    )
      throw conflict();
    return existing;
  }
}

type HistoryScope = {
  preview: boolean;
  agentId?: string;
  projectId?: string | null;
  configVersion?: number;
  search?: string;
};
type HistoryCursor = { scope: string; time: number; id: string };
const cursorSchema = z.object({ scope: z.string().length(64), time: z.number().int().nonnegative(), id: z.string().min(1).max(128) });

export async function assistantSessionsPage(
  user: AssistantUser, input: HistoryScope, size = 20, cursor?: string
): Promise<{ items: SessionSummary[]; nextCursor: string | null }> {
  if (input.preview && user.role !== "admin") throw denied();
  const scope = operationHash(user.id, [input.preview, input.agentId, input.projectId === undefined ? "*" : input.projectId, input.configVersion, input.search ?? ""]);
  let after: HistoryCursor | undefined;
  if (cursor) {
    try {
      after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
      if (after.scope !== scope) throw new Error();
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "筛选范围已变化或历史游标无效，请刷新第一页。" });
    }
  }
  const conditions = ["s.ownerUserId=?", "s.trial=?"];
  const values: Array<string | number | boolean | null> = [user.id, input.preview];
  for (const [column, value] of [
    ["s.agentId=?", input.agentId], ["s.projectId <=> ?", input.projectId],
    ["s.configVersion=?", input.configVersion], ["LOCATE(?,s.title)>0", input.search || undefined],
  ] as const) {
    if (value !== undefined) { conditions.push(column); values.push(value); }
  }
  const items: SessionSummary[] = [];
  const projects = new Map<string, boolean>();
  const workflows = new Map<string, boolean>();
  const pageSize = Math.min(50, Math.max(1, size));
  const scanSize = Math.max(32, pageSize);
  for (let scan = 0; scan < 8; scan++) {
    const next = after ? " AND (s.updatedAt<FROM_UNIXTIME(?) OR (s.updatedAt=FROM_UNIXTIME(?) AND s.id>?))" : "";
    const [rows] = await getSharedPool().query<RowDataPacket[]>(
      "SELECT s.id,s.title,s.agentId,s.configJson->>'$.name' AS agentName,s.projectId,s.workflowId,s.trial,s.configVersion,s.revision,s.updatedAt,UNIX_TIMESTAMP(s.updatedAt) AS sortTime,a.publishedJson FROM assistant_session s JOIN assistant_agent a ON a.id=s.agentId WHERE " +
        conditions.join(" AND ") + next + " ORDER BY s.updatedAt DESC,s.id ASC LIMIT ?",
      [...values, ...(after ? [after.time, after.time, after.id] : []), scanSize + 1]
    );
    for (let i = 0; i < Math.min(rows.length, scanSize); i++) {
      const row = rows[i];
      after = { scope, time: Number(row.sortTime), id: row.id };
      if (!input.preview && !inScope(parseJson(row.publishedJson), user, row.projectId)) continue;
      if (row.projectId) {
        if (!projects.has(row.projectId)) projects.set(row.projectId, await canViewProject(user, row.projectId));
        if (!projects.get(row.projectId)) continue;
      }
      if (row.workflowId) {
        if (!workflows.has(row.workflowId)) workflows.set(row.workflowId, (await getWorkflowAccess(user, row.workflowId)).permissions.has("workflow:view"));
        if (!workflows.get(row.workflowId)) continue;
      }
      items.push(sessionSummary(row));
      if (items.length === pageSize)
        return { items, nextCursor: i + 1 < rows.length ? Buffer.from(JSON.stringify(after)).toString("base64url") : null };
    }
    if (rows.length <= scanSize) return { items, nextCursor: null };
  }
  return { items, nextCursor: after ? Buffer.from(JSON.stringify(after)).toString("base64url") : null };
}

export async function listAssistantSessions(user: AssistantUser, trial: boolean, agentId?: string, projectId?: string | null) {
  const items: SessionSummary[] = [];
  let cursor: string | undefined;
  do {
    const result = await assistantSessionsPage(user, { preview: trial, agentId, projectId }, 50, cursor);
    items.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export function getAssistantSession(
  user: AssistantUser,
  id: string,
  requestId?: string,
  page?: { size: number; beforeRevision?: number }
): Promise<AssistantSession & { requestCommitted?: boolean }> {
  return transaction(async connection => {
    const session = await readSession(user, id, connection, false, page);
    if (requestId === undefined) return session;
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT 1 FROM assistant_turn WHERE sessionId=? AND requestId=? LIMIT 1",
      [id, requestId]
    );
    return { ...session, requestCommitted: rows.length > 0 };
  });
}

function operationHash(revision: number, payload: unknown) {
  const input = canonicalResourcePayload([revision, payload]);
  return createHash("sha256").update(input).digest("hex");
}

// Leave pool capacity for the authorized domain services invoked by an active turn.
let activeTurns = 0;
const maxConcurrentTurns = 6;
export async function mutateAssistantSession(
  user: AssistantUser,
  id: string,
  expectedRevision: number,
  requestId: string,
  payload: unknown,
  apply: (
    session: AssistantSession
  ) => AssistantChange | Promise<AssistantChange>,
  pageSize?: number
): Promise<AssistantSession> {
  if (activeTurns >= maxConcurrentTurns)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "助手正忙，请稍后重试。",
    });
  activeTurns++;
  try {
    return await transaction(async connection => {
      const session = await readSession(user, id, connection, true);
      const hash = operationHash(expectedRevision, payload);
      const [prior] = await connection.query<RowDataPacket[]>(
        "SELECT payloadHash FROM assistant_turn WHERE sessionId=? AND requestId=?",
        [id, requestId]
      );
      if (prior[0]) {
        if (prior[0].payloadHash !== hash) throw conflict();
        return pageSize ? readSession(user, id, connection, false, { size: pageSize }) : session;
      }
      if (session.revision !== expectedRevision) throw conflict();
      const change = await apply(session);
      const revision = expectedRevision + 1;
      const now = new Date().toISOString();
      const messages = (change.messages ?? []).map(message => ({
        ...message,
        createdAt: message.createdAt ?? now,
      }));
      const task = change.task === undefined ? session.task : change.task;
      const title = change.title?.trim().slice(0, 160) || session.title;
      const taskJson = task ? JSON.stringify(task) : null;
      await connection.query(
        "INSERT INTO assistant_turn (id,sessionId,requestId,payloadHash,revision,messagesJson,taskJson) VALUES (?,?,?,?,?,?,?)",
        [
          randomUUID(),
          id,
          requestId,
          hash,
          revision,
          JSON.stringify(messages),
          taskJson,
        ]
      );
      await connection.query(
        "UPDATE assistant_session SET title=?,revision=?,taskJson=?,updatedAt=CURRENT_TIMESTAMP WHERE id=? AND ownerUserId=?",
        [title, revision, taskJson, id, user.id]
      );
      if (pageSize) return readSession(user, id, connection, false, { size: pageSize });
      return {
        ...session,
        revision,
        title,
        task,
        messages: [...session.messages, ...messages],
        updatedAt: now,
      };
    });
  } finally {
    activeTurns--;
  }
}
