import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { getSharedPool } from "./db";
import { commitWorkspace, prepareWorkspace } from "./assistant-workspace";
import { runDataflowJobOnce } from "./p2-service";

const run = process.env.DATABASE_URL ? it : it.skip;
run("统计按账号和项目取数，确认同一项业务操作只写一次", async () => {
  const pool = getSharedPool(),
    projectId = randomUUID(),
    key = randomUUID(),
    restoreKey = randomUUID(),
    dataRunKey = randomUUID();
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
      definition: {
        schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
        nodes: [
          { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: {} },
          { id: "end", type: "end", name: "结束", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
      },
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

    const flowScope = { ...scope, workflowId: flow.id };
    const first = await caller.workflow.get({ id: flow.id });
    expect(await prepareWorkspace(ctx, flowScope, false, { action: "workflow.checkDraft" }))
      .toMatchObject({ result: { ok: true, definitionVersion: first.definitionVersion } });
    const next = await caller.workflow.update({
      id: flow.id,
      expectedDefinitionVersion: first.definitionVersion,
      definition: {
        ...first.definition,
        nodes: first.definition.nodes.map(node => node.id === "end" ? { ...node, name: "完成" } : node),
      },
    });
    expect(await prepareWorkspace(ctx, flowScope, false, {
      action: "workflow.compareVersions",
      arguments: { fromVersion: first.definitionVersion, toVersion: next.definitionVersion },
    })).toMatchObject({ result: { changedNodes: { total: 1, items: [{ id: "end", changedFields: ["name"] }] } } });
    const restore = await prepareWorkspace(ctx, flowScope, true, {
      action: "workflow.rollbackVersion", arguments: { targetVersion: first.definitionVersion },
    });
    if (restore.kind !== "proposal") throw new Error("缺少恢复版本预览");
    expect((await caller.workflow.get({ id: flow.id })).definitionVersion).toBe(next.definitionVersion);
    const restored = await commitWorkspace(ctx, flowScope, restore.proposal.payload.input, restoreKey);
    expect(restored).toMatchObject({ links: [{ href: `#/flows/workflow/${flow.id}/editor` }] });
    expect((await caller.workflow.get({ id: flow.id })).definition.nodes.find(node => node.id === "end")?.name).toBe("结束");

    const source = await caller.data.createSource({
      projectId, name: "内联数据", sourceType: "inline", connection: { privateMarker: "source-only" },
    });
    const asset = await caller.data.createAsset({
      projectId, sourceId: source.id, name: "测试资产", assetType: "dataset",
      schema: [{ name: "orderId", type: "string" }], sample: [{ orderId: "sample-only" }],
    });
    const profile = await prepareWorkspace(ctx, scope, false, {
      action: "data.assetProfile", arguments: { assetId: asset.id },
    });
    expect(profile).toMatchObject({ result: { readable: true, fields: { items: ["orderId"] } } });
    expect(JSON.stringify(profile)).not.toMatch(/source-only|sample-only/);
    const dataFlow = await caller.project.createWorkflow({
      projectId, name: "质量门验收流程", flowType: "data",
      definition: {
        schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {},
        nodes: [
          { id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: {} },
          { id: "source", type: "source", name: "读取数据", position: { x: 180, y: 0 }, config: { assetId: asset.id, columns: ["orderId"], limit: 1 } },
          { id: "quality", type: "quality_gate", name: "质量门", position: { x: 360, y: 0 }, config: { minRows: 2, maxNullRate: 0 } },
          { id: "end", type: "end", name: "结束", position: { x: 540, y: 0 }, config: {} },
        ],
        edges: [
          { id: "e1", sourceNodeId: "start", targetNodeId: "source" },
          { id: "e2", sourceNodeId: "source", targetNodeId: "quality" },
          { id: "e3", sourceNodeId: "quality", targetNodeId: "end" },
        ],
      },
    });
    const dataScope = { ...scope, workflowId: dataFlow.id };
    const admission = await prepareWorkspace(ctx, dataScope, false, {
      action: "workflow.preflight", arguments: { mode: "test" },
    });
    expect(admission).toMatchObject({ result: { canStart: true, mode: "test" } });
    const dataPending = await prepareWorkspace(ctx, dataScope, true, {
      action: "data.run", arguments: { mode: "test", data: { marker: "input-only" } },
    });
    if (dataPending.kind !== "proposal") throw new Error("缺少数据流程运行预览");
    expect(await caller.data.runs({ projectId, workflowId: dataFlow.id })).toEqual([]);
    const submitDataRun = () => commitWorkspace(ctx, dataScope, dataPending.proposal.payload.input, dataRunKey);
    const dataReceipt = await submitDataRun();
    const stored = await caller.data.runReceipt({
      projectId, workflowId: dataFlow.id, mode: "test", idempotencyKey: dataRunKey,
    });
    expect(stored).toMatchObject({ status: "queued" });
    const runId = stored!.runId;
    expect(dataReceipt).toMatchObject({ links: [{ href: `#/runs/monitor/${dataFlow.id}/${runId}` }] });
    await pool.query("UPDATE assistant_action_receipt SET message=NULL WHERE id=?", [dataRunKey]);
    expect(await submitDataRun()).toEqual(dataReceipt);
    expect(await caller.data.runs({ projectId, workflowId: dataFlow.id })).toHaveLength(1);
    await expect(runDataflowJobOnce(runId)).resolves.toBe(true);
    expect(await prepareWorkspace(ctx, dataScope, false, {
      action: "data.inspectRun", arguments: { runId },
    })).toMatchObject({ result: { status: "queued" } });
    for (let attempt = 2; attempt <= 3; attempt++) {
      await pool.query("UPDATE dataflow_run_job SET availableAt=NOW() WHERE runId=? AND status='queued'", [runId]);
      await expect(runDataflowJobOnce(runId)).resolves.toBe(true);
    }
    const diagnosis = await prepareWorkspace(ctx, dataScope, false, {
      action: "data.inspectRun", arguments: { runId },
    });
    expect(diagnosis).toMatchObject({ result: {
      status: "failed",
      execution: { attention: { items: expect.arrayContaining([
        expect.objectContaining({ nodeId: "quality", attempt: 3, quality: expect.objectContaining({ passed: false, rowCount: 1, minRows: 2 }) }),
      ]) } },
      lineage: { items: expect.arrayContaining([expect.objectContaining({ sourceNodeId: "start", targetNodeId: "source" })]) },
    } });
    expect(JSON.stringify(diagnosis)).not.toMatch(/input-only|sample-only|source-only/);
    await expect(prepareWorkspace(ctx, flowScope, false, {
      action: "data.inspectRun", arguments: { runId },
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await caller.project.auditWorkflow({
      projectId, workflowId: dataFlow.id, expectedDefinitionVersion: dataFlow.definitionVersion,
      expectedAuditStatus: "init", auditStatus: "approved",
    });
    await caller.workflow.publish({ id: dataFlow.id, expectedDefinitionVersion: dataFlow.definitionVersion });
    await caller.data.saveScheduleDraft({ projectId, workflowId: dataFlow.id, cronExpression: "0 0 9 * * *" });
    expect(await prepareWorkspace(ctx, dataScope, false, { action: "data.workflowSchedule" }))
      .toMatchObject({ result: { schedule: { cronExpression: "0 0 9 * * *", status: "paused" } } });
  } finally {
    await pool.query("DELETE FROM assistant_action_receipt WHERE id IN (?)", [[key, restoreKey, dataRunKey]]);
    await pool.query("DELETE FROM dataflow_schedule WHERE projectId=?", [projectId]);
    await pool.query("DELETE m FROM dataflow_manual_receipt m JOIN dataflow_run r ON r.id=m.runId WHERE r.projectId=?", [projectId]);
    await pool.query("DELETE FROM dataflow_run WHERE projectId=?", [projectId]);
    await pool.query("DELETE FROM data_asset WHERE projectId=?", [projectId]);
    await pool.query("DELETE FROM data_source WHERE projectId=?", [projectId]);
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
