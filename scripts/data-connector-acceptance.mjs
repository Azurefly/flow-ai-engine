import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import {
  routerAcceptanceConfig,
  RouterAcceptanceSession,
} from "./router-acceptance-safety.mjs";

const { base, username, password } = routerAcceptanceConfig(process.env);
const endpoint = new URL(process.env.FLOW_EXCHANGE_BASE_URL ?? "");
assert(
  endpoint.protocol === "https:" &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.search &&
    !endpoint.hash &&
    /^\/g01\/[a-zA-Z0-9_-]{12,64}\/$/.test(endpoint.pathname),
  "需要专用 HTTPS 测试租户"
);
assert.equal(
  process.env.FLOW_EXCHANGE_CONFIRM_TARGET,
  endpoint.href,
  "必须确认本次允许写入的具体测试租户"
);
const secretRef = process.env.FLOW_EXCHANGE_SECRET_REF;
assert.match(secretRef ?? "", /^env:FLOW_SECRET_[A-Z0-9_]{2,128}$/);
const peerToken = readFileSync(
  process.env.FLOW_EXCHANGE_TOKEN_FILE,
  "utf8"
).trim();
const peer = async name => {
  const r = await fetch(new URL(name, endpoint), {
    headers: { Authorization: "Bearer " + peerToken },
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(r.status, 200, "交换服务回读失败");
  return r;
};
const app = new RouterAcceptanceSession(base);
const rpc = (name, data = {}, write = false) => app.request(name, data, write);
const tag = randomBytes(6).toString("hex"),
  code = ("G01_" + tag).toUpperCase(),
  report = { projectCode: code };
let project,
  workflowCount = 0;
async function createFlow(name, assetId, inputVersion, outputVersion) {
  const specs = [
    ["start", "start", {}],
    [
      "source",
      "source",
      {
        assetId,
        ...(inputVersion ? { connectorVersionId: inputVersion } : {}),
        columns: [],
        limit: 100,
      },
    ],
    [
      "sink",
      "sink",
      {
        outputName: "交换明细",
        writeMode: outputVersion ? "receipt" : "audit_only",
        ...(outputVersion ? { connectorVersionId: outputVersion } : {}),
        idempotencyKey: "{{run.id}}",
      },
    ],
    ["end", "end", {}],
  ];
  const definition = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: specs.map(([id, type, config], i) => ({
      id,
      type,
      name: id,
      config,
      position: { x: 200 * i, y: 0 },
    })),
    edges: specs
      .slice(1)
      .map(([id], i) => ({
        id: "e" + i,
        sourceNodeId: specs[i][0],
        targetNodeId: id,
      })),
  };
  const flow = await rpc(
    "project.createWorkflow",
    { projectId: project.id, name, flowType: "data", definition },
    true
  );
  workflowCount++;
  const draft = await rpc("workflow.get", { id: flow.id });
  await rpc(
    "project.auditWorkflow",
    {
      projectId: project.id,
      workflowId: flow.id,
      auditStatus: "approved",
      expectedDefinitionVersion: draft.definitionVersion,
      expectedAuditStatus: draft.auditStatus,
    },
    true
  );
  const reviewed = await rpc("workflow.get", { id: flow.id });
  await rpc(
    "workflow.publish",
    { id: flow.id, expectedDefinitionVersion: reviewed.definitionVersion },
    true
  );
  return flow.id;
}
async function run(flow, shouldSucceed = true) {
  const check = await rpc(
    "workflow.runReadiness",
    { workflowId: flow, mode: "formal", input: {} },
    true
  );
  const start = await rpc(
    "data.run",
    {
      projectId: project.id,
      workflowId: flow,
      mode: "formal",
      idempotencyKey: randomBytes(16).toString("hex"),
      expectedDefinitionVersion: check.definitionVersion,
      expectedExecutionPlanHash: check.executionPlanHash,
    },
    true
  );
  const until = Date.now() + 150000;
  while (Date.now() < until) {
    const detail = await rpc("data.runDetail", {
      projectId: project.id,
      runId: start.runId,
    });
    if (["failed", "success", "cancelled"].includes(detail.status)) {
      assert.equal(
        detail.status,
        shouldSucceed ? "success" : "failed",
        "运行 " + start.runId + " 终态"
      );
      return detail;
    }
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw Error("等待该数据流超时 " + start.runId);
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const register = async args =>
  await rpc("connector.register", { projectId: project.id, ...args }, true);
const makeSourceAsset = async (kind, name) => {
  const src = await rpc(
    "data.createSource",
    { projectId: project.id, name, sourceType: kind, connection: {} },
    true
  );
  return (
    await rpc(
      "data.createAsset",
      {
        projectId: project.id,
        sourceId: src.id,
        name,
        assetType: kind === "file" ? "file" : "endpoint",
        schema: [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
        ],
      },
      true
    )
  ).id;
};
await rpc("auth.login", { username, password }, true);
try {
  const initial = await (await peer("counters")).json();
  project = await rpc(
    "project.create",
    { name: "连接器外部联测 " + tag, code },
    true
  );
  report.projectId = project.id;
  console.log(
    JSON.stringify({ stage: "created", projectId: project.id, code })
  );
  const refCode = "G01_PEER";
  const ep = await rpc(
    "project.createServiceEndpoint",
    {
      projectId: project.id,
      refCode,
      name: "专用数据交换租户",
      baseUrl: endpoint.href,
      targetEnvironment: "test",
      secretRef,
      authHeaderName: "Authorization",
      authScheme: "Bearer",
    },
    true
  );
  const api = await makeSourceAsset("api", "联测分页数据"),
    file = await makeSourceAsset("file", "联测同名文件");
  const apiVersion = await register({
    kind: "api_read",
    assetId: api,
    label: "API A",
    endpointRef: refCode,
    path: "rows",
    datasetVersion: "revision-v1",
    rowKey: "id",
    maxPages: 3,
    maxRows: 3,
  });
  const write = await register({
    kind: "receipt_write",
    assetId: api,
    label: "回执 A",
    endpointRef: refCode,
    path: "receipts",
    rowKey: "id",
  });
  const apiFlow = await createFlow(
    "API 分页并预览写回",
    api,
    apiVersion.versionId,
    write.versionId
  );
  const detail = await run(apiFlow),
    rows = detail.nodeRuns.find(n => n.nodeId === "source").output;
  assert.deepEqual(rows.rows, [
    { id: "1", name: "北区" },
    { id: "2", name: "东区" },
    { id: "3", name: "南区" },
  ]);
  assert.equal(rows.resourceVersion.id, apiVersion.versionId);
  assert.equal(rows.resourceVersion.pageCount, 3);
  const scope = { projectId: project.id, runId: detail.id },
    [preview] = await rpc("connector.writes", scope);
  assert(
    preview.canConfirm && preview.rowCount === 3 && preview.status === "preview"
  );
  assert.equal(
    (await (await peer("counters")).json()).commits,
    initial.commits
  );
  const approval = {
    projectId: project.id,
    payloadHash: preview.payloadHash,
    operationKey: preview.operationKey,
  };
  let applied = await rpc("connector.confirm", approval, true);
  if (applied.status === "pending")
    applied = await rpc("connector.confirm", approval, true);
  assert.equal(applied.status, "committed");
  assert.deepEqual(await rpc("connector.confirm", approval, true), applied);
  const actual = await (await peer("receipts/" + preview.operationKey)).json();
  assert.equal(actual.receipt, applied.receipt);
  assert.equal(actual.payloadHash, preview.payloadHash);
  assert.equal(actual.rowCount, 3);
  const business = await (await peer("objects/" + preview.operationKey)).json();
  assert.equal(business.operationKey, preview.operationKey);
  assert.deepEqual(business.rows, rows.rows);
  report.remoteRowsMatched = true;
  const after = await (await peer("counters")).json();
  assert.equal(after.commits - initial.commits, 1);
  assert.equal(after.pages[0] - initial.pages[0], 1);
  assert.equal(after.pages[2] - initial.pages[2], 1);
  if (process.env.FLOW_EXCHANGE_EXPECT_FAULTS === "1" && initial.pages[1] === 0)
    assert.equal(after.pages[1], 2);
  Object.assign(report, {
    apiRun: detail.id,
    pages: after.pages.map((x, i) => x - initial.pages[i]),
    dryRunWrites: 0,
    businessWrites: 1,
    operationKey: preview.operationKey,
    payloadHash: preview.payloadHash,
    receipt: applied.receipt,
  });
  const bytes1 = Buffer.from(await (await peer("sample.csv")).arrayBuffer()),
    bytes2 = Buffer.from("\ufeffid,name\r\n1,第二版本\r\n");
  const makeFile = async (bytes, label) =>
    register({
      kind: "file_read",
      assetId: file,
      label,
      fileName: "exchange.csv",
      base64: bytes.toString("base64"),
    });
  const v1 = await makeFile(bytes1, "文件 A");
  const flow1 = await createFlow("固定 CSV A", file, v1.versionId);
  const v2 = await makeFile(bytes2, "文件 B");
  const flow2 = await createFlow("固定 CSV B", file, v2.versionId);
  assert.notEqual(v1.versionId, v2.versionId);
  assert.equal(v1.contentHash, digest(bytes1));
  assert.equal(v2.contentHash, digest(bytes2));
  const results = [];
  for (const flow of [flow1, flow2])
    results.push(
      (await run(flow)).nodeRuns.find(n => n.nodeId === "source").output
    );
  assert.deepEqual(results[0].rows, [
    { id: "1", name: "中文,\r\n第二行" },
    { id: "2", name: '他说"好"' },
  ]);
  assert.deepEqual(results[1].rows, [{ id: "1", name: "第二版本" }]);
  assert.equal(results[0].resourceVersion.contentHash, v1.contentHash);
  assert.equal(results[1].resourceVersion.contentHash, v2.contentHash);
  await rpc(
    "project.setServiceEndpointStatus",
    { projectId: project.id, id: ep.id, status: "disabled" },
    true
  );
  await assert.rejects(() =>
    rpc(
      "data.run",
      {
        projectId: project.id,
        workflowId: apiFlow,
        mode: "formal",
        idempotencyKey: randomBytes(16).toString("hex"),
      },
      true
    )
  );
  const legacy = await run(flow1);
  assert.equal(
    legacy.nodeRuns.find(n => n.nodeId === "sink").output.writeMode,
    "audit_only"
  );
  assert.deepEqual(
    await rpc("connector.writes", { projectId: project.id, runId: legacy.id }),
    []
  );
  Object.assign(report, {
    fileDigests: [v1.contentHash, v2.contentHash],
    fixedFileVersions: true,
    deactivatedEndpointRejected: true,
    auditOnlyPreserved: true,
  });
} finally {
  try {
    if (project) {
      const state = await rpc("project.lifecyclePreview", {
        projectId: project.id,
      });
      if (state.code !== code || Number(state.workflowCount) !== workflowCount)
        throw Error("夹具归属或流程数量变化，保留业务供核对。");
      await rpc(
        "project.changeStatus",
        {
          projectId: project.id,
          status: "archived",
          expectedVersion: Number(state.lifecycleVersion),
          expectedWorkflowCount: workflowCount,
        },
        true
      );
      report.archived = true;
    }
  } finally {
    await rpc("auth.logout", null, true);
    console.log(JSON.stringify(report));
  }
}
