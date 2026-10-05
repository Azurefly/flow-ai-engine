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
try {
  for (const suffix of ["A", "B"])
    units.push(
      await admin.request(
        "config.createOrganizationUnit",
        {
          code: `CYCLE_${tag}_${suffix}`.toUpperCase(),
          name: `并发层级测试_${tag}_${suffix}`,
        },
        true
      )
    );
  const results = await Promise.allSettled(
    units.map((unit, i) =>
      admin.request(
        "config.updateOrganizationUnit",
        { id: unit.id, parentUnitId: units[1 - i].id },
        true
      )
    )
  );
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      r => r.status === "rejected" && r.reason.message.includes("不能形成循环")
    ).length,
    1
  );
  const tree = await admin.request("config.organization", {});
  const nodes = units.map(u => tree.units.find(v => v.id === u.id));
  assert(nodes.every(Boolean));
  assert(nodes.some(u => u.parentUnitId === null));
  console.log(
    JSON.stringify({
      mutualParentRequests: 2,
      succeeded: 1,
      cycleRejected: 1,
      noCycle: true,
    })
  );
} finally {
  for (const unit of units)
    await admin.request(
      "config.updateOrganizationUnit",
      { id: unit.id, parentUnitId: null, status: "disabled" },
      true
    );
}
