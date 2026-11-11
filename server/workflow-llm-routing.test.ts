import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), invoke: vi.fn() }));
vi.mock("./db", () => ({ getSharedPool: () => ({
  query: mocks.query,
  getConnection: async () => ({ query: mocks.query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }),
}) }));
vi.mock("./llm-configuration", () => ({
  resolveLlmConnection: async () => ({ defaultModel: "fixture-model" }),
  getLlmConfiguration: vi.fn(),
}));
vi.mock("./_core/llm", () => ({
  invokeLLM: mocks.invoke,
  listLLMModels: async () => ({ data: [{ id: "fixture-model" }] }),
}));
import { executeRunSegment } from "./workflow-engine";

beforeEach(() => {
  vi.resetAllMocks();
  let sequence = 0;
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("nextNodeSequence=LAST_INSERT_ID")) sequence++;
    if (sql.includes("SELECT LAST_INSERT_ID()")) return [[{ sequenceNo: sequence }]];
    return sql.startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }];
  });
});

it.each(["success", "provider-error", "validation-error"])(
  "LLM %s executes only its matching output branch",
  async scenario => {
    if (scenario === "provider-error") mocks.invoke.mockRejectedValue(new Error("provider unavailable"));
    else mocks.invoke.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ currency: scenario === "validation-error" ? "USD" : "CNY" }) } }] });
    const context: any = { input: {}, vars: {}, nodes: {}, runtime: {} };
    const node = (id: string, type: string, config = {}) => ({ id, name: id, type, config });
    const result = await executeRunSegment({
      runId: "llm-route-run", workflow: { id: "flow", ownerUserId: 1 } as any,
      definition: {
        nodes: [
          node("llm", "llm", {
            prompt: "合成币种", failureHandle: "invalid_invoice",
            outputSchema: { name: "invoice", schema: { type: "object", properties: { currency: { type: "string" } }, required: ["currency"] } },
            governance: { deterministicValidation: { allowedValues: { currency: ["CNY"] } } },
          }),
          node("normal", "transform", { mappings: { disposition: "ready" } }),
          node("failure", "transform", { mappings: { disposition: "held" } }),
          node("end", "end"),
        ],
        edges: [
          { sourceNodeId: "llm", sourceHandle: "default", targetNodeId: "normal" },
          { sourceNodeId: "llm", sourceHandle: "invalid_invoice", targetNodeId: "failure" },
          { sourceNodeId: "normal", targetNodeId: "end" },
          { sourceNodeId: "failure", targetNodeId: "end" },
        ],
      } as any, context, queue: ["llm"],
    });
    expect(result.status).toBe("success");
    expect(Object.keys(context.nodes)).toEqual(["llm", scenario === "success" ? "normal" : "failure", "end"]);
    if (scenario === "validation-error") expect(context.nodes.llm.message).toContain("LLM 确定性校验字段 currency 不在允许值中。");
  }
);
