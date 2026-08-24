import { defineConfig } from "vitest/config";
import path from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("Provider workflow integration tests require DATABASE_URL.");
}
if (!process.env.OPENAI_API_KEY && !process.env.BUILT_IN_FORGE_API_KEY) {
  throw new Error("Provider integration tests require OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY; an absent provider must be reported as blocked, not skipped.");
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
    include: [
      "server/llm-runtime.integration.test.ts",
      "server/workflow-llm.integration.test.ts",
    ],
  },
});
