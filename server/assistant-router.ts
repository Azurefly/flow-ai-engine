import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resourceRequestKeyPattern } from "../shared/resource-creation";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  assistantConfigSchema,
  assistantSessionsPage,
  type SessionSummary,
  createAssistantSession,
  getAssistantSession,
  listAssistantConfigs,
  listAssistantSessions,
  listAvailableAssistantConfigs,
  publishAssistantConfig,
  saveAssistantDraft,
} from "./assistant-store";
import { publicSession } from "./assistant-runtime";
import { assistantJobOperations, cancelAssistantJob, getAssistantJob, reviewAssistantJob } from "./assistant-jobs";
import { submitAssistantJob, waitForAssistantTurn } from "./assistant-job-worker";
import type { ProjectUser } from "./project-service";
import { getWorkflow } from "./workflow-service";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const requestKey = z.string().regex(resourceRequestKeyPattern);
const contextInput = z.object({
  projectId: id.nullish(),
  workflowId: id.nullish(),
});
const update = z.object({
  sessionId: id,
  revision: z.number().int().nonnegative(),
  requestId: requestKey,
  pageSize: z.number().int().min(1).max(50).optional(),
});
const message = z.object({
  text: z.string().trim().min(1).max(6000),
  timeZone: z.string().max(100).refine(zone => {
    try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; }
    catch { return false; }
  }, "时区无效").optional(),
  proposalId: id.optional(),
});
const decision = z.object({ proposalId: id, approve: z.boolean() });
const payload = z.discriminatedUnion("kind", [
  message.extend({ kind: z.literal("message") }), decision.extend({ kind: z.literal("decide") }),
]);

async function resolveContext(
  user: ProjectUser,
  context?: z.infer<typeof contextInput>
) {
  const { projectId, workflowId } = context ?? {};
  if (!workflowId) return { projectId: projectId ?? null, workflowId: null };
  const workflow = await getWorkflow(workflowId, user);
  if (!workflow || (projectId && workflow.projectId !== projectId)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "当前流程不存在或无法访问。",
    });
  }
  return { projectId: workflow.projectId ?? null, workflowId };
}

function adminView<T extends { agentId: string }>(entry: T) {
  return { ...entry, id: entry.agentId };
}

function publicSummary(entry: SessionSummary) {
  return {
        id: entry.id,
        agentId: entry.agentId,
        agentName: entry.agentName,
        title: entry.title,
        preview: entry.trial,
        revision: entry.revision,
        configVersion: entry.configVersion,
        projectId: entry.projectId,
        context: { projectId: entry.projectId, workflowId: entry.workflowId },
        updatedAt: entry.updatedAt,
      };
}

export const assistantRouter = router({
  available: protectedProcedure
    .input(contextInput.optional())
    .query(async ({ ctx, input }) => {
      const scope = await resolveContext(ctx.user, input);
      const agents = await listAvailableAssistantConfigs(
        ctx.user,
        scope.projectId
      );
      return agents.map(({ agentId, config }) => ({
        id: agentId,
        name: config.name,
        greeting: config.greeting,
      }));
    }),
  adminAgents: adminProcedure.query(async () =>
    (await listAssistantConfigs()).map(adminView)
  ),
  saveDraft: adminProcedure
    .input(
      z.object({
        agentId: id.optional(),
        expectedVersion: z.number().int().nonnegative(),
        config: assistantConfigSchema,
      })
    )
    .mutation(async ({ ctx, input }) =>
      adminView(
        await saveAssistantDraft(
          ctx.user,
          input.expectedVersion,
          input.config,
          input.agentId
        )
      )
    ),
  publish: adminProcedure
    .input(
      z.object({ agentId: id, expectedVersion: z.number().int().nonnegative() })
    )
    .mutation(async ({ ctx, input }) =>
      adminView(
        await publishAssistantConfig(
          ctx.user,
          input.expectedVersion,
          input.agentId
        )
      )
    ),
  start: protectedProcedure
    .input(
      z.object({
        agentId: id,
        preview: z.boolean().optional(),
        context: contextInput.optional(),
        sessionId: z.uuidv4().optional(),
        expectedConfigVersion: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = await resolveContext(ctx.user, input.context);
      const session = await createAssistantSession(
        ctx.user,
        input.preview ?? false,
        undefined,
        scope.projectId,
        input.agentId,
        scope.workflowId,
        {
          sessionId: input.sessionId,
          expectedConfigVersion: input.expectedConfigVersion,
        }
      );
      return publicSession(session);
    }),
  sessions: protectedProcedure
    .input(
      z
        .object({
          preview: z.boolean().optional(),
          agentId: id.optional(),
          projectId: id.optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      (
        await listAssistantSessions(
          ctx.user,
          input?.preview ?? false,
          input?.agentId,
          input?.projectId
        )
      ).map(publicSummary)
    ),
  sessionsPage: protectedProcedure
    .input(z.object({
      preview: z.boolean().default(false), agentId: id.optional(), projectId: id.nullish(),
      configVersion: z.number().int().positive().optional(), search: z.string().trim().max(160).optional(),
      limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(768).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const page = await assistantSessionsPage(ctx.user, input, input.limit, input.cursor);
      return { items: page.items.map(publicSummary), nextCursor: page.nextCursor };
    }),
  get: protectedProcedure
    .input(z.object({ sessionId: id, requestId: requestKey.optional(), pageSize: z.number().int().min(1).max(50).optional(), beforeRevision: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }) => {
      const session = await getAssistantSession(
        ctx.user,
        input.sessionId,
        input.requestId,
        input.pageSize ? { size: input.pageSize, beforeRevision: input.beforeRevision } : undefined
      );
      return {
        ...publicSession(session),
        ...(input.requestId
          ? { requestCommitted: session.requestCommitted }
          : {}),
      };
    }),
  enqueue: protectedProcedure.input(update.extend({ payload })).mutation(({ ctx, input }) =>
    submitAssistantJob(ctx.user, input.sessionId, input.revision, input.requestId, input.payload)),
  job: protectedProcedure.input(z.object({ sessionId: id, requestId: requestKey.optional() })).query(({ ctx, input }) =>
    getAssistantJob(ctx.user, input.sessionId, input.requestId)),
  cancelJob: protectedProcedure.input(z.object({ sessionId: id, requestId: requestKey })).mutation(({ ctx, input }) =>
    cancelAssistantJob(ctx.user, input.sessionId, input.requestId)),
  operations: adminProcedure.query(({ ctx }) => assistantJobOperations(ctx.user)),
  reviewJob: adminProcedure.input(z.object({ jobId: z.uuid(), applied: z.boolean(),
    evidence: z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9\u3400-\u9fff._:/ -]+$/, "请填写业务回执编号或审计记录标识") }))
    .mutation(({ ctx, input }) => reviewAssistantJob(ctx.user, input.jobId, input.applied, input.evidence)),
  message: protectedProcedure.input(update.extend(message.shape))
    .mutation(async ({ ctx, input }) => {
      const { sessionId, revision, requestId, text, proposalId, timeZone } = input;
      const session = await waitForAssistantTurn(ctx.user, sessionId, revision, requestId,
        { kind: "message", text, proposalId, ...(timeZone ? { timeZone } : {}) }, input.pageSize);
      return publicSession(session);
    }),
  decide: protectedProcedure
    .input(update.extend(decision.shape))
    .mutation(async ({ ctx, input }) => {
      const { sessionId, revision, requestId, proposalId, approve } = input;
      const session = await waitForAssistantTurn(ctx.user, sessionId, revision, requestId, { kind: "decide", proposalId, approve }, input.pageSize);
      return publicSession(session);
    }),
});
