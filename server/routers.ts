import { parse } from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  iamManageProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./_core/trpc";
import {
  createUser,
  ensureBootstrapAdmin,
  FLOW_SESSION_COOKIE,
  listUsers,
  login,
  logout,
  setUserStatus,
} from "./internal-auth";
import {
  assignRole,
  createCustomRole,
  deleteCustomRole,
  getRoleAuthorizationDetails,
  getUserAuthorizationDetails,
  getWorkflowAccess,
  grantWorkflowMember,
  listActiveUsersForWorkflowAssignment,
  listAuthorizationAudit,
  listRoles,
  listWorkflowMembers,
  recordAuthorizationAudit,
  revokeRoleAssignment,
  revokeWorkflowMember,
  updateCustomRole,
} from "./iam-service";
import {
  getRuntimeModels,
  getWorkflowRun,
  getWorkflowRunMetrics,
  listRunAlerts,
  listWorkflowRuns,
  markRunAlertRead,
  controlWorkflowRun,
  pauseWorkflowRun,
  resumeWorkflowRun,
  signalWorkflowMessage,
} from "./workflow-engine";
import { submitWorkflowRun, wakeWorkflowWorker } from "./workflow-worker";
import { getRuntimeInfo } from "./runtime-info";
import { previewUserBatch, previewUserCreation } from "./iam-ai-service";
import {
  archiveWorkflow,
  compileWorkflowDraft,
  createNodeTemplate,
  createSubflow,
  createWorkflow,
  deleteNodeTemplate,
  deleteSubflow,
  diffWorkflowVersions,
  duplicateWorkflow,
  getWorkflow,
  hasWorkflowPermission,
  listArchivedWorkflows,
  listNodeTemplates,
  listSubflows,
  listWorkflowVersions,
  listWorkflows,
  restoreWorkflow,
  rollbackWorkflowVersion,
  updateNodeTemplate,
  updateSubflow,
  updateWorkflow,
  WorkflowVersionConflictError,
} from "./workflow-service";
import {
  createFolder,
  createProject,
  createProjectWorkflow,
  deleteFolder,
  exportProjectWorkflows,
  getProjectAccess,
  grantProjectMember,
  listProjectMembers,
  listProjects,
  listProjectWorkflowAudit,
  listProjectWorkflows,
  listWarehouse,
  moveProjectWorkflow,
  resetProjectWorkflowAudit,
  setProjectWorkflowAudit,
  updateFolder,
  updateProjectWorkflowInfo,
} from "./project-service";
import {
  createProjectServiceEndpoint,
  listProjectServiceEndpoints,
  setProjectServiceEndpointStatus,
} from "./service-endpoint-service";
import {
  batchClaimWorkflowTasks,
  batchCompleteWorkflowTasks,
  addWorkflowTaskSigner,
  claimWorkflowTask,
  completeWorkflowTask,
  delegateWorkflowTask,
  executeWorkflowTask,
  createWorkDomain,
  getP1SystemSettings,
  getPublicGeneralSettings,
  getTaskCalendar,
  getTaskDashboard,
  getWorkflowTask,
  handoverWorkflowTask,
  listActiveWorkDomains,
  listProcessInstances,
  listWorkDomains,
  listWorkflowTaskAssignees,
  listWorkflowTasks,
  removeWorkflowTaskSigner,
  returnWorkflowTaskToPending,
  updateP1SystemSetting,
  updateWorkDomain,
} from "./p1-service";
import {
  assignOrganizationMember,
  bindOrganizationRole,
  createOrganizationUnit,
  deleteOrganizationUnit,
  listOrganization,
  moveOrganizationMember,
  removeOrganizationMember,
  resolveOperateAssignees,
  setPrimaryOrganizationMembership,
  unbindOrganizationRole,
  updateOrganizationUnit,
} from "./organization-service";
import {
  activateDataflowSchedule,
  createDataAsset,
  createDataSource,
  createDataTag,
  createDataUdf,
  createProjectPlugin,
  deleteDataAsset,
  deleteDataSource,
  deleteDataTag,
  deleteDataUdf,
  deleteDataflowSchedule,
  deleteProjectPlugin,
  getDataflowRunLineage,
  listDataSourceTests,
  listDataflowRuns,
  listDataflowSchedules,
  listDataflows,
  listDataResources,
  pauseDataflowSchedule,
  runDataflow,
  testDataSource,
  saveDataflowScheduleDraft,
  updateDataAsset,
  updateDataSource,
  updateDataUdf,
  updateProjectPlugin,
} from "./p2-service";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  loginRateLimitKey,
  recordLoginFailure,
} from "./_core/login-rate-limit";

const approvalResultSchema = z
  .object({
    decision: z.enum(["approved", "rejected", "abstained"]),
    comment: z.string().trim().max(2000).optional(),
  })
  .catchall(z.unknown());

