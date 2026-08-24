import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { parse } from "cookie";
import { authenticateToken, FLOW_SESSION_COOKIE } from "../internal-auth";
import type { CorrelatedRequest } from "./http-security";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  requestId: string;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  user = await authenticateToken(
    parse(opts.req.headers.cookie ?? "")[FLOW_SESSION_COOKIE]
  );

  return {
    req: opts.req,
    res: opts.res,
    user,
    requestId: (opts.req as CorrelatedRequest).requestId ?? "unavailable",
  };
}
