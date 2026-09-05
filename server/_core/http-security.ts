import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export type CorrelatedRequest = Request & { requestId?: string };

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const requestIdPattern = /^[A-Za-z0-9._:-]{8,100}$/;
const requestContext = new AsyncLocalStorage<{ requestId: string }>();
export function currentRequestId() {
  return requestContext.getStore()?.requestId;
}

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
  requestContext.run({ requestId }, next);
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
  let normalizedOrigin: string | null = null;

  if (origin) {
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      res
        .status(403)
        .json({ error: "请求来源格式无效。", requestId: req.requestId });
      return;
    }
  } else {
    const referer = req.get("referer");
    if (referer) {
      try {
        normalizedOrigin = new URL(referer).origin;
      } catch {
        res
          .status(403)
          .json({ error: "请求来源格式无效。", requestId: req.requestId });
        return;
      }
    }
  }

  if (!normalizedOrigin) {
    const secFetchSite = req.get("sec-fetch-site");
    if (secFetchSite === "cross-site") {
      res
        .status(403)
        .json({ error: "跨站请求未携带来源头。", requestId: req.requestId });
      return;
    }
    next();
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
