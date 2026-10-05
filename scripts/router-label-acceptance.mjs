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
  { code: `ROUTE_${tag}`.toUpperCase(), name: `原版路由回显_${tag}` },
  true
);
const workflow = await admin.request(
  "project.createWorkflow",
  {
    projectId: project.id,
    name: `原版规则名称_${tag}`,
    flowType: "control",
    definition: {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: [
        {
          id: "start",
          type: "start",
          name: "开始",
          config: { initialVariables: {} },
          position: { x: 0, y: 0 },
        },
        {
          id: "router",
          type: "router",
          name: "结果分流",
          config: {
            routes: [],
            defaultRoute: "end",
            lysz: [
              {
                route: {
                  routerRuleName: "默认处理路径",
                  routerRulePriority: -1,
                  routerTargetId: "end",
                },
              },
            ],
          },
          position: { x: 250, y: 0 },
        },
        {
          id: "end",
          type: "end",
          name: "完成",
          config: { resultTemplate: "{{vars}}" },
          position: { x: 500, y: 0 },
        },
      ],
      edges: [
        {
          id: "start-router",
          sourceNodeId: "start",
          targetNodeId: "router",
          sourceHandle: "default",
        },
        {
          id: "router-end",
          sourceNodeId: "router",
          targetNodeId: "end",
          sourceHandle: "end",
        },
      ],
    },
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
  "workflow.run",
  { workflowId: workflow.id, input: {}, idempotencyKey: `route-${tag}` },
  true
);
const run = await waitFor(
  () => admin.request("workflow.runDetail", { runId: started.runId }),
  value => ["success", "failed"].includes(value.status),
  "legacy route"
);
assert.equal(run.status, "success");
console.log(
  JSON.stringify({
    projectId: project.id,
    workflowId: workflow.id,
    runId: started.runId,
    status: run.status,
  })
);
