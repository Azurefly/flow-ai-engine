import { TRPCError } from "@trpc/server";

export const WORKFLOW_RUN_HISTORY_PAGE_SIZE = 25;
export const WORKFLOW_RUN_HISTORY_MAX_PAGE_SIZE = 50;

export type WorkflowRunHistoryCursor = {
  createdAt: Date;
  id: string;
};

type CursorPayload = {
  version: 1;
  createdAt: string;
  id: string;
};

export function encodeWorkflowRunHistoryCursor(
  cursor: WorkflowRunHistoryCursor
) {
  const createdAt = new Date(cursor.createdAt.getTime());
  if (!Number.isFinite(createdAt.getTime()) || cursor.id.length < 8) {
    throw new Error("Cannot encode an invalid workflow run cursor.");
  }

  const payload: CursorPayload = {
    version: 1,
    createdAt: createdAt.toISOString(),
    id: cursor.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeWorkflowRunHistoryCursor(value: string) {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidCursor();
  }

  let payload: unknown;
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw invalidCursor();
    payload = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw invalidCursor();
  }

  if (!payload || typeof payload !== "object") throw invalidCursor();
  const candidate = payload as Partial<CursorPayload>;
  if (
    candidate.version !== 1 ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.id !== "string" ||
    candidate.id.length < 8 ||
    candidate.id.length > 64
  ) {
    throw invalidCursor();
  }

  const createdAt = new Date(candidate.createdAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== candidate.createdAt
  ) {
    throw invalidCursor();
  }

  return { createdAt, id: candidate.id } satisfies WorkflowRunHistoryCursor;
}

function invalidCursor() {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: "运行记录分页位置无效，请刷新后重试。",
  });
}