function assertWorkflowRunController(
  user: { id: number },
  run: unknown,
  action: string
) {
  const record = run as {
    triggeredByUserId?: unknown;
    ownerUserId?: unknown;
  } | null;
  if (
    !record ||
    (Number(record.triggeredByUserId) !== user.id &&
      Number(record.ownerUserId) !== user.id)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `仅流程发起人或流程所有者可${action}。`,
    });
  }
}

function throwWorkflowMutationError(error: unknown): never {
  if (error instanceof WorkflowVersionConflictError)
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  throw error;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    bootstrapStatus: publicProcedure.query(async () => {
      await ensureBootstrapAdmin();
      return {
        configured: Boolean(
          process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME &&
            process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
        ),
      };
    }),
    me: publicProcedure.query(async ({ ctx }) => {
      await ensureBootstrapAdmin();
      return ctx.user;
    }),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(3).max(64),
          password: z.string().min(12).max(256),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const loginKey = loginRateLimitKey(
          input.username,
          ctx.req.ip ?? "unknown"
        );
        const rateLimit = checkLoginRateLimit(loginKey);
        if (!rateLimit.allowed) {
          ctx.res.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `登录失败次数过多，请 ${rateLimit.retryAfterSeconds} 秒后重试。`,
          });
        }
        const result = await login(
          input.username,
          input.password,
          ctx.req.headers["user-agent"]
        );
        if (!result) {
          const failure = recordLoginFailure(loginKey);
          if (!failure.allowed)
            ctx.res.setHeader("retry-after", String(failure.retryAfterSeconds));
          throw new TRPCError({
            code: failure.allowed ? "UNAUTHORIZED" : "TOO_MANY_REQUESTS",
            message: failure.allowed
              ? "用户名或密码错误，或账号已停用。"
              : `登录失败次数过多，请 ${failure.retryAfterSeconds} 秒后重试。`,
          });
        }
        clearLoginFailures(loginKey);
        ctx.res.cookie(FLOW_SESSION_COOKIE, result.token, {
          ...getSessionCookieOptions(ctx.req),
          httpOnly: true,
          sameSite: "lax",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        return result.user;
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await logout(
        parse(ctx.req.headers.cookie ?? "")[FLOW_SESSION_COOKIE],
        ctx.user?.id
      );
      ctx.res.clearCookie(FLOW_SESSION_COOKIE, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: -1,
      });
      return { success: true } as const;
    }),
  }),
  iam: router({
    users: iamManageProcedure.query(() => listUsers()),
    previewUserCreation: iamManageProcedure
      .input(
        z.object({
          username: z.string().trim().max(64).optional(),
          name: z.string().trim().min(1).max(160),
          email: z.string().email().optional(),
          role: z.enum(["user", "admin"]).default("user"),
          organizationHint: z.string().trim().max(160).optional(),
          managerHint: z.string().trim().max(160).optional(),
        })
      )
      .mutation(({ input }) => previewUserCreation(input)),
    previewUserBatch: iamManageProcedure
      .input(
        z.object({
          goal: z.string().trim().min(3).max(2000),
          maxUsers: z.number().int().min(1).max(30).default(10),
          defaultRole: z.enum(["user", "admin"]).default("user"),
        })
      )
      .mutation(({ input }) => previewUserBatch(input)),
    createUser: iamManageProcedure
      .input(
        z.object({
          username: z.string().trim().min(3).max(64),
          password: z.string().min(12).max(256),
          name: z.string().trim().min(1).max(160),
          email: z.string().email().optional(),
          role: z.enum(["user", "admin"]).default("user"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userId = await createUser(input);
        await recordAuthorizationAudit({
          actorUserId: ctx.user.id,
          targetUserId: userId,
          action: "user_created",
          resourceType: "user",
          resourceId: String(userId),
        });
        return { success: true, userId };
      }),
    createUsersBatch: iamManageProcedure
      .input(
        z.object({
          users: z
            .array(
              z.object({
                username: z.string().trim().min(3).max(64),
                password: z.string().min(12).max(256),
                name: z.string().trim().min(1).max(160),
                email: z.string().email().optional(),
                role: z.enum(["user", "admin"]).default("user"),
              })
            )
            .min(1)
            .max(30),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const results: Array<{
          username: string;
          success: boolean;
          userId?: number;
          error?: string;
        }> = [];
        for (const account of input.users) {
          try {
            const userId = await createUser(account);
            await recordAuthorizationAudit({
              actorUserId: ctx.user.id,
              targetUserId: userId,
              action: "user_created",
              resourceType: "user",
              resourceId: String(userId),
              details: { source: "ai_batch_preview" },
            });
            results.push({ username: account.username, success: true, userId });
          } catch (error) {
            results.push({
              username: account.username,
              success: false,
              error: error instanceof Error ? error.message : "创建失败",
            });
          }
        }
        return {
          results,
          created: results.filter(result => result.success).length,
          failed: results.filter(result => !result.success).length,
        };
      }),
    updateUserStatus: iamManageProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          status: z.enum(["active", "disabled"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await setUserStatus(input.userId, input.status);
        await recordAuthorizationAudit({
          actorUserId: ctx.user.id,
          targetUserId: input.userId,
          action:
            input.status === "disabled" ? "user_disabled" : "user_updated",
          resourceType: "user",
          resourceId: String(input.userId),
          details: { status: input.status },
        });
        return { success: true };
      }),
    roles: iamManageProcedure
      .input(
        z
          .object({ scope: z.enum(["system", "workflow"]).optional() })
          .optional()
      )
      .query(async ({ input }) => listRoles(input?.scope)),
    userAuthorizationDetails: iamManageProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .query(({ input }) => getUserAuthorizationDetails(input.userId)),
    roleAuthorizationDetails: iamManageProcedure
      .input(z.object({ roleId: z.number().int().positive() }))
      .query(({ input }) => getRoleAuthorizationDetails(input.roleId)),
    assignSystemRole: iamManageProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          roleCode: z.string().min(1).max(64),
          expiresAt: z.date().optional(),
          note: z.string().max(320).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await assignRole({
          userId: input.userId,
          roleCode: input.roleCode,
          scopeType: "system",
          grantedByUserId: ctx.user.id,
          expiresAt: input.expiresAt,
          note: input.note,
        });
        return { success: true };
      }),
    revokeRoleAssignment: iamManageProcedure
      .input(z.object({ assignmentId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await revokeRoleAssignment({ ...input, revokedByUserId: ctx.user.id });
        return { success: true };
      }),
    createCustomRole: iamManageProcedure
      .input(
        z.object({
          code: z.string().min(10).max(68),
          name: z.string().trim().min(1).max(120),
          description: z.string().max(2000).optional(),
          scope: z.enum(["system", "workflow"]),
          permissions: z
            .array(
              z.enum([
                "workflow:create",
                "workflow:view",
                "workflow:edit",
                "workflow:publish",
                "workflow:run",
                "workflow:members:manage",
                "iam:manage",
              ])
            )
            .min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await createCustomRole({ ...input, actorUserId: ctx.user.id });
        return { success: true };
      }),
    updateCustomRole: iamManageProcedure
      .input(
        z.object({
          code: z.string().min(10).max(68),
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().max(2000).nullable().optional(),
          permissions: z
            .array(
              z.enum([
                "workflow:create",
                "workflow:view",
                "workflow:edit",
                "workflow:publish",
                "workflow:run",
                "workflow:members:manage",
                "iam:manage",
              ])
            )
            .min(1)
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateCustomRole({ ...input, actorUserId: ctx.user.id });
        return { success: true };
      }),
    deleteCustomRole: iamManageProcedure
      .input(z.object({ code: z.string().min(10).max(68) }))
      .mutation(async ({ ctx, input }) => {
        await deleteCustomRole({ ...input, actorUserId: ctx.user.id });
        return { success: true };
      }),
    authorizationAudit: iamManageProcedure
      .input(
        z
          .object({ limit: z.number().int().min(1).max(200).default(100) })
          .optional()
      )
      .query(({ input }) => listAuthorizationAudit(input?.limit)),
  }),
  project: router({
    list: protectedProcedure.query(({ ctx }) => listProjects(ctx.user)),
    access: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => getProjectAccess(ctx.user, input.projectId)),
    serviceEndpoints: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) =>
        listProjectServiceEndpoints(ctx.user, input.projectId)
      ),
    createServiceEndpoint: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          refCode: z.string().trim().min(2).max(64),
          name: z.string().trim().min(1).max(160),
          baseUrl: z.string().trim().url().max(2048),
          secretRef: z.string().trim().max(255).nullable().optional(),
          authHeaderName: z.string().trim().max(128).nullable().optional(),
          authScheme: z.string().trim().max(32).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createProjectServiceEndpoint(ctx.user, input),
      })),
    setServiceEndpointStatus: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          id: z.string().uuid(),
          status: z.enum(["active", "disabled"]),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await setProjectServiceEndpointStatus(ctx.user, input),
      })),
    create: protectedProcedure
      .input(
        z.object({
          code: z.string().trim().min(2).max(64),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(2000).optional(),
          domainId: z.string().uuid().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createProject(ctx.user, input),
      })),
    activeDomains: protectedProcedure.query(() => listActiveWorkDomains()),
    workflows: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          flowType: z.enum(["state", "control", "data"]).optional(),
          auditStatus: z.enum(["init", "approved", "rejected"]).optional(),
          status: z.enum(["draft", "published"]).optional(),
          keyword: z.string().trim().max(160).optional(),
        })
      )
      .query(({ ctx, input }) =>
        listProjectWorkflows(ctx.user, input.projectId, input)
      ),
    createWorkflow: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          processCode: z.string().trim().min(2).max(64).optional(),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(1200).optional(),
          flowType: z.enum(["state", "control", "data"]),
          creationSource: z.enum(["manual", "warehouse"]).default("manual"),
          dataSourceId: z.string().min(8).max(64).nullable().optional(),
          folderId: z.string().min(8).max(64).nullable().optional(),
          definition: z.unknown().optional(),
        })
      )
      .mutation(({ ctx, input }) => createProjectWorkflow(ctx.user, input)),
    updateWorkflowInfo: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(1200).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateProjectWorkflowInfo(ctx.user, input),
      })),
    auditWorkflow: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
          auditStatus: z.enum(["approved", "rejected"]),
        })
      )
      .mutation(({ ctx, input }) => setProjectWorkflowAudit(ctx.user, input)),
    resetWorkflowAudit: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
        })
      )
      .mutation(({ ctx, input }) => resetProjectWorkflowAudit(ctx.user, input)),
    workflowAudit: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
        })
      )
      .query(({ ctx, input }) => listProjectWorkflowAudit(ctx.user, input)),
    members: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => listProjectMembers(ctx.user, input.projectId)),
    grantMember: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          userId: z.number().int().positive(),
          role: z.enum(["owner", "designer", "operator", "viewer"]),
          expiresAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await grantProjectMember(ctx.user, input),
      })),
    warehouse: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => listWarehouse(ctx.user, input.projectId)),
    exportWorkflows: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowIds: z.array(z.string().min(8).max(64)).min(1).max(100),
        })
      )
      .query(({ ctx, input }) => exportProjectWorkflows(ctx.user, input)),
    createFolder: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160),
          parentId: z.string().min(8).max(64).nullable().optional(),
          description: z.string().trim().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createFolder(ctx.user, input),
      })),
    updateFolder: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          folderId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateFolder(ctx.user, input),
      })),
    deleteFolder: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          folderId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteFolder(ctx.user, input),
      })),
    moveWorkflow: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
          folderId: z.string().min(8).max(64).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await moveProjectWorkflow(ctx.user, input),
      })),
  }),
  data: router({
    resources: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => listDataResources(ctx.user, input.projectId)),
    createSource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160),
          sourceType: z.enum(["jdbc", "api", "file", "inline"]),
          connection: z.record(z.string(), z.unknown()),
          credentialRef: z.string().trim().max(255).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createDataSource(ctx.user, input),
      })),
    updateSource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          sourceId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          status: z.enum(["draft", "disabled"]).optional(),
          connection: z.record(z.string(), z.unknown()).optional(),
          credentialRef: z.string().trim().max(255).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateDataSource(ctx.user, input),
      })),
    deleteSource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          sourceId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteDataSource(
          ctx.user,
          input.projectId,
          input.sourceId
        ),
      })),
    createAsset: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          sourceId: z.string().min(8).max(64).nullable().optional(),
          name: z.string().trim().min(1).max(160),
          assetType: z.enum(["table", "view", "file", "endpoint", "dataset"]),
          schema: z.array(z.unknown()).max(100),
          sample: z.array(z.unknown()).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createDataAsset(ctx.user, input),
      })),
    updateAsset: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          assetId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          schema: z.array(z.unknown()).max(100).optional(),
          sample: z.array(z.unknown()).max(200).optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateDataAsset(ctx.user, input),
      })),
    deleteAsset: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          assetId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteDataAsset(
          ctx.user,
          input.projectId,
          input.assetId
        ),
      })),
    createUdf: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160),
          udfType: z.enum(["sql", "javascript", "python", "jar"]),
          description: z.string().trim().max(2000).optional(),
          params: z.array(z.unknown()).max(40).optional(),
          returnType: z.string().trim().max(160).optional(),
          artifactRef: z.string().trim().max(255).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createDataUdf(ctx.user, input),
      })),
    updateUdf: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          udfId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          params: z.array(z.unknown()).max(40).optional(),
          returnType: z.string().trim().max(160).nullable().optional(),
          status: z.enum(["draft", "approved", "disabled"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateDataUdf(ctx.user, input),
      })),
    deleteUdf: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          udfId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteDataUdf(ctx.user, input.projectId, input.udfId),
      })),
    createTag: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(80),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createDataTag(ctx.user, input),
      })),
    deleteTag: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          tagId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteDataTag(ctx.user, input.projectId, input.tagId),
      })),
    createPlugin: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160),
          pluginType: z.enum(["transform", "connector", "visualization"]),
          version: z.string().trim().min(1).max(64),
          config: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createProjectPlugin(ctx.user, input),
      })),
    updatePlugin: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          pluginId: z.string().min(8).max(64),
          status: z.enum(["enabled", "disabled"]).optional(),
          version: z.string().trim().min(1).max(64).optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateProjectPlugin(ctx.user, input),
      })),
    deletePlugin: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          pluginId: z.string().min(8).max(64),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await deleteProjectPlugin(
          ctx.user,
          input.projectId,
          input.pluginId
        ),
      })),
    flows: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => listDataflows(ctx.user, input.projectId)),
    run: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
          data: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(({ ctx, input }) => runDataflow(ctx.user, input)),
    runs: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64).optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
      )
      .query(({ ctx, input }) => listDataflowRuns(ctx.user, input)),
    runLineage: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          runId: z.string().min(8).max(64),
        })
      )
      .query(({ ctx, input }) => getDataflowRunLineage(ctx.user, input)),
    testSource: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          sourceId: z.string().min(8).max(64),
        })
      )
      .mutation(({ ctx, input }) => testDataSource(ctx.user, input)),
    sourceTests: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          sourceId: z.string().min(8).max(64).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
      )
      .query(({ ctx, input }) => listDataSourceTests(ctx.user, input)),
    schedules: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) =>
        listDataflowSchedules(ctx.user, input.projectId)
      ),
    saveScheduleDraft: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
          cronExpression: z.string().trim().min(9).max(96),
        })
      )
      .mutation(({ ctx, input }) => saveDataflowScheduleDraft(ctx.user, input)),
    activateSchedule: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
        })
      )
      .mutation(({ ctx, input }) => activateDataflowSchedule(ctx.user, input)),
    pauseSchedule: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
        })
      )
      .mutation(({ ctx, input }) => pauseDataflowSchedule(ctx.user, input)),
    deleteSchedule: protectedProcedure
      .input(
        z.object({
          projectId: z.string().min(8).max(64),
          workflowId: z.string().min(8).max(64),
        })
      )
      .mutation(({ ctx, input }) => deleteDataflowSchedule(ctx.user, input)),
  }),
  task: router({
    dashboard: protectedProcedure.query(({ ctx }) =>
      getTaskDashboard(ctx.user)
    ),
    list: protectedProcedure
      .input(
        z.object({
          view: z.enum(["todo", "done", "initiated", "all"]),
          projectId: z.string().min(8).max(64).optional(),
          status: z
            .enum(["pending", "claimed", "completed", "cancelled"])
            .optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
      )
      .query(({ ctx, input }) => listWorkflowTasks(ctx.user, input)),
    instances: protectedProcedure
      .input(
        z.object({
          view: z.enum(["initiated", "all"]),
          limit: z.number().int().min(1).max(200).optional(),
        })
      )
      .query(({ ctx, input }) => listProcessInstances(ctx.user, input)),
    calendar: protectedProcedure
      .input(z.object({ month: z.coerce.date() }))
      .query(({ ctx, input }) => getTaskCalendar(ctx.user, input.month)),
    get: protectedProcedure
      .input(z.object({ taskId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const task = await getWorkflowTask(ctx.user, input.taskId);
        if (!task) throw new Error("人工任务不存在或无访问权限。 ");
        return task;
      }),
    signalMessage: protectedProcedure
      .input(
        z.object({
          runId: z.string().min(8).max(64),
          messageName: z.string().trim().min(1).max(128),
          correlationKey: z.string().min(1).max(255),
          payload: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            String(run.workflowId),
            "workflow:run"
          ))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权触发此流程消息。",
          });
        assertWorkflowRunController(ctx.user, run, "触发此流程消息");
        const result = await signalWorkflowMessage(input);
        wakeWorkflowWorker();
        return result;
      }),
    assignees: protectedProcedure
      .input(z.object({ taskId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        listWorkflowTaskAssignees(ctx.user, input.taskId)
      ),
    claim: protectedProcedure
      .input(z.object({ taskId: z.string().uuid() }))
      .mutation(({ ctx, input }) => claimWorkflowTask(ctx.user, input.taskId)),
    complete: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          result: approvalResultSchema,
        })
      )
      .mutation(({ ctx, input }) =>
        completeWorkflowTask(ctx.user, input.taskId, input.result)
      ),
    execute: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          result: approvalResultSchema,
        })
      )
      .mutation(({ ctx, input }) =>
        executeWorkflowTask(ctx.user, input.taskId, input.result)
      ),
    handover: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          targetUserId: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) => handoverWorkflowTask(ctx.user, input)),
    delegate: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          targetUserId: z.number().int().positive(),
        })
      )
      .mutation(({ ctx, input }) => delegateWorkflowTask(ctx.user, input)),
    addSigner: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          targetUserId: z.number().int().positive(),
          memberVersion: z.number().int().nonnegative(),
        })
      )
      .mutation(({ ctx, input }) => addWorkflowTaskSigner(ctx.user, input)),
    removeSigner: protectedProcedure
      .input(
        z.object({
          taskId: z.string().uuid(),
          memberTaskId: z.string().uuid(),
          memberVersion: z.number().int().nonnegative(),
        })
      )
      .mutation(({ ctx, input }) => removeWorkflowTaskSigner(ctx.user, input)),
    returnToPending: protectedProcedure
      .input(z.object({ taskId: z.string().uuid() }))
      .mutation(({ ctx, input }) =>
        returnWorkflowTaskToPending(ctx.user, input.taskId)
      ),
    batchClaim: protectedProcedure
      .input(z.object({ taskIds: z.array(z.string().uuid()).min(1).max(20) }))
      .mutation(({ ctx, input }) =>
        batchClaimWorkflowTasks(ctx.user, Array.from(new Set(input.taskIds)))
      ),
    batchComplete: protectedProcedure
      .input(
        z.object({
          taskIds: z.array(z.string().uuid()).min(1).max(20),
          result: approvalResultSchema,
        })
      )
      .mutation(({ ctx, input }) =>
        batchCompleteWorkflowTasks(
          ctx.user,
          Array.from(new Set(input.taskIds)),
          input.result
        )
      ),
  }),
  config: router({
    publicGeneral: publicProcedure.query(() => getPublicGeneralSettings()),
    runtimeInfo: adminProcedure.query(() => getRuntimeInfo()),
    settings: adminProcedure.query(() => getP1SystemSettings()),
    updateSetting: adminProcedure
      .input(
        z.object({
          key: z.enum(["general", "approval"]),
          value: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(({ ctx, input }) =>
        updateP1SystemSetting(ctx.user, input.key, input.value)
      ),
    workDomains: adminProcedure.query(() => listWorkDomains()),
    createWorkDomain: adminProcedure
      .input(
        z.object({
          code: z.string().trim().min(2).max(64),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createWorkDomain(ctx.user, input),
      })),
    updateWorkDomain: adminProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateWorkDomain(ctx.user, input),
      })),
    organization: iamManageProcedure.query(() => listOrganization()),
    createOrganizationUnit: iamManageProcedure
      .input(
        z.object({
          code: z.string().trim().min(2).max(64),
          name: z.string().trim().min(1).max(160),
          parentUnitId: z.string().uuid().nullable().optional(),
          managerUserId: z.number().int().positive().nullable().optional(),
          unitType: z.string().trim().max(64).nullable().optional(),
          unitLevel: z.number().int().min(1).max(99).nullable().optional(),
          standardCode: z.string().trim().max(96).nullable().optional(),
          areaCode: z.string().trim().max(96).nullable().optional(),
          category: z.string().trim().max(96).nullable().optional(),
          sortOrder: z.number().int().min(-999999).max(999999).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createOrganizationUnit(ctx.user, input),
      })),
    updateOrganizationUnit: iamManageProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(160).optional(),
          parentUnitId: z.string().uuid().nullable().optional(),
          managerUserId: z.number().int().positive().nullable().optional(),
          unitType: z.string().trim().max(64).nullable().optional(),
          unitLevel: z.number().int().min(1).max(99).nullable().optional(),
          standardCode: z.string().trim().max(96).nullable().optional(),
          areaCode: z.string().trim().max(96).nullable().optional(),
          category: z.string().trim().max(96).nullable().optional(),
          sortOrder: z.number().int().min(-999999).max(999999).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          status: z.enum(["active", "disabled"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await updateOrganizationUnit(ctx.user, input),
      })),
    assignOrganizationMember: iamManageProcedure
      .input(
        z.object({
          unitId: z.string().uuid(),
          userId: z.number().int().positive(),
          title: z.string().trim().max(160).optional(),
          isPrimary: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await assignOrganizationMember(ctx.user, input),
      })),
    removeOrganizationMember: iamManageProcedure
      .input(
        z.object({
          unitId: z.string().uuid(),
          userId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await removeOrganizationMember(ctx.user, input),
      })),
    setPrimaryOrganizationMembership: iamManageProcedure
      .input(
        z.object({
          unitId: z.string().uuid(),
          userId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await setPrimaryOrganizationMembership(ctx.user, input),
      })),
    moveOrganizationMember: iamManageProcedure
      .input(
        z.object({
          fromUnitId: z.string().uuid(),
          toUnitId: z.string().uuid(),
          userId: z.number().int().positive(),
          title: z.string().trim().max(160).optional(),
          makePrimary: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await moveOrganizationMember(ctx.user, input),
      })),
    deleteOrganizationUnit: iamManageProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => ({
        success: await deleteOrganizationUnit(ctx.user, input),
      })),
    bindOrganizationRole: iamManageProcedure
      .input(
        z.object({
          unitId: z.string().uuid(),
          roleId: z.number().int().positive(),
          includeDescendants: z.boolean().default(true),
          effectiveFrom: z.date().optional(),
          expiresAt: z.date().nullable().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await bindOrganizationRole(ctx.user, input),
      })),
    unbindOrganizationRole: iamManageProcedure
      .input(
        z.object({
          unitId: z.string().uuid(),
          roleId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        success: await unbindOrganizationRole(ctx.user, input),
      })),
  }),
  workflow: router({
    list: protectedProcedure.query(({ ctx }) => listWorkflows(ctx.user)),
    archived: protectedProcedure
      .input(z.object({ projectId: z.string().min(8).max(64) }))
      .query(({ ctx, input }) =>
        listArchivedWorkflows(ctx.user, input.projectId)
      ),
    get: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .query(async ({ ctx, input }) => {
        const workflow = await getWorkflow(input.id, ctx.user);
        if (!workflow) throw new Error("流程不存在或无访问权限。");
        return workflow;
      }),
    compile: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          definition: z.unknown().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await compileWorkflowDraft(
          input.id,
          ctx.user,
          input.definition
        );
        if (!result) throw new Error("流程不存在或无发布权限。");
        return result;
      }),
    previewParticipants: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          config: z.record(z.string(), z.unknown()),
          initiatorUserId: z.number().int().positive().optional(),
          senderUserId: z.number().int().positive().optional(),
          formData: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:edit"
          ))
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权预览该流程的参与人。",
          });
        const initiatorUserId = input.initiatorUserId ?? ctx.user.id;
        return resolveOperateAssignees({
          workflowId: input.workflowId,
          config: input.config,
          context: {
            input: input.formData ?? {},
            vars: {},
            nodes: {},
            runtime: {
              triggeredByUserId: initiatorUserId,
              lastActorUserId: input.senderUserId ?? initiatorUserId,
              receiverUserIds: [],
            },
          },
        });
      }),
    access: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .query(({ ctx, input }) => getWorkflowAccess(ctx.user, input.id)),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          description: z.string().max(1200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        createWorkflow(ctx.user, input.name, input.description)
      ),
    update: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          definition: z.unknown().optional(),
          expectedDefinitionVersion: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const workflow = await updateWorkflow(input.id, ctx.user, input);
          if (!workflow) throw new Error("流程不存在或无编辑权限。");
          return workflow;
        } catch (error) {
          return throwWorkflowMutationError(error);
        }
      }),
    publish: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          definition: z.unknown().optional(),
          expectedDefinitionVersion: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const workflow = await updateWorkflow(input.id, ctx.user, {
            name: input.name,
            definition: input.definition,
            expectedDefinitionVersion: input.expectedDefinitionVersion,
            publish: true,
          });
          if (!workflow) throw new Error("流程不存在或无发布权限。");
          return workflow;
        } catch (error) {
          return throwWorkflowMutationError(error);
        }
      }),
    unpublish: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          expectedDefinitionVersion: z.number().int().positive().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const workflow = await updateWorkflow(input.id, ctx.user, {
            expectedDefinitionVersion: input.expectedDefinitionVersion,
            unpublish: true,
          });
          if (!workflow) throw new Error("流程不存在或无取消发布权限。");
          return workflow;
        } catch (error) {
          return throwWorkflowMutationError(error);
        }
      }),
    duplicate: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const workflow = await duplicateWorkflow(
          input.id,
          ctx.user,
          input.name
        );
        if (!workflow) throw new Error("流程不存在或无查看权限。");
        return workflow;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const archived = await archiveWorkflow(input.id, ctx.user);
        if (!archived) throw new Error("流程不存在或无归档权限。");
        return { success: true, archived: true };
      }),
    restore: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const restored = await restoreWorkflow(input.id, ctx.user);
        if (!restored) throw new Error("流程不存在、未归档或无恢复权限。");
        return { success: true };
      }),
    versions: protectedProcedure
      .input(z.object({ workflowId: z.string().min(8).max(64) }))
      .query(async ({ ctx, input }) => {
        const versions = await listWorkflowVersions(input.workflowId, ctx.user);
        if (!versions) throw new Error("无权查看流程版本。");
        return versions;
      }),
    versionDiff: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          fromVersion: z.number().int().positive(),
          toVersion: z.number().int().positive(),
        })
      )
      .query(async ({ ctx, input }) => {
        const diff = await diffWorkflowVersions(
          input.workflowId,
          input.fromVersion,
          input.toVersion,
          ctx.user
        );
        if (!diff) throw new Error("流程版本不存在或无查看权限。");
        return diff;
      }),
    rollbackVersion: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          targetVersion: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const workflow = await rollbackWorkflowVersion(
          input.workflowId,
          input.targetVersion,
          ctx.user
        );
        if (!workflow) throw new Error("流程版本不存在或无恢复权限。");
        return workflow;
      }),
    members: protectedProcedure
      .input(z.object({ workflowId: z.string().min(8).max(64) }))
      .query(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:view"
          ))
        )
          throw new Error("无权查看流程成员。");
        return listWorkflowMembers(input.workflowId);
      }),
    memberCandidates: protectedProcedure
      .input(z.object({ workflowId: z.string().min(8).max(64) }))
      .query(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:members:manage"
          ))
        )
          throw new Error("无权管理流程成员。");
        return listActiveUsersForWorkflowAssignment();
      }),
    grantMember: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          userId: z.number().int().positive(),
          role: z.enum(["owner", "editor", "operator", "viewer"]),
          expiresAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:members:manage"
          ))
        )
          throw new Error("无权管理流程成员。");
        try {
          await grantWorkflowMember({ ...input, grantedByUserId: ctx.user.id });
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error ? error.message : "成员授权参数无效。",
          });
        }
        return { success: true };
      }),
    revokeMember: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          userId: z.number().int().positive(),
          role: z.enum(["owner", "editor", "operator", "viewer"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:members:manage"
          ))
        )
          throw new Error("无权管理流程成员。");
        await revokeWorkflowMember({ ...input, revokedByUserId: ctx.user.id });
        return { success: true };
      }),
    runtimeModels: protectedProcedure.query(async () => getRuntimeModels()),
    templates: protectedProcedure.query(({ ctx }) =>
      listNodeTemplates(ctx.user)
    ),
    createTemplate: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(500).optional(),
          nodeType: z.enum(["llm", "http", "transform", "condition"]),
          config: z.record(z.string(), z.unknown()),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createNodeTemplate(ctx.user, input),
      })),
    updateTemplate: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!(await updateNodeTemplate(ctx.user, input)))
          throw new Error("节点模板不存在或无编辑权限。");
        return { success: true };
      }),
    deleteTemplate: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await deleteNodeTemplate(ctx.user, input.id)))
          throw new Error("节点模板不存在或无删除权限。");
        return { success: true };
      }),
    subflows: protectedProcedure.query(({ ctx }) => listSubflows(ctx.user)),
    createSubflow: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(500).optional(),
          definition: z.unknown(),
        })
      )
      .mutation(async ({ ctx, input }) => ({
        id: await createSubflow(ctx.user, input),
      })),
    updateSubflow: protectedProcedure
      .input(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().trim().min(1).max(160).optional(),
          description: z.string().trim().max(500).nullable().optional(),
          definition: z.unknown().optional(),
          isEnabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!(await updateSubflow(ctx.user, input)))
          throw new Error("子流程不存在或无编辑权限。");
        return { success: true };
      }),
    deleteSubflow: protectedProcedure
      .input(z.object({ id: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        if (!(await deleteSubflow(ctx.user, input.id)))
          throw new Error("子流程不存在或无删除权限。");
        return { success: true };
      }),
    run: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          input: z.record(z.string(), z.unknown()).optional(),
          idempotencyKey: z.string().trim().min(8).max(128).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:run"
          ))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权运行此流程。",
          });
        }
        return submitWorkflowRun({
          workflowId: input.workflowId,
          triggeredBy: ctx.user,
          workflowInput: input.input,
          idempotencyKey: input.idempotencyKey,
          requestId: ctx.requestId,
        });
      }),
    cancelRun: protectedProcedure
      .input(z.object({ runId: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            String(run.workflowId),
            "workflow:run"
          ))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权取消此流程运行。",
          });
        }
        assertWorkflowRunController(ctx.user, run, "取消此流程运行");
        return controlWorkflowRun({ runId: input.runId, action: "cancel" });
      }),
    terminateRun: protectedProcedure
      .input(
        z.object({
          runId: z.string().min(8).max(64),
          reason: z.string().trim().min(1).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            String(run.workflowId),
            "workflow:run"
          ))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权终止此流程运行。",
          });
        }
        assertWorkflowRunController(ctx.user, run, "终止此流程运行");
        return controlWorkflowRun({
          runId: input.runId,
          action: "terminate",
          reason: input.reason,
        });
      }),
    pauseRun: protectedProcedure
      .input(z.object({ runId: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            String(run.workflowId),
            "workflow:run"
          ))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权暂停此流程运行。",
          });
        }
        assertWorkflowRunController(ctx.user, run, "暂停此流程运行");
        return pauseWorkflowRun(input.runId);
      }),
    resumeRun: protectedProcedure
      .input(z.object({ runId: z.string().min(8).max(64) }))
      .mutation(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            String(run.workflowId),
            "workflow:run"
          ))
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权恢复此流程运行。",
          });
        }
        assertWorkflowRunController(ctx.user, run, "恢复此流程运行");
        return resumeWorkflowRun(input.runId);
      }),
    runs: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          status: z
            .enum([
              "queued",
              "running",
              "waiting",
              "blocked",
              "success",
              "failed",
              "cancelled",
              "terminated",
            ])
            .optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          triggeredByUserId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:view"
          ))
        )
          throw new Error("无权查看流程运行历史。");
        return listWorkflowRuns(input.workflowId, input);
      }),
    runMetrics: protectedProcedure
      .input(
        z.object({
          workflowId: z.string().min(8).max(64),
          status: z
            .enum([
              "queued",
              "running",
              "waiting",
              "blocked",
              "success",
              "failed",
              "cancelled",
              "terminated",
            ])
            .optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          triggeredByUserId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        if (
          !(await hasWorkflowPermission(
            ctx.user,
            input.workflowId,
            "workflow:view"
          ))
        )
          throw new Error("无权查看流程运行分析。");
        return getWorkflowRunMetrics(input.workflowId, input);
      }),
    alerts: protectedProcedure.query(({ ctx }) => listRunAlerts(ctx.user)),
    markAlertRead: protectedProcedure
      .input(z.object({ alertId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => ({
        success: await markRunAlertRead(input.alertId, ctx.user),
      })),
    runDetail: protectedProcedure
      .input(z.object({ runId: z.string().min(8).max(64) }))
      .query(async ({ ctx, input }) => {
        const run = await getWorkflowRun(input.runId);
        if (
          !run ||
          !(await hasWorkflowPermission(
            ctx.user,
            run.workflowId,
            "workflow:view"
          ))
        )
          throw new Error("运行记录不存在或无访问权限。");
        return run;
      }),
  }),
});

export type AppRouter = typeof appRouter;
