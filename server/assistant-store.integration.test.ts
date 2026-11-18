import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSharedPool, getSharedPool } from "./db";
import { getP1SystemSettings, updateP1SystemSetting } from "./p1-service";
import {
  ASSISTANT_DEFAULT_ID,
  createAssistantSession,
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

  it("内置已发布助手仅启用只读工具，新草稿先由管理员试聊", async () => {
    expect(defaultConfig.tools).toEqual(["listMyTasks", "searchWorkflows", "listMyCompletedTasks"]);
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
