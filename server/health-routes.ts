import type { Express } from "express";
import {
  checkReadiness,
  getPublicReadiness,
  getPublicVersion,
} from "./runtime-info";

type ReadinessResult = Awaited<ReturnType<typeof checkReadiness>>;

export function registerHealthRoutes(
  app: Express,
  readReadiness: () => Promise<ReadinessResult> = checkReadiness
) {
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/livez", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/version", (_req, res) => res.status(200).json(getPublicVersion()));
  app.get("/readyz", async (_req, res) => {
    const readiness = await readReadiness();
    res
      .status(readiness.ready ? 200 : 503)
      .json(getPublicReadiness(readiness.ready));
  });
}
