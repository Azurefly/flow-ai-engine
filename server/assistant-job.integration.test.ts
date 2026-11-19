import { createHash, randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalResourcePayload } from "../shared/resource-creation";
import { getSharedPool } from "./db";
import {
  createAssistantSession,
  getAssistantConfig,
  getAssistantSession,
  mutateAssistantSession,
  publishAssistantConfig,
  saveAssistantDraft,
} from "./assistant-store";
import {
  assistantJobContext,
  assistantJobOperations,
  cancelAssistantJob,
  claimAssistantJob,
  enqueueAssistantJob,
  finishAssistantJob,
  getAssistantJob,
  LostAssistantLease,
  reviewAssistantJob,
} from "./assistant-jobs";
import {
  processAssistantLease,
  runAssistantJobOnce,
} from "./assistant-job-worker";
import { commitWorkspace, prepareWorkspace } from "./assistant-workspace";
import type { TrpcContext } from "./_core/context";
import type { InvokeResult } from "./_core/llm";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("持久助手回合", () => {
  const pool = () => getSharedPool();
  const projectId = randomUUID();
  const receipts: string[] = [];
  let admin: { id: number; role: "admin"; tokenVersion: number };
  let other: { id: number; role: "user"; tokenVersion: number };
  let agentId: string;
  const text = { kind: "message", text: "返回合成样本" } as const;
  const reply = {
    choices: [
      {
        message: { role: "assistant", content: "已读合成样本" },
        finish_reason: "stop",
      },
    ],
  } as InvokeResult;
  const current = (id: string) => getAssistantSession(admin, id);
  const session = (trial = false) =>
    createAssistantSession(admin, trial, undefined, projectId, agentId);
  beforeAll(async () => {
    const [a] = await pool().query<ResultSetHeader>(
      "INSERT INTO users (name,role) VALUES ('G04 测试管理员','admin')"
    );
    const [b] = await pool().query<ResultSetHeader>(
      "INSERT INTO users (name,role) VALUES ('G04 测试观察者','user')"
    );
    admin = { id: a.insertId, role: "admin", tokenVersion: 1 };
    other = { id: b.insertId, role: "user", tokenVersion: 1 };
    const config = (await getAssistantConfig()).draft;
    const created = await saveAssistantDraft(admin, 0, {
      ...config,
      name: "作业测试",
      enabled: true,
      tools: ["workspaceWrite"],
      roles: ["admin", "user"],
      projectIds: [],
    });
    agentId = created.agentId;
    await publishAssistantConfig(admin, created.draftVersion, agentId);
    await pool().query(
      "INSERT INTO flow_project (id,ownerUserId,code,name) VALUES (?,?,?,?)",
      [projectId, admin.id, projectId, "G04 作业测试"]
    );
  });
  afterAll(async () => {
    if (receipts.length)
      await pool().query(
        "DELETE FROM assistant_action_receipt WHERE id IN (?)",
        [receipts]
      );
    if (admin) {
      await pool().query("DELETE FROM workflow_folder WHERE projectId=?", [
        projectId,
      ]);
      await pool().query("DELETE FROM flow_project WHERE id=?", [projectId]);
      await pool().query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?)",
        [[admin.id, other.id]]
      );
      await pool().query("DELETE FROM users WHERE id IN (?)", [
        [admin.id, other.id],
      ]);
    }
    if (agentId)
      await pool().query("DELETE FROM assistant_agent WHERE id=?", [agentId]);
  });

  it("慢模型同时处理两会话时释放会话锁，重复请求、竞争与旧客户端回执可核对", async () => {
    const sessions = await Promise.all([session(), session()]);
    const key = randomUUID(),
      rightKey = randomUUID();
    const [first, duplicate] = await Promise.all(
      [1, 2].map(() => enqueueAssistantJob(admin, sessions[0].id, 0, key, text))
    );
    expect(duplicate.id).toBe(first.id);
    await expect(
      enqueueAssistantJob(admin, sessions[0].id, 0, key, {
        ...text,
        text: "另一个意图",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      enqueueAssistantJob(admin, sessions[0].id, 0, randomUUID(), text)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const right = await enqueueAssistantJob(
      admin,
      sessions[1].id,
      0,
      rightKey,
      text
    );
    let entered = 0,
      release!: () => void,
      arrival!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const both = new Promise<void>(resolve => (arrival = resolve));
    const model = async () => async () => {
      if (++entered === 2) arrival();
      await gate;
      return reply;
    };
    const work = Promise.all([
      runAssistantJobOnce(first.id, model),
      runAssistantJobOnce(right.id, model),
    ]);
    try {
      await Promise.race([
        both,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("两项作业未并发进入模型")),
            4000
          ).unref()
        ),
      ]);
      const cn = await pool().getConnection();
      try {
        await cn.beginTransaction();
        const [rows] = await cn.query<RowDataPacket[]>(
          "SELECT id FROM assistant_session WHERE id IN (?) FOR UPDATE NOWAIT",
          [sessions.map(s => s.id)]
        );
        expect(rows).toHaveLength(2);
      } finally {
        await cn.rollback();
        cn.release();
      }
      expect(await claimAssistantJob(first.id)).toBeNull();
      expect(await getAssistantJob(admin, sessions[0].id, key)).toMatchObject({
        status: "running",
        attempts: 1,
      });
      await expect(
        getAssistantJob(other, sessions[0].id, key)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      release();
      await work;
    }
    expect(await getAssistantSession(admin, sessions[0].id, key)).toMatchObject(
      { requestCommitted: true, revision: 1 }
    );
    expect(
      await enqueueAssistantJob(admin, sessions[0].id, 0, key, text)
    ).toMatchObject({ id: first.id, status: "completed" });
    expect(
      (await current(sessions[0].id)).messages.map(m => m.content)
    ).toContain("已读合成样本");
    expect((await current(sessions[1].id)).revision).toBe(1);
  });

  it("六个会话同时首次接单及重放时空队列范围不锁住其他会话", async () => {
    const sessions = await Promise.all(
      Array.from({ length: 6 }, () => session())
    );
    const requests = sessions.map(s => ({ id: s.id, key: randomUUID() }));
    const submit = () =>
      Promise.all(
        requests.map(r => enqueueAssistantJob(admin, r.id, 0, r.key, text))
      );
    const first = await submit();
    expect(Math.abs(Date.now() - Date.parse(first[0].queuedAt!))).toBeLessThan(30_000);
    expect(new Set(first.map(job => job.id)).size).toBe(6);
    expect((await submit()).map(job => job.id)).toEqual(
      first.map(job => job.id)
    );
    await Promise.all(
      requests.map(r => cancelAssistantJob(admin, r.id, r.key))
    );
  });

  it("取消只影响尚未领取的请求，接管过期租约后旧执行者失去提交权", async () => {
    const s = await session(),
      key = randomUUID();
    const cancelled = await enqueueAssistantJob(admin, s.id, 0, key, text);
    await cancelAssistantJob(admin, s.id, key);
    await cancelAssistantJob(admin, s.id, key);
    expect(await claimAssistantJob(cancelled.id)).toBeNull();
    expect((await getAssistantJob(admin, s.id, key))?.status).toBe("cancelled");
    const next = await enqueueAssistantJob(admin, s.id, 0, randomUUID(), text),
      old = (await claimAssistantJob(next.id))!;
    await expect(
      cancelAssistantJob(admin, s.id, next.requestId)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await pool().execute(
      "UPDATE assistant_turn_job SET leaseUntil=TIMESTAMPADD(SECOND,-1,NOW(3)) WHERE id=?",
      [next.id]
    );
    const fresh = (await claimAssistantJob(next.id))!;
    expect(fresh.attempts).toBe(2);
    await expect(
      finishAssistantJob(
        old,
        { messages: [{ role: "assistant", content: "过期结果" }] },
        new Set()
      )
    ).rejects.toBeInstanceOf(LostAssistantLease);
    await processAssistantLease(fresh, async () => async () => reply);
    expect((await current(s.id)).messages.map(m => m.content)).not.toContain(
      "过期结果"
    );
    expect((await current(s.id)).revision).toBe(1);
  });

  async function proposal(
    sid: string,
    action = "project.createFolder",
    args: Record<string, unknown> = { name: "目录" + randomUUID() }
  ) {
    const scope = { projectId },
      key = randomUUID();
    const ctx = { user: admin, requestId: key } as TrpcContext;
    const prepared = await prepareWorkspace(ctx, scope, true, {
      action,
      arguments: args,
    });
    if (prepared.kind !== "proposal") throw new Error("缺少测试提案");
    const p = prepared.proposal;
    await mutateAssistantSession(admin, sid, 0, randomUUID(), {}, () => ({
      task: {
        status: "waiting_confirmation",
        pending: { id: key, proposal: p },
      },
    }));
    receipts.push(key);
    const requestId = randomUUID();
    const job = await enqueueAssistantJob(admin, sid, 1, requestId, {
      kind: "decide",
      proposalId: key,
      approve: true,
    });
    return { key, ctx, scope, p, requestId, job };
  }
  it("领域已提交后模拟消费者中止，重新领取后同一目录只有一个，原请求得到会话回执", async () => {
    const s = await session(),
      f = await proposal(s.id);
    const lost = (await claimAssistantJob(f.job.id))!;
    await assistantJobContext(lost, "workspaceWrite", {
      key: f.key,
      action: "project.createFolder",
    });
    const business = await commitWorkspace(
      f.ctx,
      f.scope,
      f.p.payload.input,
      f.key
    );
    expect(business.message).toContain("已执行");
    expect((await current(s.id)).revision).toBe(1);
    await pool().execute(
      "UPDATE assistant_turn_job SET leaseUntil=TIMESTAMPADD(SECOND,-1,NOW(3)) WHERE id=?",
      [f.job.id]
    );
    await runAssistantJobOnce(f.job.id);
    expect((await current(s.id)).revision).toBe(2);
    expect(await getAssistantJob(admin, s.id, f.requestId)).toMatchObject({
      status: "completed",
      attempts: 2,
      actionKey: f.key,
    });
    const [rows] = await pool().query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM workflow_folder WHERE projectId=? AND name=?",
      [projectId, f.p.payload.input.arguments.name]
    );
    expect(Number(rows[0].n)).toBe(1);
  });
  it("无法证明业务结果时进入待核对，只有管理员可以登记可追踪结论，重复核对不追加第二个回合", async () => {
    const s = await session();
    const f = await proposal(s.id);
    const hash = createHash("sha256")
      .update(
        canonicalResourcePayload({
          user: admin.id,
          input: f.p.payload.input,
          scope: f.scope,
        })
      )
      .digest("hex");
    // An older unacknowledged dispatch has no verifiable domain ID.
    await pool().execute(
      "INSERT INTO assistant_action_receipt(id,payloadHash) VALUES (?,?)",
      [f.key, hash]
    );
    await runAssistantJobOnce(f.job.id);
    expect(await getAssistantJob(admin, s.id, f.requestId)).toMatchObject({
      status: "needs_review",
      failureCode: "outcome_unknown",
    });
    await expect(
      enqueueAssistantJob(admin, s.id, 2, randomUUID(), text)
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await assistantJobOperations(admin)).review.some(j => j.id === f.job.id)
    ).toBe(true);
    await expect(
      reviewAssistantJob(other, f.job.id, false, "fixture-ref-1")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reviewAssistantJob(admin, f.job.id, false, "fixture-ref-1");
    await reviewAssistantJob(admin, f.job.id, false, "fixture-ref-1");
    expect(await getAssistantJob(admin, s.id, f.requestId)).toMatchObject({
      status: "failed",
      failureCode: "manual_not_applied",
      evidence: "fixture-ref-1",
    });
    expect((await current(s.id)).revision).toBe(3);
    expect((await current(s.id)).messages.at(-1)?.content).toContain(
      "fixture-ref-1"
    );
  });

  it("试聊只模拟确认；工具在排队后撤销会在执行时拒绝", async () => {
    const trial = await session(true),
      t = await proposal(trial.id);
    await runAssistantJobOnce(t.job.id);
    expect((await current(trial.id)).messages.at(-1)?.content).toContain(
      "模拟确认"
    );
    const normal = await session(),
      f = await proposal(normal.id);
    const original = await getAssistantConfig(agentId);
    try {
      const updated = await saveAssistantDraft(
        admin,
        original.draftVersion,
        { ...original.draft, tools: [] },
        agentId
      );
      await publishAssistantConfig(admin, updated.draftVersion, agentId);
      await runAssistantJobOnce(f.job.id);
      expect(
        await getAssistantJob(admin, normal.id, f.requestId)
      ).toMatchObject({ status: "failed", failureCode: "permission_changed" });
      const [rows] = await pool().query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM workflow_folder WHERE projectId=? AND name IN (?)",
        [
          projectId,
          [t.p.payload.input.arguments.name, f.p.payload.input.arguments.name],
        ]
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      const latest = await getAssistantConfig(agentId);
      const updated = await saveAssistantDraft(
        admin,
        latest.draftVersion,
        original.draft,
        agentId
      );
      await publishAssistantConfig(admin, updated.draftVersion, agentId);
    }
  });
  it("旧请求映射持久回执，在停止接单时仍可读取，同键更改内容会冲突", async () => {
    const s = await session(),
      key = randomUUID();
    await mutateAssistantSession(admin, s.id, 0, key, text, () => ({
      task: { status: "completed" },
    }));
    const prior = await getAssistantJob(admin, s.id, key);
    expect(prior).toMatchObject({ legacy: true, status: "completed" });
    const intake = process.env.ASSISTANT_JOB_INTAKE;
    try {
      process.env.ASSISTANT_JOB_INTAKE = "paused";
      expect((await enqueueAssistantJob(admin, s.id, 0, key, text)).id).toBe(
        prior!.id
      );
      await expect(
        enqueueAssistantJob(admin, s.id, 1, randomUUID(), text)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      if (intake === undefined) delete process.env.ASSISTANT_JOB_INTAKE;
      else process.env.ASSISTANT_JOB_INTAKE = intake;
    }
  });
});
