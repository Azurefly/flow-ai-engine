import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATABASE_MIGRATION_EPOCH,
  DATABASE_MIGRATION_VERSION,
  DATABASE_REQUIRED_COLUMN_COUNT,
  getPublicReadiness,
  getPublicVersion,
  getRuntimeInfo,
} from "./runtime-info";

const serverSource = readFileSync(
  new URL("./_core/index.ts", import.meta.url),
  "utf8"
);
const healthRoutesSource = readFileSync(
  new URL("./health-routes.ts", import.meta.url),
  "utf8"
);
const runtimeSource = readFileSync(
  new URL("./runtime-info.ts", import.meta.url),
  "utf8"
);
const migrationJournal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8"
  )
) as { entries: Array<{ tag: string; when: number }> };
const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };
const routerSource = readFileSync(
  new URL("./routers.ts", import.meta.url),
  "utf8"
);
const deployScript = readFileSync(
  new URL("../scripts/deploy-app.sh", import.meta.url),
  "utf8"
);
const remoteAcceptanceScript = readFileSync(
  new URL("../scripts/remote-deployment-acceptance.mjs", import.meta.url),
  "utf8"
);

describe("runtime identity and readiness contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes stable build, migration, worker and capability fields without secrets", () => {
    const info = getRuntimeInfo();
    expect(info).toHaveProperty("buildId");
    expect(info).toHaveProperty("buildTime");
    expect(info).toHaveProperty("imageId");
    expect(info.migrationVersion).toBe(DATABASE_MIGRATION_VERSION);
    expect(DATABASE_MIGRATION_VERSION).toBe("0035_custom_role_audit_actions");
    expect(DATABASE_MIGRATION_EPOCH).toBe(1791558159175);
    expect(DATABASE_REQUIRED_COLUMN_COUNT).toBe(41);
    expect(migrationJournal.entries.at(-1)).toMatchObject({
      tag: DATABASE_MIGRATION_VERSION,
      when: DATABASE_MIGRATION_EPOCH,
    });
    expect(runtimeSource).toContain("flow_project_unit");
    expect(runtimeSource).toContain("utf8mb4_0900_ai_ci");
    expect(info.worker).toHaveProperty("started");
    expect(info.capabilities.map(item => item.id)).toEqual([
      "state-control-workflow",
      "human-approval",
      "llm-node",
      "dataflow",
    ]);
    expect(JSON.stringify(info)).not.toContain(
      process.env.OPENAI_API_KEY || "never-match-empty-secret"
    );
  });

  it("distinguishes isolated MySQL acceptance from production verification", () => {
    const info = getRuntimeInfo();
    const stateControl = info.capabilities.find(
      capability => capability.id === "state-control-workflow"
    );
    const humanApproval = info.capabilities.find(
      capability => capability.id === "human-approval"
    );

    expect(humanApproval).toMatchObject({
      status: "beta",
      reason:
        "已在独立 MySQL 8.4 验收库通过或签/会签并发测试；生产组织和审批路由验收仍需完成。",
    });
    if (info.worker.started) {
      expect(stateControl).toMatchObject({
        status: "beta",
        reason:
          "已在独立 MySQL 8.4 验收库通过故障注入恢复测试；生产环境故障恢复演练仍需完成。",
      });
    }
  });

  it("reports injected source identity, UTC build time and Docker image ID", () => {
    vi.stubEnv("BUILD_ID", "source-0123456789abcdef");
    vi.stubEnv("BUILD_TIME", "2026-09-28T10:30:00Z");
    vi.stubEnv("IMAGE_ID", "sha256:" + "a".repeat(64));

    expect(getRuntimeInfo()).toMatchObject({
      buildId: "source-0123456789abcdef",
      buildTime: "2026-09-28T10:30:00Z",
      imageId: "sha256:" + "a".repeat(64),
    });
  });

  it("uses an explicit missing-metadata marker instead of unknown", () => {
    vi.stubEnv("BUILD_ID", "");
    vi.stubEnv("BUILD_SHA", "");
    vi.stubEnv("GIT_SHA", "");
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("IMAGE_ID", "");
    vi.stubEnv("IMAGE_DIGEST", "");

    expect(getRuntimeInfo()).toMatchObject({
      buildId: "not-injected",
      buildTime: "not-injected",
      imageId: "not-injected",
    });
  });

  it("keeps the public readiness and version payloads free of runtime details", () => {
    const readiness = getPublicReadiness(true);
    expect(readiness).toEqual({ ready: true });
    expect(Object.keys(readiness)).toEqual(["ready"]);
    expect(getPublicVersion()).toEqual({ version: packageManifest.version });
    expect(runtimeSource).toContain(
      'export const PUBLIC_APP_VERSION = "1.0.0"'
    );
  });

  it("separates liveness, readiness and version endpoints", () => {
    expect(serverSource).toContain("registerHealthRoutes(app)");
    expect(healthRoutesSource).toContain('app.get("/livez"');
    expect(healthRoutesSource).toContain('app.get("/readyz"');
    expect(healthRoutesSource).toContain('app.get("/version"');
    expect(healthRoutesSource).toContain("= checkReadiness");
    expect(healthRoutesSource).toContain("await readReadiness()");
    expect(healthRoutesSource).toContain("getPublicReadiness(readiness.ready)");
    expect(healthRoutesSource).toContain("getPublicVersion()");
    expect(routerSource).toContain(
      "readiness: adminProcedure.query(() => checkReadiness())"
    );
  });

  it("keeps deployment verification independent of public runtime metadata", () => {
    expect(deployScript).toContain('fetch("http://127.0.0.1:3000/readyz")');
    expect(deployScript).toContain('--env EXPECTED_BUILD_ID="$BUILD_ID"');
    expect(deployScript).not.toContain("runtime.buildId");
    expect(remoteAcceptanceScript).toContain(
      'admin.query("config.runtimeInfo")'
    );
    expect(remoteAcceptanceScript).toContain('statePath === "-"');
    expect(remoteAcceptanceScript).toContain(
      "async function readStandardInput()"
    );
    expect(remoteAcceptanceScript).toContain(
      'admin.mutate("project.revokeMember"'
    );
    expect(remoteAcceptanceScript).toContain(
      'admin.mutate("iam.updateUserStatus"'
    );
    expect(remoteAcceptanceScript).toContain('status: "disabled"');
  });

  it("verifies a private database backup before building and migrating the app", () => {
    expect(deployScript).toContain(
      'mysqldump --user=root --single-transaction --routines --triggers --databases "$MYSQL_DATABASE"'
    );
    expect(deployScript).toContain('sudo -n chmod 0600 -- "$backup_partial"');
    expect(deployScript).toContain('sudo -n gzip -t -- "$backup_partial"');
    expect(
      deployScript.indexOf('create_database_backup "$MYSQL_BEFORE_ID"')
    ).toBeLessThan(deployScript.indexOf('compose build "$APP_SERVICE"'));
  });

  it("includes the data source test job table in the migration gate", () => {
    expect(runtimeSource).toContain("data_source_test_run");
  });
});
