import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const submit = vi.hoisted(() => vi.fn());
vi.mock("./p1-service", async importOriginal => ({
  ...(await importOriginal<typeof import("./p1-service")>()),
  executeWorkflowTask: submit,
  completeWorkflowTask: submit,
}));
import { appRouter } from "./routers";

beforeEach(() => submit.mockReset());

async function invoke(path: string, loggedIn = true) {
  const context = { user: loggedIn ? { id: 1, role: "user" } : null } as TrpcContext;
  let diagnostic: TRPCError | undefined;
  const response = await fetchRequestHandler({
    router: appRouter,
    endpoint: "/trpc",
    req: new Request("http://localhost/trpc/task." + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { taskId: "e7b51fca-73b2-4885-853e-b3f3fed80f22", result: { decision: "approved" } } }),
    }),
    createContext: () => context,
    onError({ error }) { diagnostic = error; },
  });
  return { status: response.status, body: await response.text(), diagnostic };
}

it.each(["execute", "complete"])("%s 的未知异常在 HTTP 边界隐藏内部消息，诊断保留原始原因", async path => {
  for (const cause of [
    new Error("SYNTHETIC_INTERNAL_DETAIL"),
    new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "SYNTHETIC_INTERNAL_DETAIL" }),
  ]) {
    submit.mockRejectedValueOnce(cause);
    const response = await invoke(path);
    expect(response.status).toBe(500);
    expect(response.body).not.toContain("SYNTHETIC_INTERNAL_DETAIL");
    expect(JSON.parse(response.body).error.json.message).toBe("暂时无法提交办理结果。填写内容已保留，请稍后重试。");
    expect(response.diagnostic?.cause).toBe(cause);
  }
});

it.each(["BAD_REQUEST", "FORBIDDEN", "CONFLICT"] as const)("%s 保留业务错误与响应分类", async code => {
  const cause = new TRPCError({ code, message: "合成业务拒绝" });
  submit.mockRejectedValueOnce(cause);
  const response = await invoke("execute");
  expect(response.status).toBe({ BAD_REQUEST: 400, FORBIDDEN: 403, CONFLICT: 409 }[code]);
  expect(JSON.parse(response.body).error.json.message).toBe(cause.message);
  expect(response.diagnostic).toBe(cause);
});

it("未登录继续由办理前的身份中间件拒绝", async () => {
  expect((await invoke("complete", false)).status).toBe(401);
  expect(submit).not.toHaveBeenCalled();
});
