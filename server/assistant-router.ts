import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resourceRequestKeyPattern } from "../shared/resource-creation";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  assistantConfigSchema,
  createAssistantSession,
  getAssistantSession,
  listAssistantConfigs,
  listAssistantSessions,
  listAvailableAssistantConfigs,
  mutateAssistantSession,
  publishAssistantConfig,
  saveAssistantDraft,
} from "./assistant-store";
import {
  decideAssistantProposal,
  publicSession,
  runAssistantTurn,
} from "./assistant-runtime";
import type { ProjectUser } from "./project-service";
import { getWorkflow } from "./workflow-service";
import { commitAssistantTool } from "./assistant-tools";

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
});

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
      ).map(entry => ({
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
      }))
    ),
  get: protectedProcedure
    .input(z.object({ sessionId: id, requestId: requestKey.optional() }))
    .query(async ({ ctx, input }) => {
      const session = await getAssistantSession(
        ctx.user,
        input.sessionId,
        input.requestId
      );
      return {
        ...publicSession(session),
        ...(input.requestId
          ? { requestCommitted: session.requestCommitted }
          : {}),
      };
    }),
  message: protectedProcedure
    .input(
      update.extend({
        text: z.string().trim().min(1).max(6000),
        proposalId: id.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, revision, requestId, text, proposalId } = input;
      const session = await mutateAssistantSession(
        ctx.user,
        sessionId,
        revision,
        requestId,
        { kind: "message", text, proposalId },
        current =>
          runAssistantTurn(ctx.user, current, text, undefined, proposalId, ctx)
      );
      return publicSession(session);
    }),
  decide: protectedProcedure
    .input(update.extend({ proposalId: id, approve: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { sessionId, revision, requestId, proposalId, approve } = input;
      const session = await mutateAssistantSession(
        ctx.user,
        sessionId,
        revision,
        requestId,
        { kind: "decide", proposalId, approve },
        current =>
          decideAssistantProposal(ctx.user, current, proposalId, approve, (actor, proposal, key) => commitAssistantTool(actor, proposal, key, ctx))
      );
      return publicSession(session);
    }),
});
