import { describe, expect, it } from "vitest";
import { selectWorkflowEndpoint } from "../client/src/components/workflow-endpoint-selection";

describe("流程服务端点选择", () => {
  const endpoints = [
    {
      refCode: "ORDERS",
      status: "active",
      secretRef: "env:FLOW_SECRET_ORDERS",
    },
    { refCode: "PUBLIC", status: "active", secretRef: null },
    { refCode: "OLD", status: "disabled", secretRef: "env:FLOW_SECRET_OLD" },
  ];
  it("切换端点同步凭据引用，并保留请求路径、参数和未知配置", () => {
    const before = {
      endpointRef: "OLD",
      secretRef: "env:FLOW_SECRET_OLD",
      url: "/orders/{{input.id}}",
      method: "POST",
      body: { amount: 20 },
      custom: true,
    };
    expect(selectWorkflowEndpoint(before, "ORDERS", endpoints)).toEqual({
      ...before,
      endpointRef: "ORDERS",
      secretRef: "env:FLOW_SECRET_ORDERS",
    });
    expect(before.endpointRef).toBe("OLD");
  });
  it("无认证或清除端点时清除旧凭据引用，避免跨端点残留", () => {
    const before = {
      endpointRef: "ORDERS",
      secretRef: "env:FLOW_SECRET_ORDERS",
      restApi: "/orders",
    };
    expect(selectWorkflowEndpoint(before, "PUBLIC", endpoints)).toMatchObject({
      endpointRef: "PUBLIC",
      secretRef: "",
      restApi: "/orders",
    });
    expect(selectWorkflowEndpoint(before, "", endpoints)).toMatchObject({
      endpointRef: "",
      secretRef: "",
    });
  });
  it("拒绝停用端点和不属于当前目录的引用", () => {
    expect(() => selectWorkflowEndpoint({}, "OLD", endpoints)).toThrow(
      "已停用"
    );
    expect(() => selectWorkflowEndpoint({}, "FOREIGN", endpoints)).toThrow(
      "不属于当前业务"
    );
  });
});
