import { TRPCError } from "@trpc/server";

export function assertWorkflowRevision(current: number, expected: number) {
  if (!Number.isSafeInteger(expected) || expected < 1 || current !== expected) {
    throw new TRPCError({ code: "CONFLICT", message: `流程版本已变化：当前为 v${current}，本次编辑基于 v${expected}。本次修改尚未保存，请保留修改并读取最新版本后处理。` });
  }
}
