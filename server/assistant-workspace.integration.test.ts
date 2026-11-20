import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { getSharedPool } from "./db";
import { commitWorkspace, prepareWorkspace } from "./assistant-workspace";

const run = process.env.DATABASE_URL ? it : it.skip;
run("统计按账号和项目取数，确认同一项业务操作只写一次", async () => {
  const pool = getSharedPool(),
    projectId = randomUUID(),
    key = randomUUID();
  const [actor] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (name,role,status) VALUES ('工作台验收','user','active')"
  );
  const ctx = {
    user: { id: actor.insertId, role: "user" },
    req: { headers: {} },
    res: {},
    requestId: key,
  } as TrpcContext;
  const caller = appRouter.createCaller(ctx);
  const scope = { projectId };
  try {
    await pool.query(
      "INSERT INTO flow_project(id,ownerUserId,code,name) VALUES(?,?,?,?)",
      [projectId, actor.insertId, key, "助手测试项目"]
    );
    const flow = await caller.project.createWorkflow({
      projectId,
      name: "统计样例",
      flowType: "control",
    });
    const stats = await prepareWorkspace(ctx, scope, false, {
      action: "project.workflowStatistics",
    });
    expect(stats).toMatchObject({
      kind: "read",
      result: {
        total: 1,
        byType: { control: 1 },
        byStatus: { draft: 1 },
        runs: 0,
      },
    });
    const metrics = await prepareWorkspace(
      ctx,
      { ...scope, workflowId: flow.id },
      false,
      { action: "workflow.runMetrics" }
    );
    expect(metrics).toMatchObject({
      result: await caller.workflow.runMetrics({ workflowId: flow.id }),
    });
    expect(
      await prepareWorkspace(ctx, {}, false, { action: "task.dashboard" })
    ).toMatchObject({
      result: { counts: (await caller.task.dashboard()).counts },
    });
    const pending = await prepareWorkspace(ctx, scope, true, {
      action: "project.createFolder",
      arguments: { name: "业务验收目录" },
    });
    if (pending.kind !== "proposal") throw new Error("缺少确认预览");
    const count = async () =>
      (
        await pool.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM workflow_folder WHERE projectId=?",
          [projectId]
        )
      )[0][0].n;
    expect(await count()).toBe(0);
    const submit = () =>
      commitWorkspace(ctx, scope, pending.proposal.payload.input, key);
    const receipt = await submit();
    expect(await submit()).toEqual(receipt);
    expect(await count()).toBe(1);
    await expect(
      commitWorkspace(
        ctx,
        scope,
        {
          action: "project.createFolder",
          arguments: { projectId, name: "其他目录" },
        },
        key
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    await pool.query("DELETE FROM assistant_action_receipt WHERE id=?", [key]);
    await pool.query("DELETE FROM workflow_folder WHERE projectId=?", [
      projectId,
    ]);
    await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
    await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
    await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
    await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId=?",
      [actor.insertId]
    );
    await pool.query("DELETE FROM users WHERE id=?", [actor.insertId]);
  }
}, 30000);
