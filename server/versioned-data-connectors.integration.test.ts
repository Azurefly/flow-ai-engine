import { randomBytes, randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { getSharedPool } from "./db";
import type { TrpcContext } from "./_core/context";
import { runDataflowJobOnce } from "./p2-service";
import { FLOW_SESSION_COOKIE } from "./internal-auth";
import { hash } from "./data-connector-contract";
import { workflowReviewForTest } from "./workflow-revision-test-support";
import * as engine from "./workflow-engine";

const tag = randomBytes(6).toString("hex"),
  cookie = randomBytes(32).toString("hex"),
  code = ("G01_" + tag).toUpperCase();
let owner: ReturnType<typeof appRouter.createCaller>,
  viewer: ReturnType<typeof appRouter.createCaller>,
  userId: number,
  projectId: string,
  api: string,
  file: string,
  apiVersion: string,
  writeVersion: string;
const db = getSharedPool;
const response = (value: unknown, status = 200) => ({
  status,
  statusText: "",
  headers: {},
  bytes: new TextEncoder().encode(JSON.stringify(value)),
});
const actor = (id: number, role: "admin" | "user") =>
  appRouter.createCaller({
    user: { id, role },
    req: { headers: { cookie: FLOW_SESSION_COOKIE + "=" + cookie } },
    res: {},
  } as unknown as TrpcContext);
async function makeFlow(asset: string, version: string, out?: string) {
  const specs = [
    ["begin", "start", {}],
    [
      "read",
      "source",
      { assetId: asset, connectorVersionId: version, limit: 100 },
    ],
    [
      "target",
      "sink",
      {
        outputName: "result",
        writeMode: out ? "receipt" : "audit_only",
        ...(out ? { connectorVersionId: out } : {}),
        idempotencyKey: "{{run.id}}",
      },
    ],
    ["end", "end", {}],
  ] as const;
  const flow = await owner.project.createWorkflow({
    projectId,
    name: "交换测例 " + randomUUID(),
    flowType: "data",
    definition: {
      schemaVersion: 1,
      settings: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: specs.map(([id, type, config], i) => ({
        id,
        type,
        name: id,
        config,
        position: { x: 100 * i, y: 0 },
      })),
      edges: specs.slice(1).map(([target], i) => ({
        id: "e" + i,
        sourceNodeId: specs[i][0],
        targetNodeId: target,
      })),
    },
  });
  await owner.project.auditWorkflow({
    projectId,
    workflowId: flow.id,
    auditStatus: "approved",
    ...(await workflowReviewForTest(flow.id)),
  });
  await owner.workflow.publish({
    id: flow.id,
    expectedDefinitionVersion: (await workflowReviewForTest(flow.id))
      .expectedDefinitionVersion,
  });
  return flow.id;
}
async function start(flow: string) {
  return (
    await owner.data.run({
      projectId,
      workflowId: flow,
      mode: "formal",
      idempotencyKey: randomUUID(),
    })
  ).runId;
}
async function drain(runId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await runDataflowJobOnce(runId);
    const detail = await owner.data.runDetail({ projectId, runId });
    if (detail.status !== "queued") return detail;
    await db().query(
      "UPDATE dataflow_run_job SET availableAt=NOW() WHERE runId=? AND status='queued'",
      [runId]
    );
  }
  throw Error("作业没有进入终态。");
}

