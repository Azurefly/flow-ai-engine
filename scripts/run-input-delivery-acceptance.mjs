import superjson from "superjson";
// Isolated public-service regression; no direct SQL, secrets, or existing account changes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const json = JSON.stringify(superjson.serialize(input ?? null));
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
    return superjson.deserialize(payload.result.data);
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

const workflowId = process.env.FLOW_UI_WORKFLOW_ID;
const runPrefix = process.env.FLOW_UI_RUN_PREFIX;
assert(
  workflowId && runPrefix,
  "Provide the workflow ID and run prefix observed in the browser"
);
assert.match(runPrefix, /^[a-f0-9]{8}$/);
const workflow = await admin.request("workflow.get", { id: workflowId });
assert.match(workflow.name, /^消息业务编号_[a-f0-9]{8}$/);
const definition =
  typeof workflow.definition === "string"
    ? JSON.parse(workflow.definition)
    : workflow.definition;
assert.deepEqual(definition.nodes.map(n => n.type).sort(), [
  "end",
  "message_catch",
  "start",
]);
const matches = (
  await admin.request("workflow.runs", { workflowId, limit: 10 })
).filter(run => run.id.startsWith(runPrefix));
assert.equal(
  matches.length,
  1,
  "Verify the exact browser-created run; do not create a replacement"
);
const runId = matches[0].id;
let completed = false;
try {
  const read = () => admin.request("workflow.runDetail", { runId });
  let run = await waitFor(
    read,
    value => value.status === "waiting",
    "browser-created wait"
  );
  const input =
    typeof run.inputJson === "string"
      ? JSON.parse(run.inputJson)
      : run.inputJson;
  assert.deepEqual(input, {
    businessKey: "00123",
    amount: 10,
    config: { enabled: true },
  });
  await admin.request(
    "task.signalMessage",
    {
      runId,
      messageName: "order.paid",
      correlationKey: "00123",
      payload: { accepted: true },
    },
    true
  );
  run = await waitFor(
    read,
    value => ["success", "failed"].includes(value.status),
    "browser-created completion"
  );
  assert.equal(run.status, "success");
  assert.equal(
    run.nodeRuns.filter(n => n.nodeId === "end" && n.status === "success")
      .length,
    1
  );
  completed = true;
  console.log(
    JSON.stringify({
      workflowId,
      runId,
      browserCreated: true,
      textLeadingZerosPreserved: true,
      numericTypePreserved: true,
      jsonTypePreserved: true,
      status: "success",
    })
  );
} finally {
  if (!completed)
    await admin.request("workflow.cancelRun", { runId }, true).catch(() => {});
}
