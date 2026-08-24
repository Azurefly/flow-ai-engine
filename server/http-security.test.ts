import { describe, expect, it, vi } from "vitest";
import {
  enforceTrustedOrigin,
  requestCorrelation,
  securityHeaders,
  type CorrelatedRequest,
} from "./_core/http-security";

function exchange(input: {
  method?: string;
  path?: string;
  protocol?: string;
  headers?: Record<string, string>;
}) {
  const headers = new Map(
    Object.entries(input.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );
  const responseHeaders = new Map<string, string>();
  const req = {
    method: input.method ?? "POST",
    path: input.path ?? "/api/trpc/workflow.update",
    protocol: input.protocol ?? "https",
    headers: Object.fromEntries(headers),
    get: (name: string) => headers.get(name.toLowerCase()),
  } as unknown as CorrelatedRequest;
  const res = {
    setHeader: (name: string, value: string) =>
      responseHeaders.set(name.toLowerCase(), value),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  return { req, res, responseHeaders, next: vi.fn() };
}

describe("HTTP security boundary", () => {
  it("adds a correlation id and baseline browser security headers", () => {
    const context = exchange({
      headers: { host: "flow.example.com", "x-request-id": "trace-12345678" },
    });
    requestCorrelation(context.req, context.res, context.next);
    securityHeaders(context.req, context.res, context.next);
    expect(context.req.requestId).toBe("trace-12345678");
    expect(context.responseHeaders.get("x-request-id")).toBe("trace-12345678");
    expect(context.responseHeaders.get("x-content-type-options")).toBe(
      "nosniff"
    );
    expect(context.responseHeaders.get("x-frame-options")).toBe("DENY");
    expect(context.responseHeaders.get("permissions-policy")).toContain(
      "camera=()"
    );
  });

  it("allows same-origin writes and rejects cross-origin cookie writes", () => {
    const sameOrigin = exchange({
      headers: { host: "flow.example.com", origin: "https://flow.example.com" },
    });
    enforceTrustedOrigin(sameOrigin.req, sameOrigin.res, sameOrigin.next);
    expect(sameOrigin.next).toHaveBeenCalledOnce();

    const crossOrigin = exchange({
      headers: { host: "flow.example.com", origin: "https://attacker.example" },
    });
    crossOrigin.req.requestId = "trace-87654321";
    enforceTrustedOrigin(crossOrigin.req, crossOrigin.res, crossOrigin.next);
    expect(crossOrigin.next).not.toHaveBeenCalled();
    expect(crossOrigin.res.status).toHaveBeenCalledWith(403);
    expect(crossOrigin.res.json).toHaveBeenCalledWith({
      error: "请求来源不受信任。",
      requestId: "trace-87654321",
    });
  });

  it("does not require a browser Origin header for server-to-server API calls", () => {
    const context = exchange({ headers: { host: "flow.example.com" } });
    enforceTrustedOrigin(context.req, context.res, context.next);
    expect(context.next).toHaveBeenCalledOnce();
  });
});
