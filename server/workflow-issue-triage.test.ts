import { expect, it } from "vitest";
import { compileWorkflowDefinition } from "./workflow-compiler";
import { createDefaultNodeConfig } from "../shared/workflow-node-contract";

it.each(["rest", "method"] as const)(
  "HTTP 到 LLM 再到 %s 的流程可以编译执行计划",
  target => {
    const types = ["start", "http", "llm", target, "end"] as const;
    const definition = {
      schemaVersion: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      nodes: types.map((type, index) => ({
        id: `node-${index}`,
        type,
        name: type,
        position: { x: index * 300, y: 0 },
        config: {
          ...createDefaultNodeConfig(type),
          ...(type === "http"
            ? { url: "https://example.com/issues", method: "GET" }
            : {}),
          ...(["rest", "method"].includes(type)
            ? { restApi: "https://example.com/status", restType: "GET" }
            : {}),
        },
      })),
      edges: types
        .slice(1)
        .map((_, index) => ({
          id: `edge-${index}`,
          sourceNodeId: `node-${index}`,
          targetNodeId: `node-${index + 1}`,
          sourceHandle: "default",
        })),
    };
    expect(() =>
      compileWorkflowDefinition(definition, { flowType: "control" })
    ).not.toThrow();
  }
);
