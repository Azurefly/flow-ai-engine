import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSharedPool, getSharedPool } from "./db";
import { assistantHistoryQuery, type HistoryScope } from "./assistant-history-query";
import { getP1SystemSettings, updateP1SystemSetting } from "./p1-service";
import {
  ASSISTANT_DEFAULT_ID,
  createAssistantSession,
  assistantSessionsPage,
  getAssistantConfig,
  getAssistantSession,
  listAssistantSessions,
  listAvailableAssistantConfigs,
  mutateAssistantSession,
  publishAssistantConfig,
  saveAssistantDraft,
  type AssistantConfig,
  type AssistantUser,
} from "./assistant-store";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("全局助手 MySQL 持久化", () => {
  let admin: AssistantUser;
  let user: AssistantUser;
  let other: AssistantUser;
  let defaultConfig: AssistantConfig;
  const agents: string[] = [];
  const actors: number[] = [];
  async function actor(role: AssistantUser["role"]) {
    const [result] = await getSharedPool().query<ResultSetHeader>(
      "INSERT INTO users (name,role) VALUES (?,?)",
      ["助手测试-" + randomUUID(), role]
    );
    actors.push(result.insertId);
    return { id: result.insertId, role };
  }
  async function agent(overrides?: Partial<AssistantConfig>) {
    const output = await saveAssistantDraft(admin, 0, {
      ...defaultConfig,
      ...overrides,
    });
    agents.push(output.agentId);
    return output;
  }
  beforeAll(async () => {
    admin = await actor("admin");
    user = await actor("user");
    other = await actor("user");
    defaultConfig = (await getAssistantConfig(ASSISTANT_DEFAULT_ID)).draft;
  });
  afterAll(async () => {
    const pool = getSharedPool();
    if (actors.length) {
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?)",
        [actors]
      );
      await pool.query("DELETE FROM users WHERE id IN (?)", [actors]);
    }
    if (agents.length)
      await pool.query("DELETE FROM assistant_agent WHERE id IN (?)", [agents]);
    await closeSharedPool();
  });

  it("原装助手升级创建能力一次，保留管理员保存的配置", async () => {
    const prior: AssistantConfig = {
      name: "流程助手",
      greeting: "你好。你可以让我查看自己的待办、已办，或查找流程。",
      instructions: "请用中文回答，依据工具返回的系统数据说明结果。",
      model: "",
      tools: ["listMyTasks", "searchWorkflows", "listMyCompletedTasks"],
      enabled: true,
      roles: ["user", "admin"],
      projectIds: [],
    };
    const migration = readFileSync(new URL("../drizzle/0051_assistant_workflow_creation_default.sql", import.meta.url), "utf8");
    const connection = await getSharedPool().getConnection();
    try {
      await connection.beginTransaction();
      const restore = (config: AssistantConfig, updater: number | null) => connection.query(
        "UPDATE assistant_agent SET draftJson=?,publishedJson=?,draftVersion=2,publishedVersion=2,updatedByUserId=? WHERE id=?",
        [JSON.stringify(config), JSON.stringify(config), updater, ASSISTANT_DEFAULT_ID],
      );
      await restore(prior, null);
      const [applied] = await connection.query<ResultSetHeader>(migration);
      expect(applied.affectedRows).toBe(1);
      const [[row]] = await connection.query<RowDataPacket[]>(
        "SELECT draftJson,publishedJson,draftVersion,publishedVersion FROM assistant_agent WHERE id=?", [ASSISTANT_DEFAULT_ID],
      );
      expect(row.draftVersion).toBe(3);
      expect(row.publishedVersion).toBe(3);
      const decode = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
      expect(decode(row.draftJson)).toEqual(decode(row.publishedJson));
      expect(decode(row.publishedJson)).toMatchObject({ tools: [...prior.tools, "createWorkflowDraft"] });
      const [replayed] = await connection.query<ResultSetHeader>(migration);
      expect(replayed.affectedRows).toBe(0);
      await restore(prior, admin.id);
      expect((await connection.query<ResultSetHeader>(migration))[0].affectedRows).toBe(0);
      await restore({ ...prior, greeting: "管理员自定义问候" }, null);
      expect((await connection.query<ResultSetHeader>(migration))[0].affectedRows).toBe(0);
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("相同更新时间按 ID 续读，范围变动拒绝游标，历史可按修订分段", async () => {
    const a = await agent();
    await publishAssistantConfig(admin, 1, a.agentId);
    const scope = { preview: false, agentId: a.agentId, search: "分页" };
    const sessions = await Promise.all([1,2,3,4].map(n => createAssistantSession(user, false, "分页" + n, null, a.agentId)));
    const ids = sessions.map(item => item.id).sort();
    await getSharedPool().query("UPDATE assistant_session SET updatedAt='2026-01-01 00:00:00' WHERE id IN (?)", [ids]);
    const first = await assistantSessionsPage(user, scope, 2);
    expect(first.items.map(s => s.id)).toEqual(ids.slice(0,2));
    const second = await assistantSessionsPage(user, scope, 2, first.nextCursor!);
    expect(second.items.map(s => s.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();
    await expect(assistantSessionsPage(other, scope, 2, first.nextCursor!)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(assistantSessionsPage(user, { ...scope, search: "其他" }, 2, first.nextCursor!)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let n=0; n<4; n++) await mutateAssistantSession(user, ids[0], n, randomUUID(), { n },
      () => ({ messages: [{ role: "assistant", content: "内容" + n }] }));
    const newest = await getAssistantSession(user, ids[0], undefined, { size: 2 });
    expect(newest.messages.map(m=>m.turnRevision)).toEqual([3,4]);
    const early = await getAssistantSession(user, ids[0], undefined, { size: 2, beforeRevision: newest.olderBefore! });
    expect(early.messages.map(m=>m.turnRevision)).toEqual([1,2]);
    expect(early.olderBefore).toBeNull();
    expect(early.revision).toBe(4);
  });

  it("四种历史查询直接定位同秒的深游标，各读取八个候选且没有排序", async () => {
    const owner = await actor("user");
    const project = randomUUID();
    const ids = Array.from({ length: 120 }, () => randomUUID()).sort();
    const a = await agent();
    await publishAssistantConfig(admin, 1, a.agentId);
    const connection = await getSharedPool().getConnection();
    try {
      const time = 1704110400;
      const rows = ids.map(id => [id, owner.id, a.agentId, false, "历史", project, 1, JSON.stringify(defaultConfig), new Date(time * 1000)]);
      await connection.query("INSERT INTO assistant_session(id,ownerUserId,agentId,trial,title,projectId,configVersion,configJson,updatedAt) VALUES ?", [rows]);
      const [times] = await connection.query<RowDataPacket[]>("SELECT UNIX_TIMESTAMP(updatedAt) AS time FROM assistant_session WHERE id=?", [ids[0]]);
      const after = { time: Number(times[0].time), id: ids[111] };
      const shapes: Array<[HistoryScope, string]> = [
        [{ preview: false }, "assistant_history_owner_idx"],
        [{ preview: false, projectId: project }, "assistant_history_project_idx"],
        [{ preview: false, agentId: a.agentId }, "assistant_history_agent_idx"],
        [{ preview: false, projectId: project, agentId: a.agentId }, "assistant_history_project_agent_idx"],
      ];
      async function steps() {
        const [status] = await connection.query<RowDataPacket[]>(
          "SHOW SESSION STATUS WHERE Variable_name IN ('Handler_read_next','Handler_read_prev')"
        );
        return status.reduce((sum, row) => sum + Number(row.Value), 0);
      }
      for (const [scope, index] of shapes) {
        const { sql, values } = assistantHistoryQuery(owner.id, scope, 8, after);
        const [plan] = await connection.query<RowDataPacket[]>("EXPLAIN ANALYZE " + sql, values);
        expect(plan[0].EXPLAIN).toContain(index);
        expect(plan[0].EXPLAIN).not.toMatch(/\bSort:/i);
        const before = await steps();
        const [page] = await connection.query<RowDataPacket[]>(sql, values);
        expect(page.map(row => row.id)).toEqual(ids.slice(112));
        expect((await steps()) - before).toBeLessThanOrEqual(8);
      }
    } finally {
      connection.release();
    }
  });

  it("权限稀疏的空页继续前进，纯工作区、草稿和另一个客户账号均隔离", async () => {
    const reader = await actor("user");
    const a = await agent();
    await publishAssistantConfig(admin, 1, a.agentId);
    const scope = { preview: false, agentId: a.agentId };
    const revoked = randomUUID();
    const ids = Array.from({ length: 272 }, () => randomUUID()).sort();
    const rows = ids.map((id, i) => [
      id, reader.id, a.agentId, false, i > 265 ? "匹配的旧记录" : "历史", i > 265 ? null : revoked,
      i > 265 ? 2 : 1, JSON.stringify(defaultConfig), "2026-01-01 00:00:00",
    ]);
    await getSharedPool().query("INSERT INTO assistant_session(id,ownerUserId,agentId,trial,title,projectId,configVersion,configJson,updatedAt) VALUES ?", [rows]);
    await createAssistantSession(other, false, "其他账号", null, a.agentId);
    await createAssistantSession(admin, true, "管理员试聊", null, a.agentId);
    const empty = await assistantSessionsPage(reader, scope, 3);
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeTruthy();
    const next = await assistantSessionsPage(reader, scope, 3, empty.nextCursor!);
    expect(next.items.map(row => row.id)).toEqual(ids.slice(266, 269));
    const tail = await assistantSessionsPage(reader, scope, 3, next.nextCursor!);
    expect(tail.items.map(row => row.id)).toEqual(ids.slice(269));
    expect(tail.nextCursor).toBeNull();
    for (const filter of [{ projectId: null }, { search: "匹配" }, { configVersion: 2 }]) {
      const page = await assistantSessionsPage(reader, { ...scope, ...filter }, 7);
      expect(page.items.map(row => row.id)).toEqual(ids.slice(266));
      expect(page.nextCursor).toBeNull();
      await expect(assistantSessionsPage(reader, { ...scope, ...filter }, 3, empty.nextCursor!)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await listAssistantSessions(reader, false, a.agentId)).map(row => row.id)).toEqual(ids.slice(266));
  });
  it("授予已办工具后仅新对话取得该权限，撤回后已有对话也随之失效", async () => {
    const pendingOnly: AssistantConfig = { ...defaultConfig, tools: ["listMyTasks"] };
    const a = await agent(pendingOnly);
    await publishAssistantConfig(admin, 1, a.agentId);
    const previous = await createAssistantSession(user, false, undefined, null, a.agentId);
    await saveAssistantDraft(admin, 1, { ...pendingOnly, tools: ["listMyTasks", "listMyCompletedTasks"] }, a.agentId);
    await publishAssistantConfig(admin, 2, a.agentId);
    expect((await getAssistantSession(user, previous.id)).config.tools).toEqual(["listMyTasks"]);
    const current = await createAssistantSession(user, false, undefined, null, a.agentId);
    expect(current.config.tools).toContain("listMyCompletedTasks");
    await saveAssistantDraft(admin, 2, pendingOnly, a.agentId);
    await publishAssistantConfig(admin, 3, a.agentId);
    expect((await getAssistantSession(user, current.id)).config.tools).toEqual(["listMyTasks"]);
  });

  it("系统内置助手可以准备流程草稿，自定义助手发布前仅供管理员试聊", async () => {
    expect(defaultConfig.tools).toEqual(["listMyTasks", "searchWorkflows", "listMyCompletedTasks", "createWorkflowDraft"]);
    const a = await agent();
    expect(a.published).toBeNull();
    await expect(
      createAssistantSession(user, true, undefined, null, a.agentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createAssistantSession(user, false, undefined, null, a.agentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const trial = await createAssistantSession(
      admin,
      true,
      undefined,
      null,
      a.agentId
    );
    expect(trial).toMatchObject({ trial: true, configVersion: 1 });
    expect(await listAssistantSessions(admin, false, a.agentId)).toEqual([]);
    expect((await listAssistantSessions(admin, true, a.agentId))[0].id).toBe(
      trial.id
    );
    await expect(
      listAssistantSessions(user, true, a.agentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      saveAssistantDraft(user, 1, defaultConfig, a.agentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("同一管理员并发重提交只新建一次，其他账号、变化内容与后续版本均不能重放初建", async () => {
    const id = randomUUID();
    agents.push(id);
    const create = () => saveAssistantDraft(admin, 0, defaultConfig, id);
    const both = await Promise.all([create(), create()]);
    expect(both.map(agent => agent.agentId)).toEqual([id, id]);
    const [audit] = await getSharedPool().query<RowDataPacket[]>(
      "SELECT id FROM authorization_audit_log WHERE actorUserId=? AND resourceId=?",
      [admin.id, id]
    );
    expect(audit).toHaveLength(1);
    const secondAdmin = await actor("admin");
    await expect(
      saveAssistantDraft(secondAdmin, 0, defaultConfig, id)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      saveAssistantDraft(admin, 0, { ...defaultConfig, name: "另一个草稿" }, id)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await publishAssistantConfig(admin, 1, id);
    await expect(create()).rejects.toMatchObject({ code: "CONFLICT" });
    await saveAssistantDraft(admin, 1, defaultConfig, id);
    await expect(create()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("固定会话启动版本，修改草稿不影响已发布工具；重新发布后收回旧工具或角色", async () => {
    const a = await agent();
    await publishAssistantConfig(admin, 1, a.agentId);
    const s = await createAssistantSession(
      user,
      false,
      undefined,
      null,
      a.agentId
    );
    const next = {
      ...defaultConfig,
      tools: ["searchWorkflows"] as AssistantConfig["tools"],
      instructions: "新指令",
    };
    await saveAssistantDraft(admin, 1, next, a.agentId);
    await expect(
      publishAssistantConfig(admin, 1, a.agentId)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getAssistantSession(user, s.id)).config.tools).toContain(
      "listMyTasks"
    );
    await publishAssistantConfig(admin, 2, a.agentId);
    const refreshed = await getAssistantSession(user, s.id);
    expect(refreshed.config.tools).toEqual(["searchWorkflows"]);
    expect(refreshed.config.instructions).toBe(defaultConfig.instructions);
    expect(
      (await createAssistantSession(user, false, undefined, null, a.agentId))
        .config.instructions
    ).toBe("新指令");
    await saveAssistantDraft(
      admin,
      2,
      { ...next, roles: ["admin"] },
      a.agentId
    );
    await publishAssistantConfig(admin, 3, a.agentId);
    await expect(getAssistantSession(user, s.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await listAssistantSessions(user, false, a.agentId)).toEqual([]);
  });

  it("以当前用户可见项目限制名单过滤助手与会话", async () => {
    const projectId = randomUUID();
    const a = await agent({ projectIds: [projectId] });
    await publishAssistantConfig(admin, 1, a.agentId);
    expect(
      (await listAvailableAssistantConfigs(user)).map(item => item.agentId)
    ).not.toContain(a.agentId);
    expect(await listAvailableAssistantConfigs(user, projectId)).toEqual([]);
    await expect(
      createAssistantSession(user, false, undefined, projectId, a.agentId)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pool = getSharedPool();
    await pool.query(
      "INSERT INTO flow_project (id,ownerUserId,code,name) VALUES (?,?,?,?)",
      [projectId, user.id, projectId, "助手范围验证"]
    );
    try {
      const visible = await listAvailableAssistantConfigs(user, projectId);
      expect(visible.map(entry => entry.agentId)).toContain(a.agentId);
      expect(await listAvailableAssistantConfigs(other, projectId)).toEqual([]);
      const s = await createAssistantSession(
        user,
        false,
        undefined,
        projectId,
        a.agentId
      );
      await pool.query("UPDATE flow_project SET ownerUserId=? WHERE id=?", [
        other.id,
        projectId,
      ]);
      await expect(getAssistantSession(user, s.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    } finally {
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
  });

  it("试聊首发并发重试只保留一个会话，并按实际请求号查询落库情况", async () => {
    const a = await agent();
    const id = randomUUID();
    const start = (sessionId = id, expectedConfigVersion = 1) =>
      createAssistantSession(admin, true, undefined, null, a.agentId, null, {
        sessionId,
        expectedConfigVersion,
      });
    const starts = await Promise.all([start(), start(), start()]);
    expect(starts.map(session => session.id)).toEqual([id, id, id]);
    expect(await listAssistantSessions(admin, true, a.agentId)).toHaveLength(1);
    await saveAssistantDraft(
      admin,
      1,
      { ...defaultConfig, greeting: "更改草稿版本" },
      a.agentId
    );
    await publishAssistantConfig(admin, 2, a.agentId);
    expect((await start()).configVersion).toBe(1);
    await expect(start(id, 2)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(start(randomUUID(), 1)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await listAssistantSessions(admin, true, a.agentId)).toHaveLength(1);
    await expect(
      createAssistantSession(admin, false, undefined, null, a.agentId, null, {
        sessionId: id,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      createAssistantSession(user, false, undefined, null, a.agentId, null, {
        sessionId: id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const committed = randomUUID();
    await mutateAssistantSession(admin, id, 0, committed, {}, () => ({
      task: { status: "completed" },
    }));
    expect(await getAssistantSession(admin, id, committed)).toMatchObject({
      revision: 1,
      requestCommitted: true,
    });
    expect(await getAssistantSession(admin, id, randomUUID())).toMatchObject({
      revision: 1,
      requestCommitted: false,
    });
    expect(await getAssistantSession(admin, id)).not.toHaveProperty(
      "requestCommitted"
    );
    await expect(
      getAssistantSession(user, id, committed)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("两个客户的独立会话能同时进入同一助手的工具和模型回调", async () => {
    const [left, right] = await Promise.all([
      createAssistantSession(user, false),
      createAssistantSession(other, false),
    ]);
    let arrivals = 0;
    let release!: () => void;
    let rejectWait!: (error: Error) => void;
    const bothEntered = new Promise<void>((resolve, reject) => {
      release = resolve;
      rejectWait = reject;
    });
    const timer = setTimeout(
      () => rejectWait(new Error("独立会话互相阻塞")),
      3000
    );
    const turn = async () => {
      if (++arrivals === 2) release();
      await bothEntered;
      return { messages: [{ role: "assistant" as const, content: "完成" }] };
    };
    try {
      const results = await Promise.allSettled([
        mutateAssistantSession(user, left.id, 0, randomUUID(), {}, turn),
        mutateAssistantSession(other, right.id, 0, randomUUID(), {}, turn),
      ]);
      expect(results.map(result => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
    } finally {
      clearTimeout(timer);
    }
  });

  it("系统写入后即使会话事务中断，原提案仍可按回执恢复且保留之后的管理员修改", async () => {
    const pool = getSharedPool();
    const [original] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM system_setting WHERE `key`='general'"
    );
    try {
      const initial = await getP1SystemSettings();
      const confirmationId = randomUUID();
      const proposed = { watermarkText: "测试-" + randomUUID() };
      const confirm = (patch = proposed, id = confirmationId) =>
        updateP1SystemSetting(
          admin,
          "general",
          patch,
          initial.configTokens.general,
          undefined,
          id
        );
      const session = await createAssistantSession(admin, false);
      const request = randomUUID();
      await expect(
        mutateAssistantSession(admin, session.id, 0, request, {}, async () => {
          await confirm();
          throw new Error("模拟回执到达会话前中断");
        })
      ).rejects.toThrow("模拟回执");
      expect((await getAssistantSession(admin, session.id)).revision).toBe(0);
      // A matching current value from a different request cannot acknowledge a stale confirmation.
      await expect(confirm(proposed, randomUUID())).rejects.toMatchObject({
        code: "CONFLICT",
      });
      const after = await getP1SystemSettings();
      expect(after.general.watermarkText).toBe(proposed.watermarkText);
      const latest = "新设置-" + randomUUID();
      await updateP1SystemSetting(
        admin,
        "general",
        { watermarkText: latest },
        after.configTokens.general
      );
      const recovered = await mutateAssistantSession(
        admin,
        session.id,
        0,
        request,
        {},
        async () => {
          expect(await confirm()).toMatchObject({ replayed: true });
          return { task: { status: "completed" } };
        }
      );
      expect(recovered.revision).toBe(1);
      expect((await getP1SystemSettings()).general.watermarkText).toBe(latest);
      await expect(
        confirm({ watermarkText: "同一标识的其他内容" })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const [receipts] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM authorization_audit_log WHERE actorUserId=? AND requestId=?",
        [admin.id, confirmationId]
      );
      expect(receipts).toHaveLength(1);
    } finally {
      if (original[0]) {
        const { valueJson, updatedByUserId, updatedAt } = original[0];
        await pool.query(
          "UPDATE system_setting SET valueJson=?,updatedByUserId=?,updatedAt=? WHERE `key`='general'",
          [
            typeof valueJson === "string"
              ? valueJson
              : JSON.stringify(valueJson),
            updatedByUserId,
            updatedAt,
          ]
        );
      } else {
        await pool.query(
          "DELETE FROM system_setting WHERE `key`='general' AND updatedByUserId=?",
          [admin.id]
        );
      }
    }
  });

  it("并发重试只执行一次，旧版本和跨账号操作均拒绝，失败回滚可重试", async () => {
    const s = await createAssistantSession(user, false);
    let executions = 0;
    const request = randomUUID();
    const apply = async () => {
      executions++;
      return {
        messages: [{ role: "assistant" as const, content: "已生成" }],
        task: { status: "waiting_confirmation" },
      };
    };
    const submit = () =>
      mutateAssistantSession(user, s.id, 0, request, { input: "a" }, apply);
    const both = await Promise.all([submit(), submit()]);
    expect(executions).toBe(1);
    expect(both.map(item => item.revision)).toEqual([1, 1]);
    expect((await getAssistantSession(user, s.id)).messages).toHaveLength(1);
    await expect(
      mutateAssistantSession(user, s.id, 0, request, { input: "b" }, apply)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      mutateAssistantSession(user, s.id, 0, randomUUID(), {}, apply)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(getAssistantSession(other, s.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      mutateAssistantSession(other, s.id, 1, randomUUID(), {}, apply)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const second = randomUUID();
    await expect(
      mutateAssistantSession(user, s.id, 1, second, {}, () => {
        throw new Error("模拟暂时失败");
      })
    ).rejects.toThrow("模拟暂时失败");
    const recovered = await mutateAssistantSession(
      user,
      s.id,
      1,
      second,
      {},
      () => ({ task: { status: "completed" } })
    );
    expect(recovered).toMatchObject({
      revision: 2,
      task: { status: "completed" },
    });
  });
});
