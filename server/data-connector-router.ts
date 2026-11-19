import { z } from "zod";
import { parse } from "cookie";
import { FLOW_SESSION_COOKIE } from "./internal-auth";
import { protectedProcedure, router } from "./_core/trpc";
import { versionInput } from "./data-connector-contract";
import {
  confirmExternalWrite,
  registerConnectorVersion,
  connectorVersionList,
  listWriteReceipts,
} from "./versioned-data-connectors";
const projectId = z.string().min(8).max(36);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const connectorRouter = router({
  versions: protectedProcedure
    .input(z.object({ projectId }))
    .query(({ ctx, input }) => connectorVersionList(ctx.user, input.projectId)),
  register: protectedProcedure
    .input(versionInput)
    .mutation(({ ctx, input }) => registerConnectorVersion(ctx.user, input)),
  writes: protectedProcedure
    .input(z.object({ projectId, runId: z.string().min(8).max(36) }))
    .query(({ ctx, input }) =>
      listWriteReceipts(ctx.user, input.projectId, input.runId)
    ),
  confirm: protectedProcedure
    .input(z.object({ projectId, operationKey: digest, payloadHash: digest }))
    .mutation(({ ctx, input }) =>
      confirmExternalWrite(
        ctx.user,
        input,
        parse(ctx.req.headers.cookie ?? "")[FLOW_SESSION_COOKIE]
      )
    ),
});
