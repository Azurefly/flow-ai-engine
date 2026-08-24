import { defineConfig } from "vitest/config";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("MySQL integration tests require DATABASE_URL; this gate must not be reported as skipped or passed without a real database.");
}

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
      "@assets": path.resolve(root, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.integration.test.ts"],
    exclude: [
      "server/llm-runtime.integration.test.ts",
      "server/workflow-llm.integration.test.ts",
      "server/p2-schedule-live-delete.integration.test.ts",
    ],
  },
});
