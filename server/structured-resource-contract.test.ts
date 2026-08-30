import { describe, expect, it } from "vitest";
import { buildDataSourceCreateInput } from "../client/src/components/StructuredResourceForm";

describe("结构化数据源表单契约", () => {
  it("将凭据引用映射到服务端要求的顶层 credentialRef", () => {
    expect(
      buildDataSourceCreateInput("project-1", {
        name: "订单 API",
        sourceType: "api",
        description: "只读订单接口",
        endpoint: "https://example.invalid/orders",
        credentialReference: "  orders-read  ",
      })
    ).toEqual({
      projectId: "project-1",
      name: "订单 API",
      sourceType: "api",
      connection: {
        description: "只读订单接口",
        endpoint: "https://example.invalid/orders",
        credentialReference: "orders-read",
      },
      credentialRef: "orders-read",
    });
  });

  it("不为未填写的可选字段伪造凭据引用或地址", () => {
    expect(
      buildDataSourceCreateInput("project-1", {
        name: "内联样本",
        sourceType: "inline",
        description: "本地样本",
        endpoint: "",
        credentialReference: "   ",
      })
    ).toMatchObject({
      credentialRef: undefined,
      connection: {
        endpoint: undefined,
        credentialReference: undefined,
      },
    });
  });
});
