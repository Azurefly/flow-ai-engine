import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type CorrelatedRequest = Request & { requestId?: string };

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const requestIdPattern = /^[A-Za-z0-9._:-]{8,100}$/;

function configuredOrigins() {
  return new Set(
    [process.env.APP_ORIGIN, ...(process.env.TRUSTED_ORIGINS ?? "").split(",")]
      .map(value => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map(value => new URL(value).origin)
  );
}

function requestOrigin(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get("host");
  return host ? `${protocol}://${host}` : null;
}

export function requestCorrelation(
  req: CorrelatedRequest,
  res: Response,
  next: NextFunction
) {
  const supplied = req.get("x-request-id")?.trim();
  const requestId =
    supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()"
  );
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  if (
    process.env.NODE_ENV === "production" &&
    (req.protocol === "https" ||
      String(req.headers["x-forwarded-proto"] ?? "").includes("https"))
  ) {
    res.setHeader(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
}

export function enforceTrustedOrigin(
  req: CorrelatedRequest,
  res: Response,
  next: NextFunction
) {
  if (
    !unsafeMethods.has(req.method.toUpperCase()) ||
    !req.path.startsWith("/api/")
  ) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    res
      .status(403)
      .json({ error: "请求来源格式无效。", requestId: req.requestId });
    return;
  }

  const allowed = configuredOrigins();
  const sameOrigin = requestOrigin(req);
  if (
    allowed.has(normalizedOrigin) ||
    (allowed.size === 0 && normalizedOrigin === sameOrigin)
  ) {
    next();
    return;
  }

  res
    .status(403)
    .json({ error: "请求来源不受信任。", requestId: req.requestId });
}
