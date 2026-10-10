// Public-service regression in isolated projects; no direct SQL, secrets, or existing task changes.
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
const first = await admin.request("workflow.page", { limit: 10 });
const second = await admin.request("workflow.page", { limit: 10, cursor: first.nextCursor });
assert.equal(first.items.length, 10);
assert.equal(second.items.length, 10);
assert(!second.items.some(flow => first.items.some(other => other.id === flow.id)));
const later = await admin.request("workflow.page", { limit: 10, cursor: 200 });
const oldFlowId = "xrFBy3J2N3b4DncJ";
const old = await admin.request("workflow.page", { search: oldFlowId, limit: 10 });
assert(old.items.some(flow => flow.id === oldFlowId));
const member = new Session();
let userId;
let grantedFlow;
try {
  const memberPassword = `Test9_${randomBytes(24).toString("base64url")}`;
  const created = await admin.request("iam.createUser", { username: `page_live_${tag}`, name: `流程分页隔离_${tag}`, password: memberPassword, role: "user" }, true);
  userId = created.userId;
  await member.request("auth.login", { username: `page_live_${tag}`, password: memberPassword }, true);
  const project = await admin.request("project.create", { code: `PAGE_${tag}`, name: `分页验证_${tag}` }, true);
  const flows = [];
  for (const suffix of ["A", "B"]) flows.push(await admin.request("project.createWorkflow", { projectId: project.id, processCode: `PAGE_${tag.toUpperCase()}_${suffix}`, name: `分页字面_${tag}_${suffix}`, flowType: "control" }, true));
  const codeSearch = await admin.request("workflow.page", { search: `PAGE_${tag.toUpperCase()}_A` });
  assert.deepEqual(codeSearch.items.map(flow => flow.id), [flows[0].id]);
  const projectPage = await admin.request("workflow.page", { projectId: project.id, limit: 1 });
  const projectNext = await admin.request("workflow.page", { projectId: project.id, limit: 1, cursor: projectPage.nextCursor });
  assert.equal(projectPage.items.length, 1);
  assert.equal(projectNext.items.length, 1);
  assert.notEqual(projectPage.items[0].id, projectNext.items[0].id);
  assert.equal(projectNext.hasMore, false);
  assert.equal((await member.request("workflow.page", { projectId: project.id })).items.length, 0);
  await admin.request("workflow.grantMember", { workflowId: flows[0].id, userId, role: "viewer" }, true);
  grantedFlow = flows[0].id;
  const allowed = await member.request("workflow.page", { projectId: project.id });
  assert.deepEqual(allowed.items.map(flow => flow.id), [flows[0].id]);
  assert.equal((await member.request("workflow.page", { search: `分页字面_${tag}_B` })).items.length, 0);
  assert.equal((await member.request("workflow.page", { search: `PAGE_${tag.toUpperCase()}_B` })).items.length, 0);
  assert.deepEqual((await member.request("workflow.page", { search: `PAGE_${tag.toUpperCase()}_A` })).items.map(flow => flow.id), [flows[0].id]);
  const literal = await admin.request("workflow.page", { search: `分页字面_${tag}_A` });
  assert.deepEqual(literal.items.map(flow => flow.id), [flows[0].id]);
  console.log(JSON.stringify({ firstPageCount: 10, secondPageCount: 10, noOverlap: true, recordsBeyond200: later.items.length, oldFlowSearchVerified: true, projectPagingVerified: true, literalSearchVerified: true, businessCodeSearchVerified: true, resourceScopeVerified: true, browserPagingVerified: false }));
} finally {
  if (grantedFlow) await admin.request("workflow.revokeMember", { workflowId: grantedFlow, userId, role: "viewer" }, true);
  if (userId) await admin.request("iam.updateUserStatus", { userId, status: "disabled" }, true);
  console.log(JSON.stringify({ ownGrantRevoked: true, ownAccountDisabled: true }));
}
