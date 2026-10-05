// Public-service regression only; no database writes, token printing, or production task changes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const json = JSON.stringify({ json: input ?? null });
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body: json } : {}),
      }
    );
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.cookie = cookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        `${path}: ${payload.error?.json?.message ?? response.status}`
      );
    return payload.result.data.json;
  }
}
async function waitFor(read, accept, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out: ${label}`);
}
const admin = new Session();
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(username && password, "Missing existing login configuration");
await admin.request("auth.login", { username, password }, true);
const tag = randomBytes(4).toString("hex");
const project = await admin.request(
  "project.create",
  { code: `FUNCTION_${tag}`, name: `内置函数测试_${tag}` },
  true
);
const source = await admin.request(
  "data.createSource",
  {
    projectId: project.id,
    name: "内联函数测试源",
    sourceType: "inline",
    connection: {},
  },
  true
);
const rows = [
  { text: " Alice ", phone: "13812345678", keep: 0 },
  { text: null, phone: null, keep: false },
];
const asset = await admin.request(
  "data.createAsset",
  {
    projectId: project.id,
    sourceId: source.id,
    name: "转换样本",
    assetType: "dataset",
    schema: [
      { name: "text", type: "string" },
      { name: "phone", type: "string" },
    ],
    sample: rows,
  },
  true
);
const functions = [];
for (const name of ["trim", "lower", "upper", "mask-phone", "metadata-only"]) {
  const udf = await admin.request(
    "data.createUdf",
    {
      projectId: project.id,
      name: `${name}_${tag}`,
      udfType: "javascript",
      ...(name !== "metadata-only" ? { artifactRef: `builtin:${name}` } : {}),
    },
    true
  );
  await admin.request(
    "data.updateUdf",
    { projectId: project.id, udfId: udf.id, status: "approved" },
    true
  );
  functions.push(udf.id);
}
const choices = await admin.request("data.resourceOptions", {
  projectId: project.id,
});
assert.equal(choices.udfs.length, 5);
assert.deepEqual(choices.assets.find(item => item.value === asset.id)?.fields, [
  "text",
  "phone",
]);
for (const [index, id] of functions.entries()) {
  const option = choices.udfs.find(item => item.value === id);
  assert(option);
  assert.equal(option.disabled, index === 4);
  assert.match(
    option.label,
    index === 4 ? /尚不可执行/ : /去除首尾空格|转为小写|转为大写|手机号脱敏/
  );
}
for (const metadataOnly of [false, true]) {
  const transforms = metadataOnly
    ? [
        [
          "metadata",
          "udf",
          { udfId: functions[4], inputField: "text", outputField: "result" },
        ],
      ]
    : [
        [
          "trim",
          "udf",
          { udfId: functions[0], inputField: "text", outputField: "trimmed" },
        ],
        [
          "lower",
          "udf",
          {
            udfId: functions[1],
            inputField: "trimmed",
            outputField: "lowered",
          },
        ],
        [
          "upper",
          "udf",
          {
            udfId: functions[2],
            inputField: "lowered",
            outputField: "uppered",
          },
        ],
        [
          "mask",
          "udf",
          { udfId: functions[3], inputField: "phone", outputField: "masked" },
        ],
      ];
  const specs = [
    ["start", "start", {}],
    ["source", "source", { assetId: asset.id, limit: 100 }],
    ...transforms,
    ["end", "end", {}],
  ];
  const definition = {
    schemaVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    nodes: specs.map(([id, type, config], index) => ({
      id,
      type,
      name: id,
      config,
      position: { x: index * 200, y: 0 },
    })),
    edges: specs.slice(1).map(([id], index) => ({
      id: `edge-${index}`,
      sourceNodeId: specs[index][0],
      targetNodeId: id,
    })),
  };
  const workflow = await admin.request(
    "project.createWorkflow",
    {
      projectId: project.id,
      name: `函数_${metadataOnly ? "未实现" : "四种转换"}_${tag}`,
      flowType: "data",
      definition,
    },
    true
  );
  await admin.request(
    "project.auditWorkflow",
    { projectId: project.id, workflowId: workflow.id, auditStatus: "approved" },
    true
  );
  await admin.request("workflow.publish", { id: workflow.id }, true);
  const started = await admin.request(
    "data.run",
    { projectId: project.id, workflowId: workflow.id },
    true
  );
  const run = await waitFor(
    () =>
      admin.request("data.runDetail", {
        projectId: project.id,
        runId: started.runId,
      }),
    r => ["success", "failed"].includes(r.status),
    "function run finished"
  );
  assert.equal(run.status, metadataOnly ? "failed" : "success");
  if (metadataOnly) assert.match(JSON.stringify(run), /尚无可执行实现/);
  else
    assert.deepEqual(run.output.terminals[0].rows, [
      {
        ...rows[0],
        trimmed: "Alice",
        lowered: "alice",
        uppered: "ALICE",
        masked: "138****5678",
      },
      { ...rows[1], trimmed: null, lowered: null, uppered: null, masked: null },
    ]);
  console.log(
    JSON.stringify({
      projectId: project.id,
      workflowId: workflow.id,
      runId: run.id,
      status: run.status,
      metadataOnly,
    })
  );
}
