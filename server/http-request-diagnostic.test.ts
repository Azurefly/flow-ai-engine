import { expect, it } from "vitest";
import {
  httpResponseDiagnostic,
  httpTransportDiagnostic,
} from "./http-request-diagnostic";
it("区分远端拒绝、端口连接失败与本地策略，不回显请求凭据", () => {
  expect(httpResponseDiagnostic(403, "Forbidden")).toContain(
    "不等同于本地网络策略拦截"
  );
  const error = Object.assign(new Error("request with secret-token"), {
    code: "ECONNRESET",
  });
  const diagnostic = httpTransportDiagnostic(error) as Error;
  expect(diagnostic.message).toContain("ECONNRESET");
  expect(diagnostic.message).not.toContain("secret-token");
  expect(httpResponseDiagnostic(302, "Found")).toContain("不自动跟随");
});
