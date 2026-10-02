import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync(
  new URL("../compose.yaml", import.meta.url),
  "utf8"
);
const deployScript = readFileSync(
  new URL("../scripts/deploy-app.sh", import.meta.url),
  "utf8"
);
const gitIgnore = readFileSync(
  new URL("../.gitignore", import.meta.url),
  "utf8"
);
const dockerIgnore = readFileSync(
  new URL("../.dockerignore", import.meta.url),
  "utf8"
);
const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8"
);
const envTemplate = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8"
);
const credentialAcceptanceScripts = [
  "../scripts/deep-canvas-testing.mjs",
  "../scripts/three-comprehensive-canvases-test.mjs",
  "../scripts/verify-all-buttons-three-rounds.mjs",
  "../scripts/run-remote-ui-verification.cjs",
].map(path => readFileSync(new URL(path, import.meta.url), "utf8"));

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
    expect(compose).toContain("BUILD_ID");
    expect(compose).toContain("IMAGE_ID");
  });

  it("将凭据安全的真实验收脚本打入运行镜像", () => {
    expect(dockerfile).toContain(
      "COPY --from=build /app/scripts/remote-deployment-acceptance.mjs ./scripts/remote-deployment-acceptance.mjs"
    );
    expect(dockerfile).toContain("USER node");
  });

  it("将运行时 SecretRef 以只读文件目录挂载且不输出密钥值", () => {
    expect(compose).toContain('user: "1000:1000"');
    expect(compose).toContain("FLOW_SECRET_FILE_DIR: /run/flow-secrets");
    expect(compose).toContain(
      "source: ${FLOW_SECRET_DIR:-/opt/flow-ai-engine/secrets}"
    );
    expect(compose).toContain("target: /run/flow-secrets");
    expect(compose).toContain("read_only: true");
    expect(deployScript).toContain(
      'SECRET_DIR="${FLOW_SECRET_DIR:-/opt/flow-ai-engine/secrets}"'
    );
    expect(deployScript).toContain("install -d -o root -g 1000 -m 0750");
    expect(deployScript).toContain('chown root:1000 -- "$secret_path"');
    expect(deployScript).toContain('chmod 0440 -- "$secret_path"');
    expect(deployScript).toContain('test ! -L "$secret_path"');
    expect(deployScript).toContain("FLOW_SECRET_[A-Z0-9_]{2,128}");
    expect(deployScript).not.toContain('cat "$secret_path"');
    expect(deployScript).toContain("test -L");
    expect(deployScript).toContain("-name '.env.*' ! -name .env.example");
    expect(gitIgnore).toContain(".env.*");
    expect(gitIgnore).toContain("!.env.example");
    expect(dockerIgnore).toContain(".env.*");
    expect(dockerIgnore).toContain("!.env.example");
  });
});

describe("生产运行时凭据隔离", () => {
  it("要求独立 JWT 密钥，并禁止验收脚本内嵌管理员密码默认值", () => {
    expect(compose).toContain(
      "JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}"
    );
    expect(compose).not.toContain(
      "JWT_SECRET: ${JWT_SECRET:-${FLOW_BOOTSTRAP_ADMIN_PASSWORD}}"
    );
    expect(envTemplate).toMatch(/^JWT_SECRET=\r?$/m);
    expect(credentialAcceptanceScripts).toHaveLength(4);
    for (const script of credentialAcceptanceScripts) {
      expect(script).toContain("FLOW_BOOTSTRAP_ADMIN_PASSWORD");
      expect(script).toContain(
        'throw new Error("FLOW_BOOTSTRAP_ADMIN_PASSWORD is required for this test")'
      );
      expect(script).not.toMatch(
        /FLOW_BOOTSTRAP_ADMIN_PASSWORD\s*(?:\?\?|\|\|)/
      );
    }
  });
});
