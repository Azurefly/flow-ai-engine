import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import target from "./acceptance-target.cjs";

const { base, username, password } = target.acceptanceLogin(process.env);
const count = Number(process.env.FLOW_ASSISTANT_ACCEPTANCE_SESSIONS ?? "2");
assert(
  Number.isInteger(count) && count >= 1 && count <= 6,
  "Use one to six synthetic model requests per run"
);
let cookie = "";
async function rpc(path, input, write = false) {
  const body = JSON.stringify({ json: input ?? null });
  const url =
    base +
    "/api/trpc/" +
    path +
    (write ? "" : "?input=" + encodeURIComponent(body));
  const response = await fetch(url, {
    method: write ? "POST" : "GET",
    redirect: "error",
    headers: { "content-type": "application/json", cookie },
    body: write ? body : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (path === "auth.login")
    cookie = (response.headers.getSetCookie()[0] ?? "").split(";")[0];
  const value = await response.json();
  if (!response.ok || value.error)
    throw new Error(
      path +
        " HTTP " +
        response.status +
        " " +
        (value.error?.json?.data?.code ?? "")
    );
  return value.result.data.json;
}
const marker =
  "G04" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
const samples = [];
try {
  await rpc("auth.login", { username, password }, true);
  assert(cookie);
  const agents = await rpc("assistant.available", {});
  const agent = process.env.FLOW_ASSISTANT_ACCEPTANCE_AGENT ?? agents[0]?.id;
  assert(
    agents.some(entry => entry.id === agent),
    "No published assistant available in the acceptance scope"
  );
  const operations = await Promise.allSettled(
    Array.from({ length: count }, async (_, index) => {
      const sessionId = randomUUID(),
        requestId = randomUUID(),
        expected = marker + index;
      const started = await rpc(
        "assistant.start",
        { sessionId, agentId: agent, context: {} },
        true
      );
      const payload = {
        sessionId,
        revision: started.revision,
        requestId,
        payload: {
          kind: "message",
          text:
            "请只原样输出此合成验收码 " +
            expected +
            " 。无需调用工具或办理业务。",
        },
      };
      const startTime = performance.now();
      const job = await rpc("assistant.enqueue", payload, true);
      const enqueueMs = Math.round(performance.now() - startTime);
      assert.equal(job.baseRevision, 0);
      const replay = await rpc("assistant.enqueue", payload, true);
      assert.equal(replay.id, job.id);
      const deadline = Date.now() + 175000;
      const seen = new Set();
      let last;
      do {
        last = await rpc("assistant.job", { sessionId, requestId });
        seen.add(last.status);
        if (!["queued", "running"].includes(last.status)) break;
        await new Promise(resolve => setTimeout(resolve, 700));
      } while (Date.now() < deadline);
      assert.equal(
        last.status,
        "completed",
        job.id + " " + last.status + " " + String(last.failureCode)
      );
      const session = await rpc("assistant.get", {
        sessionId,
        requestId,
        pageSize: 8,
      });
      assert.equal(session.requestCommitted, true);
      assert.equal(session.revision, 1);
      assert.equal(session.messages.filter(m => m.role === "user").length, 1);
      assert(
        session.messages.at(-1)?.content?.includes(expected),
        "Returned message did not include the synthetic acceptance code"
      );
      assert(
        session.modelReceipts?.some(r => r.model || r.completionId),
        "Model provider supplied no traceable response identifier"
      );
      assert.equal(last.actionKey, null);
      samples.push({
        sessionId,
        requestId,
        jobId: job.id,
        enqueueMs,
        elapsedMs: Math.round(performance.now() - startTime),
        attempts: last.attempts,
        states: Array.from(seen),
        revision: session.revision,
        modelReceipts: session.modelReceipts,
      });
    })
  );
  for (const item of operations)
    if (item.status === "rejected") throw item.reason;
  const sorted = samples.map(r => r.elapsedMs).sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      target: base,
      syntheticSessions: samples,
      failures: 0,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
      retention:
        "Synthetic read-only conversations remain in the authenticated user's history.",
    })
  );
} finally {
  if (cookie) await rpc("auth.logout", null, true);
}
