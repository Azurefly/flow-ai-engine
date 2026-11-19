import { TRPCError } from "@trpc/server";

/** Only the human task submission endpoints use this response boundary. */
export function throwTaskSubmissionError(cause: unknown): never {
  if (cause instanceof TRPCError && cause.code !== "INTERNAL_SERVER_ERROR") throw cause;
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "暂时无法提交办理结果。填写内容已保留，请稍后重试。",
    cause,
  });
}
