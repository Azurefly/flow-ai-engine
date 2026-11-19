import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { assistantRouter } from "./assistant-router";
import { createAssistantSession, getAssistantSession } from "./assistant-store";
import { getWorkflow } from "./workflow-service";

vi.mock("./assistant-store", async original => ({
  ...(await original<typeof import("./assistant-store")>()),
  createAssistantSession: vi.fn(),
  getAssistantSession: vi.fn(),
}));
vi.mock("./workflow-service", async original => ({
  ...(await original<typeof import("./workflow-service")>()),
  getWorkflow: vi.fn(),
}));

const user = { id: 123, role: "admin" };
const caller = assistantRouter.createCaller({ user } as TrpcContext);
const sessionId = "4f765b14-c21f-4ff1-b86d-5769f1770399";
const saved = {
  id: sessionId,
  title: "试聊",
  agentId: "flow-assistant",
  trial: true,
  projectId: "project123",
  workflowId: "workflow123",
  configVersion: 7,
  revision: 2,
  config: { name: "试聊助手", instructions: "fixture-private" },
  messages: [],
  task: null,
  updatedAt: "2026-01-01T00:00:00Z",
};
beforeEach(() => vi.resetAllMocks());

it("passes a client session UUID, observed draft version and resolved workflow project to storage", async () => {
  vi.mocked(getWorkflow).mockResolvedValue({
    projectId: "project123",
  } as Awaited<ReturnType<typeof getWorkflow>>);
  vi.mocked(createAssistantSession).mockResolvedValue(
    saved as Awaited<ReturnType<typeof createAssistantSession>>
  );
  const result = await caller.start({
    sessionId,
    expectedConfigVersion: 7,
    agentId: "flow-assistant",
    preview: true,
    context: { workflowId: "workflow123" },
  });
  expect(createAssistantSession).toHaveBeenCalledWith(
    user,
    true,
    undefined,
    "project123",
    "flow-assistant",
    "workflow123",
    { sessionId, expectedConfigVersion: 7 }
  );
  expect(result.id).toBe(sessionId);
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  await expect(
    caller.start({ sessionId: "x".repeat(48), agentId: "flow-assistant" })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.start({
      sessionId,
      agentId: "flow-assistant",
      context: { workflowId: "workflow123", projectId: "project-other" },
    })
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(createAssistantSession).toHaveBeenCalledTimes(1);
});

it("reports the committed state of the requested operation under the signed-in account", async () => {
  const requestId = "a".repeat(48);
  vi.mocked(getAssistantSession).mockResolvedValue({
    ...saved,
    requestCommitted: false,
  } as Awaited<ReturnType<typeof getAssistantSession>>);
  const result = await caller.get({ sessionId, requestId });
  expect(getAssistantSession).toHaveBeenCalledWith(user, sessionId, requestId, undefined);
  expect(result.requestCommitted).toBe(false);
  expect(await caller.get({ sessionId })).not.toHaveProperty(
    "requestCommitted"
  );
});
