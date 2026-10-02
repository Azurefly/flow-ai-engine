import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerHealthRoutes } from "./health-routes";
import {
  checkReadiness,
  DATABASE_MIGRATION_VERSION,
  getRuntimeInfo,
} from "./runtime-info";

type ReadinessResult = Awaited<ReturnType<typeof checkReadiness>>;

function readinessResult(ready: boolean): ReadinessResult {
  return {
    ready,
    checks: {
      database: { ok: ready, message: "connected" },
      migrations: { ok: ready, message: DATABASE_MIGRATION_VERSION },
      worker: { ok: ready, message: "idle" },
      llm: { ok: true, message: "optional" },
    },
    runtime: getRuntimeInfo(),
  };
}

async function withHealthServer(
  readiness: ReadinessResult,
  path: string
): Promise<{ status: number; body: unknown }> {
  const app = express();
  registerHealthRoutes(app, async () => readiness);
  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("health test server did not bind a TCP port");
  }
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

describe("public health route disclosure boundary", () => {
  it("returns only the health boolean from the anonymous readiness endpoint", async () => {
    await expect(
      withHealthServer(readinessResult(true), "/readyz")
    ).resolves.toEqual({
      status: 200,
      body: { ready: true },
    });
  });

  it("preserves the not-ready status without exposing check details", async () => {
    await expect(
      withHealthServer(readinessResult(false), "/readyz")
    ).resolves.toEqual({
      status: 503,
      body: { ready: false },
    });
  });

  it("returns the public semantic version without runtime fingerprints", async () => {
    await expect(
      withHealthServer(readinessResult(true), "/version")
    ).resolves.toEqual({
      status: 200,
      body: { version: "1.0.0" },
    });
  });
});
