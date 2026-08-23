import { performance } from "node:perf_hooks";

const baseUrl = (process.env.PERF_BASE_URL || "http://app:3000").replace(/\/$/, "");
const levels = (process.env.CONCURRENCY_LEVELS || "10,25,50")
  .split(",")
  .map(Number)
  .filter(value => Number.isInteger(value) && value > 0 && value <= 200);
const requestsPerLevel = Math.max(20, Math.min(2000, Number(process.env.REQUESTS_PER_LEVEL || 200)));

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function runLoad(name, request, concurrency) {
  let cursor = 0;
  const latencies = [];
  const failures = [];
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= requestsPerLevel) return;
      const requestStartedAt = performance.now();
      try {
        const response = await request();
        if (!response.ok) failures.push(response.status);
      } catch {
        failures.push("network");
      } finally {
        latencies.push(performance.now() - requestStartedAt);
      }
    }
  }));
  const durationMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    name,
    concurrency,
    requests: requestsPerLevel,
    success: requestsPerLevel - failures.length,
    errors: failures.length,
    requestsPerSecond: Number((requestsPerLevel / (durationMs / 1000)).toFixed(2)),
    latencyMs: {
      average: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      p99: Number(percentile(latencies, 0.99).toFixed(2)),
      maximum: Number((latencies.at(-1) || 0).toFixed(2)),
    },
    failureStatuses: [...new Set(failures)],
  };
}

async function login() {
  const username = process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("并发业务查询需要容器内已配置的引导管理员凭据。");
  const response = await fetch(`${baseUrl}/api/trpc/auth.login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { username, password } }),
  });
  if (!response.ok) throw new Error(`并发测试登录失败：HTTP ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("并发测试登录未返回会话 Cookie。");
  return cookie;
}

const cookie = await login();
const businessUrl = `${baseUrl}/api/trpc/project.list?input=${encodeURIComponent(JSON.stringify({ json: null }))}`;
const results = [];
for (const concurrency of levels) {
  results.push(await runLoad("healthz", () => fetch(`${baseUrl}/healthz`), concurrency));
  results.push(await runLoad("project.list", () => fetch(businessUrl, { headers: { cookie } }), concurrency));
}
console.log(JSON.stringify({ baseUrl, requestsPerLevel, results }, null, 2));
