import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
const createVite = vi.hoisted(() =>
  vi.fn(
    async (_options: {
      configFile?: string | false;
      server: { hmr: { server: unknown } };
    }) => ({
      middlewares: (_req: unknown, _res: unknown, next: () => void) => next(),
    })
  )
);
vi.mock("vite", () => ({ createServer: createVite }));
import { setupVite } from "./_core/vite";
it("开发中间件交由 Vite 加载项目配置函数，前端入口和 HMR 使用同一个开发服务", async () => {
  const app = express(),
    server = createServer(app);
  await setupVite(app, server);
  const options = createVite.mock.calls[0][0];
  expect(options.configFile).toBe(
    path.resolve(import.meta.dirname, "..", "vite.config.ts")
  );
  expect(existsSync(String(options.configFile))).toBe(true);
  expect(options.server.hmr.server).toBe(server);
});
