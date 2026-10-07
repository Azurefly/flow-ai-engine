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
const units = [];
let userId;
try {
  const created = await admin.request(
    "iam.createUser",
    {
      username: `primary_${tag}`,
      name: `主部门并发测试_${tag}`,
      password: `Test9_${randomBytes(24).toString("base64url")}`,
      role: "user",
    },
    true
  );
  userId = created.userId;
  for (const suffix of ["A", "B"]) {
    const unit = await admin.request(
      "config.createOrganizationUnit",
      {
        code: `PRIMARY_${tag}_${suffix}`.toUpperCase(),
        name: `主部门并发_${tag}_${suffix}`,
      },
      true
    );
    units.push(unit);
    await admin.request(
      "config.assignOrganizationMember",
      { unitId: unit.id, userId, isPrimary: false },
      true
    );
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const results = await Promise.allSettled(
      units.map(unit =>
        admin.request(
          "config.setPrimaryOrganizationMembership",
          { unitId: unit.id, userId },
          true
        )
      )
    );
    assert.equal(
      results.filter(r => r.status === "fulfilled").length,
      2,
      JSON.stringify(
        results.filter(r => r.status === "rejected").map(r => r.reason.message)
      )
    );
    const tree = await admin.request("config.organization", {});
    const own = tree.members.filter(m => Number(m.userId) === userId);
    assert.equal(own.length, 2);
    assert.equal(
      own.filter(m => m.isPrimary).length,
      1,
      "Concurrent primary changes must leave exactly one primary membership"
    );
  }
  console.log(
    JSON.stringify({
      userId,
      units: units.map(u => u.id),
      concurrentRounds: 5,
      requestsSucceeded: 10,
      primaryCount: 1,
    })
  );
} finally {
  if (userId) {
    const tree = await admin.request("config.organization", {});
    for (const member of tree.members.filter(
      m => Number(m.userId) === userId && units.some(u => u.id === m.unitId)
    ))
      await admin.request(
        "config.removeOrganizationMember",
        { unitId: member.unitId, userId },
        true
      );
    await admin.request(
      "iam.updateUserStatus",
      { userId, status: "disabled" },
      true
    );
  }
  for (const unit of units)
    await admin.request(
      "config.updateOrganizationUnit",
      { id: unit.id, status: "disabled" },
      true
    );
  console.log(
    JSON.stringify({
      cleanup:
        "own memberships removed; own test account and departments disabled",
    })
  );
}
