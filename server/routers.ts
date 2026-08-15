import { parse } from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createUser, ensureBootstrapAdmin, FLOW_SESSION_COOKIE, listUsers, login, logout, setUserStatus } from "./internal-auth";
import { assignRole, createCustomRole, deleteCustomRole, getWorkflowAccess, grantWorkflowMember, listActiveUsersForWorkflowAssignment, listAuthorizationAudit, listRoles, listWorkflowMembers, recordAuthorizationAudit, revokeRoleAssignment, revokeWorkflowMember, updateCustomRole } from "./iam-service";
import { executeWorkflow, getRuntimeModels, getWorkflowRun, listWorkflowRuns } from "./workflow-engine";
import { createWorkflow, deleteWorkflow, duplicateWorkflow, getWorkflow, hasWorkflowPermission, listWorkflows, updateWorkflow } from "./workflow-service";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    bootstrapStatus: publicProcedure.query(async () => { await ensureBootstrapAdmin(); return { configured: Boolean(process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME && process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD) }; }),
    me: publicProcedure.query(async ({ ctx }) => { await ensureBootstrapAdmin(); return ctx.user; }),
    login: publicProcedure.input(z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(12).max(256) })).mutation(async ({ ctx, input }) => {
      const result = await login(input.username, input.password, ctx.req.headers["user-agent"]);
      if (!result) throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误，或账号已停用。" });
      ctx.res.cookie(FLOW_SESSION_COOKIE, result.token, { ...getSessionCookieOptions(ctx.req), httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
      return result.user;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await logout(parse(ctx.req.headers.cookie ?? "")[FLOW_SESSION_COOKIE], ctx.user?.id);
      ctx.res.clearCookie(FLOW_SESSION_COOKIE, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  iam: router({
    users: adminProcedure.query(() => listUsers()),
    createUser: adminProcedure.input(z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(12).max(256), name: z.string().trim().min(1).max(160), email: z.string().email().optional(), role: z.enum(["user", "admin"]).default("user") })).mutation(async ({ ctx, input }) => { const userId = await createUser(input); await recordAuthorizationAudit({ actorUserId: ctx.user.id, targetUserId: userId, action: "user_created", resourceType: "user", resourceId: String(userId) }); return { success: true }; }),
    updateUserStatus: adminProcedure.input(z.object({ userId: z.number().int().positive(), status: z.enum(["active", "disabled"]) })).mutation(async ({ ctx, input }) => { await setUserStatus(input.userId, input.status); await recordAuthorizationAudit({ actorUserId: ctx.user.id, targetUserId: input.userId, action: input.status === "disabled" ? "user_disabled" : "user_updated", resourceType: "user", resourceId: String(input.userId), details: { status: input.status } }); return { success: true }; }),
    roles: adminProcedure.input(z.object({ scope: z.enum(["system", "workflow"]).optional() }).optional()).query(async ({ input }) => listRoles(input?.scope)),
    assignSystemRole: adminProcedure.input(z.object({ userId: z.number().int().positive(), roleCode: z.string().min(1).max(64), expiresAt: z.date().optional(), note: z.string().max(320).optional() })).mutation(async ({ ctx, input }) => {
      await assignRole({ userId: input.userId, roleCode: input.roleCode, scopeType: "system", grantedByUserId: ctx.user.id, expiresAt: input.expiresAt, note: input.note });
      return { success: true };
    }),
    revokeRoleAssignment: adminProcedure.input(z.object({ assignmentId: z.string().uuid() })).mutation(async ({ ctx, input }) => { await revokeRoleAssignment({ ...input, revokedByUserId: ctx.user.id }); return { success: true }; }),
    createCustomRole: adminProcedure.input(z.object({ code: z.string().min(10).max(68), name: z.string().trim().min(1).max(120), description: z.string().max(2000).optional(), scope: z.enum(["system", "workflow"]), permissions: z.array(z.enum(["workflow:create", "workflow:view", "workflow:edit", "workflow:publish", "workflow:run", "workflow:members:manage", "iam:manage"])).min(1) })).mutation(async ({ ctx, input }) => { await createCustomRole({ ...input, actorUserId: ctx.user.id }); return { success: true }; }),
    updateCustomRole: adminProcedure.input(z.object({ code: z.string().min(10).max(68), name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional(), permissions: z.array(z.enum(["workflow:create", "workflow:view", "workflow:edit", "workflow:publish", "workflow:run", "workflow:members:manage", "iam:manage"])).min(1).optional() })).mutation(async ({ ctx, input }) => { await updateCustomRole({ ...input, actorUserId: ctx.user.id }); return { success: true }; }),
    deleteCustomRole: adminProcedure.input(z.object({ code: z.string().min(10).max(68) })).mutation(async ({ ctx, input }) => { await deleteCustomRole({ ...input, actorUserId: ctx.user.id }); return { success: true }; }),
    authorizationAudit: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional()).query(({ input }) => listAuthorizationAudit(input?.limit)),
  }),
  workflow: router({
    list: protectedProcedure.query(({ ctx }) => listWorkflows(ctx.user)),
    get: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).query(async ({ ctx, input }) => { const workflow = await getWorkflow(input.id, ctx.user); if (!workflow) throw new Error("流程不存在或无访问权限。"); return workflow; }),
    access: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).query(({ ctx, input }) => getWorkflowAccess(ctx.user, input.id)),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(1200).optional() })).mutation(async ({ ctx, input }) => createWorkflow(ctx.user, input.name, input.description)),
    update: protectedProcedure.input(z.object({ id: z.string().min(8).max(64), name: z.string().trim().min(1).max(160).optional(), definition: z.unknown().optional() })).mutation(async ({ ctx, input }) => { const workflow = await updateWorkflow(input.id, ctx.user, input); if (!workflow) throw new Error("流程不存在或无编辑权限。"); return workflow; }),
    publish: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => { const workflow = await updateWorkflow(input.id, ctx.user, { publish: true }); if (!workflow) throw new Error("流程不存在或无发布权限。"); return workflow; }),
    duplicate: protectedProcedure.input(z.object({ id: z.string().min(8).max(64), name: z.string().trim().min(1).max(160).optional() })).mutation(async ({ ctx, input }) => { const workflow = await duplicateWorkflow(input.id, ctx.user, input.name); if (!workflow) throw new Error("流程不存在或无查看权限。"); return workflow; }),
    delete: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => { const deleted = await deleteWorkflow(input.id, ctx.user); if (!deleted) throw new Error("流程不存在或无删除权限。"); return { success: true }; }),
    members: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64) })).query(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:view"))) throw new Error("无权查看流程成员。");
      return listWorkflowMembers(input.workflowId);
    }),
    memberCandidates: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64) })).query(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:members:manage"))) throw new Error("无权管理流程成员。");
      return listActiveUsersForWorkflowAssignment();
    }),
    grantMember: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64), userId: z.number().int().positive(), role: z.enum(["owner", "editor", "operator", "viewer"]), expiresAt: z.date().optional() })).mutation(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:members:manage"))) throw new Error("无权管理流程成员。");
      try {
        await grantWorkflowMember({ ...input, grantedByUserId: ctx.user.id });
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "成员授权参数无效。" });
      }
      return { success: true };
    }),
    revokeMember: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64), userId: z.number().int().positive(), role: z.enum(["owner", "editor", "operator", "viewer"]) })).mutation(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:members:manage"))) throw new Error("无权管理流程成员。");
      await revokeWorkflowMember({ ...input, revokedByUserId: ctx.user.id });
      return { success: true };
    }),
    runtimeModels: protectedProcedure.query(async () => getRuntimeModels()),
    run: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64), input: z.record(z.string(), z.unknown()).optional() })).mutation(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:run"))) throw new Error("无权运行此流程。");
      return executeWorkflow({ workflowId: input.workflowId, triggeredBy: ctx.user, workflowInput: input.input });
    }),
    runs: protectedProcedure.input(z.object({ workflowId: z.string().min(8).max(64) })).query(async ({ ctx, input }) => {
      if (!(await hasWorkflowPermission(ctx.user, input.workflowId, "workflow:view"))) throw new Error("无权查看流程运行历史。");
      return listWorkflowRuns(input.workflowId);
    }),
    runDetail: protectedProcedure.input(z.object({ runId: z.string().min(8).max(64) })).query(async ({ ctx, input }) => {
      const run = await getWorkflowRun(input.runId);
      if (!run || !(await hasWorkflowPermission(ctx.user, run.workflowId, "workflow:view"))) throw new Error("运行记录不存在或无访问权限。");
      return run;
    }),
  }),
});

export type AppRouter = typeof appRouter;
