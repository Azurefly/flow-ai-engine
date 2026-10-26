import { TRPCError } from "@trpc/server";

export function assertRunPreflightRevision(
  currentVersion: number,
  planHash: string,
  expected: {
    expectedDefinitionVersion?: number;
    expectedExecutionPlanHash?: string;
  }
) {
  if (
    (expected.expectedDefinitionVersion !== undefined &&
      currentVersion !== expected.expectedDefinitionVersion) ||
    (expected.expectedExecutionPlanHash !== undefined &&
      planHash !== expected.expectedExecutionPlanHash)
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "运行版本已变化，本次未创建实例，请重新检查运行条件。",
    });
}
