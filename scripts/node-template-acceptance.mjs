import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
// Exercise only the specified deployment; remove only templates created here.
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
const types = [
  "transform",
  "condition",
  "http",
  "llm",
  "state",
  "operate",
  "router",
  "rest",
  "method",
  "form",
  "wait",
  "message_catch",
  "milestone",
  "sql",
  "source",
  "table",
  "filter",
  "map",
  "project",
  "derive",
  "join",
  "union",
  "aggregate",
  "sort",
  "deduplicate",
  "quality_gate",
  "udf",
  "sink",
  "output",
  "edit_sql",
];
const tag = randomBytes(4).toString("hex");
const created = new Set();
try {
  for (const type of types) {
    const config = {
      marker: `template-${tag}-${type}`,
      nested: { enabled: true, ids: ["00123", 0], empty: null },
      messageName: "order.paid",
      correlationKey: "{{input.businessKey}}",
    };
    const { id } = await request(
      "workflow.createTemplate",
      { name: `模板契约_${tag}_${type}`, nodeType: type, config },
      true
    );
    created.add(id);
    let row = (await request("workflow.templates")).find(
      item => item.id === id
    );
    assert(row, `${type} missing from template list`);
    assert.equal(row.nodeType, type);
    assert.deepEqual(row.config, config, `${type} config changed`);
    await request(
      "workflow.updateTemplate",
      { id, name: `模板契约_${tag}_${type}_改名` },
      true
    );
    row = (await request("workflow.templates")).find(item => item.id === id);
    assert.equal(row.name, `模板契约_${tag}_${type}_改名`);
    assert.deepEqual(row.config, config, `${type} rename lost config`);
    await request("workflow.deleteTemplate", { id }, true);
    created.delete(id);
  }
  for (const nodeType of ["start", "end", "subflow", "unknown"]) {
    await assert.rejects(
      request(
        "workflow.createTemplate",
        { name: `模板契约_${tag}_拒绝`, nodeType, config: {} },
        true
      )
    );
  }
  console.log(
    JSON.stringify({
      stage: "node-template-contract",
      typesVerified: types.length,
      saveRenameConfigRetention: true,
      forbiddenTypesRejected: true,
      ownTemplatesRemoved: true,
    })
  );
} finally {
  for (const id of created)
    await request("workflow.deleteTemplate", { id }, true);
}