describe
  .skipIf(!process.env.DATABASE_URL)
  .sequential("G01 数据流程固定版本、检查点和外部回执", () => {
    beforeAll(async () => {
      const uid = async (role: "admin" | "user") => {
        const [[existing]] = await db().query<mysql.RowDataPacket[]>(
          "SELECT id FROM users WHERE username=?",
          ["g01_" + role + tag]
        );
        if (existing) return Number(existing.id);
        const [result] = await db().query<mysql.ResultSetHeader>(
          "INSERT INTO users (username,name,role,status) VALUES (?,?,?,'active')",
          ["g01_" + role + tag, "G01 测试", role]
        );
        return result.insertId;
      };
      userId = await uid("admin");
      owner = actor(userId, "admin");
      viewer = actor(await uid("user"), "user");
      await db().query(
        "INSERT INTO auth_session (id,userId,tokenHash,expiresAt) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 20 MINUTE))",
        [randomUUID(), userId, hash(cookie)]
      );
      projectId = (
        await owner.project.create({ code, name: "G01 测试 " + tag })
      ).id;
      for (const kind of ["api", "file"] as const) {
        const src = await owner.data.createSource({
          projectId,
          name: kind,
          sourceType: kind,
          connection: {},
        });
        const asset = await owner.data.createAsset({
          projectId,
          sourceId: src.id,
          name: kind,
          assetType: "dataset",
          schema: [{ name: "id", type: "string" }],
        });
        if (kind === "api") api = asset.id;
        else file = asset.id;
      }
      await owner.project.createServiceEndpoint({
        projectId,
        refCode: "EXCHANGE_TEST",
        name: "单测对端",
        baseUrl: "https://example.com/synthetic/",
        targetEnvironment: "test",
      });
      apiVersion = (
        await owner.connector.register({
          projectId,
          assetId: api,
          kind: "api_read",
          label: "读",
          endpointRef: "EXCHANGE_TEST",
          path: "rows",
          datasetVersion: "r1",
          rowKey: "id",
          maxPages: 3,
          maxRows: 3,
        })
      ).versionId;
      writeVersion = (
        await owner.connector.register({
          projectId,
          assetId: api,
          kind: "receipt_write",
          label: "写",
          endpointRef: "EXCHANGE_TEST",
          path: "receipts",
          rowKey: "id",
        })
      ).versionId;
    }, 60000);
    afterAll(async () => {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      if (projectId) {
        const p = await owner.project.lifecyclePreview({ projectId });
        if (p.code === code)
          await owner.project.changeStatus({
            projectId,
            status: "archived",
            expectedWorkflowCount: p.workflowCount,
            expectedVersion: p.lifecycleVersion,
          });
      }
      if (userId)
        await db().query(
          "UPDATE auth_session SET revokedAt=NOW() WHERE userId=? AND tokenHash=?",
          [userId, hash(cookie)]
        );
    });
    it("同名文件新版本、固定发布快照与隔离读取", async () => {
      const upload = (text: string, label: string) =>
        owner.connector.register({
          projectId,
          assetId: file,
          kind: "file_read",
          fileName: "same.csv",
          label,
          base64: Buffer.from(text).toString("base64"),
        });
      const original = await upload('id,name\r\n1,"中文,\r\n二"', "一");
      const first = await makeFlow(file, original.versionId);
      const replacement = await upload("id,name\n1,新值", "二");
      const second = await makeFlow(file, replacement.versionId);
      expect(replacement.versionId).not.toBe(original.versionId);
      expect(await upload("id,name\n1,新值", "二")).toEqual(replacement);
      for (const [flow, v, value] of [
        [first, original, "中文,\r\n二"],
        [second, replacement, "新值"],
      ] as const) {
        const run = await drain(await start(flow));
        expect(run.status).toBe("success");
        expect(
          run.nodeRuns.find(n => n.nodeId === "read")?.output
        ).toMatchObject({
          rows: [{ id: "1", name: value }],
          resourceVersion: { id: v.versionId, contentHash: v.contentHash },
        });
        expect(
          await owner.connector.writes({ projectId, runId: run.id })
        ).toEqual([]);
      }
      await expect(viewer.connector.versions({ projectId })).rejects.toThrow();
      await expect(makeFlow(api, original.versionId)).rejects.toThrow();
      vi.stubEnv("FLOW_DATA_CONNECTOR_DISABLED", "file_read");
      await expect(start(first)).rejects.toThrow(/停用/);
      vi.unstubAllEnvs();
    }, 60000);
    it("第2页首次中断后恢复、提交后响应丢失、原键回查及重复确认", async () => {
      const requests: number[] = [],
        target = new Map<string, any>();
      let writes = 0;
      const net = vi
        .spyOn(engine, "requestDataExchange")
        .mockImplementation(async (url, method, _headers, _timeout, body) => {
          const u = new URL(url);
          if (u.pathname.endsWith("/rows")) {
            const i = Number(u.searchParams.get("cursor") ?? 0);
            requests.push(i);
            if (i === 1 && requests.filter(x => x === 1).length === 1)
              throw Error("temporary");
            return response({
              version: "r1",
              rows: [{ id: String(i) }],
              nextCursor: i === 2 ? null : String(i + 1),
            });
          }
          const key = u.pathname.split("/").pop()!;
          if (method === "GET")
            return target.has(key)
              ? response(target.get(key))
              : response({}, 404);
          writes++;
          const data = JSON.parse(body!);
          target.set(key, {
            operationKey: key,
            payloadHash: data.payloadHash,
            rowCount: data.rows.length,
            receipt: "peer-proof",
          });
          throw Error("lost response");
        });
      try {
        const runId = await start(
          await makeFlow(api, apiVersion, writeVersion)
        );
        const run = await drain(runId);
        expect(run.status).toBe("success");
        expect(requests).toEqual([0, 1, 1, 2]);
        expect(writes).toBe(0);
        const [pages] = await db().query<mysql.RowDataPacket[]>(
          "SELECT pageNo,JSON_LENGTH(rowsJson) AS staged FROM data_connector_page WHERE runId=? ORDER BY pageNo",
          [runId]
        );
        expect(pages.map(p => [p.pageNo, p.staged])).toEqual([
          [0, 0],
          [1, 0],
          [2, 0],
        ]);
        const [preview] = await owner.connector.writes({ projectId, runId });
        expect(preview).toMatchObject({
          canConfirm: true,
          status: "preview",
          rowCount: 3,
        });
        const input = {
          projectId,
          operationKey: preview.operationKey,
          payloadHash: preview.payloadHash,
        };
        await expect(viewer.connector.confirm(input)).rejects.toThrow();
        await expect(
          owner.connector.confirm({ ...input, payloadHash: "0".repeat(64) })
        ).rejects.toThrow();
        expect(await owner.connector.confirm(input)).toEqual({
          status: "committed",
          receipt: "peer-proof",
        });
        expect(await owner.connector.confirm(input)).toEqual({
          status: "committed",
          receipt: "peer-proof",
        });
        expect(writes).toBe(1);
      } finally {
        net.mockRestore();
      }
    }, 60000);
    it("目标拒绝无效行时保留原操作与 HTTP 状态，重复确认不再次发送", async () => {
      const uploaded = await owner.connector.register({
        projectId,
        assetId: file,
        kind: "file_read",
        fileName: "rejected.csv",
        label: "不符合目标行合同",
        base64: Buffer.from("id,name\n1,退回").toString("base64"),
      });
      const runId = await start(
        await makeFlow(file, uploaded.versionId, writeVersion)
      );
      expect((await drain(runId)).status).toBe("success");
      const [record] = await owner.connector.writes({ projectId, runId });
      const input = {
        projectId,
        operationKey: record.operationKey,
        payloadHash: record.payloadHash,
      };
      const requests: string[] = [];
      const net = vi
        .spyOn(engine, "requestDataExchange")
        .mockImplementation(async (_url, method) => {
          requests.push(method);
          return method === "POST" ? response({}, 422) : response({}, 404);
        });
      try {
        expect(await owner.connector.confirm(input)).toEqual({
          status: "rejected",
          receipt: null,
        });
        expect(await owner.connector.confirm(input)).toEqual({
          status: "rejected",
          receipt: null,
        });
        expect(requests).toEqual(["GET", "POST"]);
        expect(
          (await owner.connector.writes({ projectId, runId }))[0].status
        ).toBe("rejected_422");
      } finally {
        net.mockRestore();
      }
    }, 60000);
    it.each(["pages", "bytes", "rows"] as const)(
      "拒绝超出版本 %s 限额，清理失败作业暂存",
      async cap => {
        const v = await owner.connector.register({
          projectId,
          assetId: api,
          kind: "api_read",
          label: "限额" + cap,
          endpointRef: "EXCHANGE_TEST",
          path: "rows",
          datasetVersion: "r1",
          rowKey: "id",
          maxPages: cap === "pages" ? 1 : 10,
          maxRows: cap === "rows" ? 1 : 10,
          maxBytes: cap === "bytes" ? 8 : 10000,
        });
        const net = vi
          .spyOn(engine, "requestDataExchange")
          .mockImplementation(async url => {
            const i = new URL(url).searchParams.get("cursor");
            return response({
              version: "r1",
              rows: [{ id: i ?? "first" }],
              nextCursor: i ? null : "next",
            });
          });
        try {
          const run = await drain(
            await start(await makeFlow(api, v.versionId))
          );
          expect(run.status).toBe("failed");
          expect(run.error).toMatchObject({
            message: expect.stringContaining("限额"),
          });
        } finally {
          net.mockRestore();
        }
      },
      60000
    );
    it("操作员在分页期间失权，原实例不再提交新页，暂存清理", async () => {
      const [[member]] = await db().query<mysql.RowDataPacket[]>(
        "SELECT id FROM users WHERE username=?",
        ["g01_user" + tag]
      );
      await owner.project.grantMember({
        projectId,
        userId: Number(member.id),
        role: "operator",
      });
      const workflowId = await makeFlow(api, apiVersion);
      const runId = (
        await viewer.data.run({
          projectId,
          workflowId,
          mode: "formal",
          idempotencyKey: randomUUID(),
        })
      ).runId;
      const calls: string[] = [];
      const net = vi
        .spyOn(engine, "requestDataExchange")
        .mockImplementation(async url => {
          const cursor = new URL(url).searchParams.get("cursor") ?? "first";
          calls.push(cursor);
          if (cursor === "second")
            await owner.project.revokeMember({
              projectId,
              userId: Number(member.id),
            });
          return response({
            version: "r1",
            rows: [{ id: cursor }],
            nextCursor: cursor === "first" ? "second" : "third",
          });
        });
      try {
        const run = await drain(runId);
        expect(run.status).toBe("failed");
        expect(calls).toEqual(["first", "second"]);
        const [saved] = await db().query<mysql.RowDataPacket[]>(
          "SELECT pageNo,JSON_LENGTH(rowsJson) AS staged FROM data_connector_page WHERE runId=?",
          [runId]
        );
        expect(saved.map(r => [r.pageNo, r.staged])).toEqual([[0, 0]]);
        await expect(
          viewer.data.runDetail({ projectId, runId })
        ).rejects.toThrow();
      } finally {
        net.mockRestore();
      }
    }, 60000);
    it("取消运行后拒绝提交在途页，停止派发并释放暂存", async () => {
      const workflow = await makeFlow(api, apiVersion),
        runId = await start(workflow);
      const pages: string[] = [];
      const net = vi
        .spyOn(engine, "requestDataExchange")
        .mockImplementation(async url => {
          const cursor = new URL(url).searchParams.get("cursor") ?? "first";
          pages.push(cursor);
          if (cursor === "second")
            await owner.data.cancelRun({
              projectId,
              runId,
              reason: "测试在途页取消",
            });
          return response({
            version: "r1",
            rows: [{ id: cursor }],
            nextCursor: cursor === "first" ? "second" : "third",
          });
        });
      try {
        await runDataflowJobOnce(runId);
        expect((await owner.data.runDetail({ projectId, runId })).status).toBe(
          "cancelled"
        );
        expect(pages).toEqual(["first", "second"]);
        const [saved] = await db().query<mysql.RowDataPacket[]>(
          "SELECT pageNo,JSON_LENGTH(rowsJson) AS staged FROM data_connector_page WHERE runId=?",
          [runId]
        );
        expect(saved.map(r => [r.pageNo, r.staged])).toEqual([[0, 0]]);
      } finally {
        net.mockRestore();
      }
    }, 60000);
  });
