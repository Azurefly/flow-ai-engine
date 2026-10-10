import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
// Exercise only the specified deployment and isolated fixtures created here.
const base = "http://124.223.198.84:1180";
let cookie = "";
async function request(path, input, mutation = false) {
  const json = JSON.stringify(superjson.serialize(input ?? null));
  const response = await fetch(
    `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
    {
      method: mutation ? "POST" : "GET",
      headers: { "content-type": "application/json", cookie },
      ...(mutation ? { body: json } : {}),
    }
  );
  const next = response.headers.getSetCookie()[0];
  if (next) cookie = next.split(";", 1)[0];
  const body = await response.json();
  if (!response.ok || body.error)
    throw new Error(body.error?.json?.message ?? `HTTP ${response.status}`);
  return superjson.deserialize(body.result.data);
}
const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
assert(
  username && password,
  "Bootstrap credentials must be supplied by server environment"
);
await request("auth.login", { username, password }, true);
const tag = randomBytes(4).toString("hex");
const project = await request("project.create", { code: `EDGE_DIAG_${tag}`, name: `连线定位隔离_${tag}` }, true);
const nodes = [
  { id: "start", type: "start", name: "开始", config: {}, position: { x: 0, y: 0 } },
  { id: "a", type: "transform", name: "步骤甲", config: { mappings: { value: "A" } }, position: { x: 240, y: 0 } },
  { id: "b", type: "transform", name: "步骤乙", config: { mappings: { value: "B" } }, position: { x: 480, y: 0 } },
  { id: "end", type: "end", name: "结束", config: {}, position: { x: 720, y: 0 } },
];
const edges = [
  { id: "start-a", sourceNodeId: "start", targetNodeId: "a" },
  { id: "a-b", sourceNodeId: "a", targetNodeId: "b" },
  { id: "b-a-loop", sourceNodeId: "b", targetNodeId: "a", loop: { maxIterations: 2 } },
  { id: "b-end", sourceNodeId: "b", targetNodeId: "end" },
];
const flow = await request("project.createWorkflow", { projectId: project.id, name: `连线诊断定位_${tag}`, flowType: "control", definition: { schemaVersion: 1, settings: {}, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges } }, true);
const result = await request("workflow.compile", { id: flow.id }, true);
assert.equal(result.ok, false);
const issue = result.diagnostics.find(item => item.code === "WF_RUNTIME_LOOP_UNSUPPORTED");
assert(issue);
assert.equal(issue.location.kind, "edge");
assert.equal(issue.location.edgeId, "b-a-loop");
console.log(JSON.stringify({ workflowId: flow.id, edgeId: issue.location.edgeId, serverDiagnosticVerified: true, browserFocusVerified: false, editorUrl: `${base}/#/flows/workflow/${flow.id}/editor` }));