import { expect, it } from "vitest";
import { withHttpClientIdentity } from "./http-client-headers";
it("默认发送客户端标识，并保留用户指定的大小写无关请求头", () => {
  const headers = { Accept: "application/json" };
  expect(withHttpClientIdentity(headers)).toEqual({
    ...headers,
    "User-Agent": "FlowAIEngine/1.0",
  });
  expect(headers).toEqual({ Accept: "application/json" });
  expect(withHttpClientIdentity({ "user-agent": "custom-client" })).toEqual({
    "user-agent": "custom-client",
  });
});
