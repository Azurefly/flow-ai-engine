import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAllowedHttpPort } from "./http-target-policy";
import { assertSafeHttpUrl } from "./workflow-engine";
import { normalizeServiceEndpointDefinition } from "./service-endpoint-service";

afterEach(() => vi.unstubAllEnvs());
describe("自建 HTTP 服务的精确源站授权", () => {
  it("非标准端口默认拒绝，配置不能使用通配、路径或内嵌凭据", () => {
    for (const value of [
      "",
      "*",
      "http://example.com:3000/api",
      "http://user:pass@example.com:3000",
    ]) {
      vi.stubEnv("FLOW_HTTP_ALLOWED_ORIGINS", value);
      expect(() =>
        assertAllowedHttpPort(new URL("http://example.com:3000/api"))
      ).toThrow("FLOW_HTTP_ALLOWED_ORIGINS");
    }
  });
  it("登记与运行检查共享精确的协议、主机、端口边界", async () => {
    vi.stubEnv("FLOW_HTTP_ALLOWED_ORIGINS", "http://1.1.1.1:3000");
    expect(
      normalizeServiceEndpointDefinition({
        refCode: "GITEA",
        baseUrl: "http://1.1.1.1:3000/api/v1",
        targetEnvironment: "test",
      }).baseUrl
    ).toContain(":3000/api/v1");
    await expect(
      assertSafeHttpUrl("http://1.1.1.1:3000/api/v1/version")
    ).resolves.toBeInstanceOf(URL);
    for (const address of [
      "https://1.1.1.1:3000",
      "http://1.1.1.1:3001",
      "http://1.1.1.2:3000",
    ])
      expect(() => assertAllowedHttpPort(new URL(address))).toThrow("网络策略");
  });
  it("额外源站授权不能绕过私网和环回地址保护", async () => {
    vi.stubEnv(
      "FLOW_HTTP_ALLOWED_ORIGINS",
      "http://127.0.0.1:3000,http://10.0.0.1:3000"
    );
    await expect(assertSafeHttpUrl("http://127.0.0.1:3000")).rejects.toThrow(
      "拒绝"
    );
    await expect(assertSafeHttpUrl("http://10.0.0.1:3000")).rejects.toThrow(
      "拒绝"
    );
  });
});
