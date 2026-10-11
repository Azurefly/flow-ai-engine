import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const router = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
it("登录与当前账号均使用白名单投影", () => {
  expect(router).toContain("return publicAuthAccount(ctx.user)");
  expect(router).toContain("return publicAuthAccount(result.user)");
});
it("身份与组织入口按有效能力开放，普通身份管理员不进入账号类型限定的全局设置", () => {
  expect(home).toContain("const canManageIdentity = user.canManageIdentity");
  expect(home).toContain(
    'const systemRootView = user.role === "admin" ? "config" : "identity"'
  );
  expect(home).toContain('systemView === "identity" && canManageIdentity');
  expect(home).toContain("if (!canManageIdentity)");
  expect(home).toContain(
    'route.view === "config" && systemRootView === "identity"'
  );
  expect(home).toContain("...(canManageIdentity");
  expect(home).toContain(
    'user.role === "admin" &&\n            systemView === "config"'
  );
  expect(home).toContain("query.state.data ? 30_000 : false");
});
it("权限详情显示服务端来源说明，不猜测组织或流程授权", () => {
  expect(home).toContain("data.authorizationSummary");
  expect(home).toContain('permission.sourceLabels?.join("；")');
});
