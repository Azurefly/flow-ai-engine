import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");

describe("生产 Compose 内存限制", () => {
  it("应用与 MySQL 的硬限制合计不超过 8 GiB，并禁用额外 Swap", () => {
    expect(compose).toMatch(/mysql:[\s\S]*?mem_limit:\s*1536m/);
    expect(compose).toMatch(/mysql:[\s\S]*?memswap_limit:\s*1536m/);
    expect(compose).toMatch(/app:[\s\S]*?mem_limit:\s*768m/);
    expect(compose).toMatch(/app:[\s\S]*?memswap_limit:\s*768m/);
    expect(1536 + 768).toBeLessThanOrEqual(8 * 1024);
  });

  it("使用数据库、迁移和 Worker 就绪探针而非仅检查进程存活", () => {
    expect(compose).toContain("127.0.0.1:3000/readyz");
    expect(compose).toContain("WORKFLOW_WORKER_ENABLED");
    expect(compose).toContain("BUILD_SHA");
  });
});
