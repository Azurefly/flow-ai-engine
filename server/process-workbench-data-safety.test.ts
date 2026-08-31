import { describe, expect, it } from "vitest";
import {
  redactTaskValue,
  taskInputRows,
} from "../client/src/components/ProcessWorkbench";

describe("流程工作台任务申请数据安全", () => {
  it("递归隐藏嵌套凭证与个人敏感字段", () => {
    const value = redactTaskValue({
      metadata: {
        credentials: { apiToken: "fixture-token", password: "fixture-password" },
        connection: { apiToken: "nested-token", safe: "visible" },
        contact: { email: "fixture@example.invalid", phone: "00000000000" },
        safe: "visible",
      },
      items: [{ authorization: "fixture-authorization", name: "item" }],
    }) as any;

    expect(value.metadata.credentials).toBe("[已隐藏]");
    expect(value.metadata.connection).toEqual({
      apiToken: "[已隐藏]",
      safe: "visible",
    });
    expect(value.metadata.contact).toEqual({
      email: "[已隐藏]",
      phone: "[已隐藏]",
    });
    expect(value.metadata.safe).toBe("visible");
    expect(value.items[0]).toEqual({
      authorization: "[已隐藏]",
      name: "item",
    });
  });

  it("序列化申请内容时不会泄露嵌套秘密", () => {
    const rows = taskInputRows({
      payload: {
        context: {
          input: {
            request: {
              credentials: { apiToken: "fixture-token" },
              summary: "visible",
            },
          },
        },
      },
    });
    const request = rows.find(row => row.label === "request");

    expect(request?.value).toContain("[已隐藏]");
    expect(request?.value).not.toContain("fixture-token");
    expect(request?.value).toContain("visible");
  });
});
