/**
 * Run through the deployed app container so credentials stay in its environment.
 * The script prints only non-secret acceptance IDs and outcomes.
 */

const baseUrl = (
  process.env.ACCEPTANCE_BASE_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");

class TrpcRequestError extends Error {
  constructor(path, status, payload) {
    super(payload?.error?.json?.message ?? `tRPC request failed: ${path}`);
    this.name = "TrpcRequestError";
    this.path = path;
    this.status = status;
    this.code = payload?.error?.json?.data?.code ?? "UNKNOWN";
  }
}

class TrpcSession {
  cookie = "";

  async request(path, method, input = null) {
    // Fixture writes explicitly submit the revision just inspected; callers may supply an older revision to test conflicts.

    // Fixture maintenance supplies its inspected review baseline; explicit stale baselines are preserved.
    if (
      ["project.auditWorkflow", "project.resetWorkflowAudit"].includes(path) &&
      input?.workflowId &&
      input.expectedDefinitionVersion === undefined &&
      input.expectedAuditStatus === undefined
    ) {
      const current = await this.request("workflow.get", "GET", {
        id: input.workflowId,
      });
      input = {
        ...input,
        expectedDefinitionVersion: Number(current.definitionVersion),
        expectedAuditStatus: current.auditStatus,
      };
    }
    if (
      ["workflow.update", "workflow.publish", "workflow.unpublish"].includes(
        path
      ) &&
      input?.id &&
      input.expectedDefinitionVersion === undefined
    ) {
      const current = await this.request("workflow.get", "GET", {
        id: input.id,
      });
      input = {
        ...input,
        expectedDefinitionVersion: Number(current.definitionVersion),
      };
    }

    const envelope = JSON.stringify({ json: input });
    const url =
      method === "GET"
        ? `${baseUrl}/api/trpc/${path}?input=${encodeURIComponent(envelope)}`
        : `${baseUrl}/api/trpc/${path}`;
    const headers = { accept: "application/json" };
    if (this.cookie) headers.cookie = this.cookie;
    if (method === "POST") headers["content-type"] = "application/json";
    const response = await fetch(url, {
      method,
      headers,
      body: method === "POST" ? envelope : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    if (setCookies.length) this.cookie = setCookies[0].split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new TrpcRequestError(path, response.status, payload);
    return payload.result?.data?.json;
  }

  query(path, input = null) {
    return this.request(path, "GET", input);
  }

  mutate(path, input = null) {
    return this.request(path, "POST", input);
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function loginAdmin() {
  const session = new TrpcSession();
  const username = requiredEnv("FLOW_BOOTSTRAP_ADMIN_USERNAME");
  const user = await session.mutate("auth.login", {
    username,
    password: requiredEnv("FLOW_BOOTSTRAP_ADMIN_PASSWORD"),
  });
  assert(
    user?.username === username.toLowerCase(),
    "bootstrap admin login returned the wrong user"
  );
  const current = await session.query("auth.me");
  assert(
    current?.id === user.id && current?.role === "admin",
    "authenticated admin session was not retained"
  );
  return { session, user };
}

import { performance } from "node:perf_hooks";
// Creates isolated fixtures through public APIs and archives them after the test.
// Execute inside the app container; credentials remain in its environment.
// PERF_LEVELS=25,50,100 PERF_REPEATS=1 PERF_TYPES=state,control,data PERF_MIXED=false
const { session: admin } = await loginAdmin();
const stamp = Date.now().toString(36);
const levels = (process.env.PERF_LEVELS ?? "25,50,100").split(",").map(Number);
const repeats = Number(process.env.PERF_REPEATS ?? 1);
const types = (process.env.PERF_TYPES ?? "state,control,data").split(",");
const mixed = process.env.PERF_MIXED === "true";
assert(
  levels.length > 0 &&
    levels.every(n => Number.isInteger(n) && n >= 1 && n <= 200),
  "PERF_LEVELS must contain integers in 1..200"
);
assert(
  Number.isInteger(repeats) && repeats >= 1 && repeats <= 10,
  "PERF_REPEATS must be in 1..10"
);
assert(
  types.length > 0 &&
    new Set(types).size === types.length &&
    types.every(t => ["state", "control", "data"].includes(t)),
  "Invalid PERF_TYPES"
);
const project = await admin.mutate("project.create", {
  code: `PERF_${stamp}`,
  name: `三类流程并发验收 ${stamp}`,
  description: "受控负载测试，结束后归档",
});
const workflows = {};
const report = [];
const node = (id, type, config = {}) => ({
  id,
  type,
  name: id,
  position: { x: 0, y: 0 },
  config,
});
const definition = (nodes, settings = {}) => ({
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings,
  nodes,
  edges: nodes
    .slice(1)
    .map((n, i) => ({
      id: `e${i}`,
      sourceNodeId: nodes[i].id,
      targetNodeId: n.id,
      sourceHandle: nodes[i].type === "operate" ? "approved" : "default",
    })),
});
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const p = f =>
    Math.round(
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * f) - 1)] ?? 0
    );
  return {
    count: values.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    maxMs: p(1),
  };
};
async function batch(count, action) {
  const latencies = [],
    errors = [],
    started = performance.now();
  const results = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const at = performance.now();
      try {
        return await action(index);
      } catch (error) {
        errors.push(error.message);
        return null;
      } finally {
        latencies.push(performance.now() - at);
      }
    })
  );
  const elapsedMs = performance.now() - started;
  return {
    results,
    metrics: {
      ...summarize(latencies),
      elapsedMs: Math.round(elapsedMs),
      requestsPerSecond: Number(((count * 1000) / elapsedMs).toFixed(2)),
      errors: errors.length,
      errorExamples: [...new Set(errors)].slice(0, 3),
    },
  };
}
async function settle(type, ids, target) {
  const start = performance.now(),
    pending = new Set(ids),
    latencies = [];
  while (pending.size && performance.now() - start < 240000) {
    const rows =
      type === "data"
        ? await admin.query("data.runs", {
            projectId: project.id,
            workflowId: workflows[type],
            limit: 200,
            summaryOnly: true,
          })
        : await admin.query("workflow.runs", {
            workflowId: workflows[type],
            limit: 200,
            summaryOnly: true,
          });
    for (const row of rows) {
      if (!pending.has(row.id)) continue;
      if (row.status === "failed")
        throw new Error(`${type} run failed ${row.id}`);
      if (row.status === target) {
        pending.delete(row.id);
        latencies.push(performance.now() - start);
      }
    }
    if (pending.size) await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert(pending.size === 0, `${type} completion timeout ${pending.size}`);
  return summarize(latencies);
}
try {
  const asset = await admin.mutate("data.createAsset", {
    projectId: project.id,
    name: "200行订单压测数据",
    assetType: "dataset",
    schema: [
      { name: "id", type: "number" },
      { name: "status", type: "string" },
      { name: "amount", type: "number" },
    ],
    sample: Array.from({ length: 200 }, (_, id) => ({
      id,
      status: id % 2 ? "paid" : "open",
      amount: 100 + id,
    })),
  });
  const definitions = {
    state: definition(
      [
        node("start", "start"),
        node("draft", "state", {
          nodeDh: "DRAFT",
          stateCode: "DRAFT",
          displayName: "待办理",
          stateType: "business",
        }),
        node("approve", "operate", {
          nodeDh: "APPROVE",
          assigneeMode: "initiator",
          instruction: "确认测试记录",
          outcomeMode: "explicit",
          outcomes: [
            {
              code: "approved",
              label: "通过",
              decision: "approved",
              sourceHandle: "approved",
            },
          ],
          participantOperation: { scope: "actor", relation: "none" },
        }),
        node("done", "state", {
          nodeDh: "DONE",
          stateCode: "DONE",
          displayName: "已完成",
          stateType: "terminal",
        }),
        node("end", "end"),
      ],
      { stateModel: "participant-v1" }
    ),
    control: definition([
      node("start", "start"),
      ...Array.from({ length: 8 }, (_, i) =>
        node(`step${i}`, "transform", {
          mappings: { request: "{{input.request}}", value: i },
        })
      ),
      node("end", "end", { resultTemplate: "{{result}}" }),
    ]),
    data: definition([
      node("start", "start"),
      node("source", "source", { assetId: asset.id }),
      node("filter", "filter", { filterField: "status", filterValue: "paid" }),
      node("sink", "sink", { outputName: "paid_orders" }),
      node("end", "end"),
    ]),
  };
  for (const type of ["state", "control", "data"]) {
    const flow = await admin.mutate("project.createWorkflow", {
      projectId: project.id,
      processCode: `PERF_${type.toUpperCase()}`,
      name: `${type}并发验收`,
      flowType: type,
      creationSource: "manual",
      definition: definitions[type],
    });
    workflows[type] = flow.id;
    await admin.mutate("project.auditWorkflow", {
      projectId: project.id,
      workflowId: flow.id,
      auditStatus: "approved",
    });
    await admin.mutate("workflow.publish", { id: flow.id });
  }
  console.log(
    JSON.stringify({ event: "fixtures", projectId: project.id, workflows })
  );
  async function phase(type, concurrency, iteration) {
    const started = performance.now();
    const admission = await batch(concurrency, index =>
      type === "data"
        ? admin.mutate("data.run", {
            projectId: project.id,
            workflowId: workflows[type],
            mode: "formal",
            data: { request: index },
          })
        : admin.mutate("workflow.run", {
            workflowId: workflows[type],
            input: { request: index },
          })
    );
    const ids = admission.results.filter(Boolean).map(result => result.runId);
    const completion = await settle(
      type,
      ids,
      type === "state" ? "waiting" : "success"
    );
    const completeOffset = admission.metrics.elapsedMs;
    const completionFromBatchStart = Object.fromEntries(
      Object.entries(completion).map(([key, value]) => [
        key,
        key === "count" ? value : value + completeOffset,
      ])
    );
    let execution = null,
      finished = null;
    if (type === "state") {
      const tasks = await admin.query("task.list", {
        view: "todo",
        projectId: project.id,
        limit: 200,
      });
      const current = tasks.filter(
        task => ids.includes(task.runId) && task.nodeId === "approve"
      );
      assert(
        current.length === ids.length,
        "Expected one task per state instance"
      );
      execution = await batch(current.length, index =>
        admin.mutate("task.execute", {
          taskId: current[index].id,
          result: { decision: "approved", outcome: "approved" },
        })
      );
      finished = await settle(type, ids, "success");
    }
    const result = {
      type,
      concurrency,
      iteration,
      mixed,
      completionFromBatchStart,
      admission: admission.metrics,
      completionAfterAdmission: completion,
      execution: execution?.metrics,
      completionAfterExecution: finished,
      totalMs: Math.round(performance.now() - started),
    };
    report.push(result);
    console.log(JSON.stringify({ event: "phase", ...result }));
    assert(
      admission.metrics.errors === 0 &&
        (!execution || execution.metrics.errors === 0),
      "Request errors in performance test"
    );
    const sampleId = ids.at(-1);
    const detail =
      type === "data"
        ? await admin.query("data.runDetail", {
            projectId: project.id,
            runId: sampleId,
          })
        : await admin.query("workflow.runDetail", { runId: sampleId });
    assert(
      detail.status === "success",
      "Completed sample must remain successful"
    );
    if (type === "data")
      assert(
        detail.nodeRuns.some(
          node => node.nodeId === "sink" && Number(node.rowCount) === 100
        ),
        "Filtered data must contain 100 paid orders"
      );
    if (type === "control")
      assert(
        detail.nodeRuns.length === 10 &&
          detail.nodeRuns.every(node => node.status === "success"),
        "All 10 control nodes must complete"
      );
    if (type === "state")
      assert(
        detail.participantCards.length === 1 &&
          detail.participantCards[0].stateCode === "DONE",
        "Participant card must be DONE"
      );
    console.log(
      JSON.stringify({ event: "sampleVerified", type, concurrency, iteration })
    );
  }
  for (let iteration = 1; iteration <= repeats; iteration++)
    for (const concurrency of levels) {
      if (mixed)
        await Promise.all(
          types.map(type => phase(type, concurrency, iteration))
        );
      else for (const type of types) await phase(type, concurrency, iteration);
    }
  console.log(
    JSON.stringify({ event: "complete", projectId: project.id, report })
  );
} finally {
  const preview = await admin.query("project.lifecyclePreview", {
    projectId: project.id,
  });
  await admin.mutate("project.changeStatus", {
    projectId: project.id,
    status: "archived",
    expectedVersion: Number(preview.lifecycleVersion),
    expectedWorkflowCount: Number(preview.workflowCount),
  });
  console.log(JSON.stringify({ event: "cleanup", projectArchived: true }));
}
