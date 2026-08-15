import { parse } from "cookie";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createUser, ensureBootstrapAdmin, FLOW_SESSION_COOKIE, listUsers, login, logout, setUserStatus } from "./internal-auth";
import { createWorkflow, getWorkflow, listWorkflows, updateWorkflow } from "./workflow-service";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    bootstrapStatus: publicProcedure.query(async () => { await ensureBootstrapAdmin(); return { configured: Boolean(process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME && process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD) }; }),
    me: publicProcedure.query(async ({ ctx }) => { await ensureBootstrapAdmin(); return ctx.user; }),
    login: publicProcedure.input(z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(12).max(256) })).mutation(async ({ ctx, input }) => {
      const result = await login(input.username, input.password, ctx.req.headers["user-agent"]);
      if (!result) throw new Error("用户名或密码错误，或账号已停用。");
      ctx.res.cookie(FLOW_SESSION_COOKIE, result.token, { ...getSessionCookieOptions(ctx.req), httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
      return result.user;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await logout(parse(ctx.req.headers.cookie ?? "")[FLOW_SESSION_COOKIE]);
      ctx.res.clearCookie(FLOW_SESSION_COOKIE, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  iam: router({
    users: adminProcedure.query(() => listUsers()),
    createUser: adminProcedure.input(z.object({ username: z.string().trim().min(3).max(64), password: z.string().min(12).max(256), name: z.string().trim().min(1).max(160), email: z.string().email().optional(), role: z.enum(["user", "admin"]).default("user") })).mutation(async ({ input }) => { await createUser(input); return { success: true }; }),
    updateUserStatus: adminProcedure.input(z.object({ userId: z.number().int().positive(), status: z.enum(["active", "disabled"]) })).mutation(async ({ input }) => { await setUserStatus(input.userId, input.status); return { success: true }; }),
  }),
  workflow: router({
    list: protectedProcedure.query(({ ctx }) => listWorkflows(ctx.user.id)),
    get: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).query(async ({ ctx, input }) => { const workflow = await getWorkflow(input.id, ctx.user.id); if (!workflow) throw new Error("流程不存在或无访问权限。"); return workflow; }),
    create: protectedProcedure.input(z.object({ name: z.string().trim().min(1).max(160), description: z.string().max(1200).optional() })).mutation(async ({ ctx, input }) => createWorkflow(ctx.user.id, input.name, input.description)),
    update: protectedProcedure.input(z.object({ id: z.string().min(8).max(64), name: z.string().trim().min(1).max(160).optional(), definition: z.unknown().optional() })).mutation(async ({ ctx, input }) => { const workflow = await updateWorkflow(input.id, ctx.user.id, input); if (!workflow) throw new Error("流程不存在或无访问权限。"); return workflow; }),
    publish: protectedProcedure.input(z.object({ id: z.string().min(8).max(64) })).mutation(async ({ ctx, input }) => { const workflow = await updateWorkflow(input.id, ctx.user.id, { publish: true }); if (!workflow) throw new Error("流程不存在或无访问权限。"); return workflow; }),
  }),
});

export type AppRouter = typeof appRouter;
