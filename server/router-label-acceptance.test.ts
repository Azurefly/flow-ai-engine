import { afterEach, describe, expect, it, vi } from "vitest";
import {
  routerAcceptanceConfig,
  RouterAcceptanceSession,
} from "../scripts/router-acceptance-safety.mjs";

const validEnv = {
  FLOW_ACCEPTANCE_BASE_URL: "https://acceptance.example.test/",
  FLOW_ACCEPTANCE_CONFIRM_WRITES: "https://acceptance.example.test",
  FLOW_BOOTSTRAP_ADMIN_USERNAME: "fixture-admin",
  FLOW_BOOTSTRAP_ADMIN_PASSWORD: "test-only-password",
};

function response(data: unknown, cookie = "") {
  return {
    ok: true,
    status: 200,
    headers: { getSetCookie: () => (cookie ? [cookie] : []) },
    json: async () => ({ result: { data: { json: data } } }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("路由验收目标与写入确认", () => {
  it("无默认公网目标，确认必须精确绑定目标origin", () => {
    expect(() => routerAcceptanceConfig({})).toThrow("no default target");
    expect(() =>
      routerAcceptanceConfig({
        ...validEnv,
        FLOW_ACCEPTANCE_CONFIRM_WRITES: "1",
      })
    ).toThrow("exact target origin");
    expect(() =>
      routerAcceptanceConfig({
        ...validEnv,
        FLOW_ACCEPTANCE_CONFIRM_WRITES: "https://other.example.test",
      })
    ).toThrow("exact target origin");
    expect(routerAcceptanceConfig(validEnv)).toEqual({
      base: "https://acceptance.example.test",
      username: "fixture-admin",
      password: "test-only-password",
    });
  });

  it.each([
    "not-a-url",
    "file:///tmp/test",
    "https://user:secret@example.test",
    "https://example.test/app",
    "https://example.test/?token=secret",
    "https://example.test/#secret",
    "http://example.test",
    "http://192.0.2.1:1180",
  ])("拒绝不安全或含歧义的地址 %s", target => {
    expect(() =>
      routerAcceptanceConfig({ ...validEnv, FLOW_ACCEPTANCE_BASE_URL: target })
    ).toThrow();
  });

  it.each([
    "http://localhost:1180",
    "http://127.0.0.1:1180",
    "http://[::1]:1180",
  ])("只允许明确确认的本地HTTP %s", target => {
    expect(
      routerAcceptanceConfig({
        ...validEnv,
        FLOW_ACCEPTANCE_BASE_URL: target,
        FLOW_ACCEPTANCE_CONFIRM_WRITES: target,
      }).base
    ).toBe(target);
  });

  it("登录配置不完整时在请求前拒绝", () => {
    expect(() =>
      routerAcceptanceConfig({ ...validEnv, FLOW_BOOTSTRAP_ADMIN_PASSWORD: "" })
    ).toThrow("Missing existing login configuration");
  });

  it("实际脚本在缺少目标时拒绝，连登录请求也不发送", async () => {
    vi.resetModules();
    vi.stubEnv("FLOW_ACCEPTANCE_BASE_URL", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      import("../scripts/router-label-acceptance.mjs")
    ).rejects.toThrow("no default target");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("路由验收请求安全", () => {
  it("拒绝重定向、限制请求时间并只向确认的origin携带会话", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({ ok: true }, "session=fixture-token; HttpOnly; Path=/")
      )
      .mockResolvedValueOnce(response({ id: "run-1" }));
    const session = new RouterAcceptanceSession(
      "https://acceptance.example.test",
      fetch
    );
    await session.request(
      "auth.login",
      { username: "fixture", password: "test-secret" },
      true
    );
    await session.request("workflow.runDetail", { runId: "run-1" });
    const [url, options] = fetch.mock.calls[1];
    expect(url).toMatch(
      /^https:\/\/acceptance\.example\.test\/api\/trpc\/workflow\.runDetail\?input=/
    );
    expect(options).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { cookie: "session=fixture-token" },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { cookie: "" },
    });
  });

  it("网络失败不重试写入，也不回显异常中的秘密", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("test-secret and fixture-token"));
    const session = new RouterAcceptanceSession(
      "https://acceptance.example.test",
      fetch
    );
    await expect(session.request("project.create", {}, true)).rejects.toThrow(
      new Error(
        "project.create: request failed or timed out; inspect recorded fixture IDs before retrying"
      )
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("错误响应不回显服务端文本或凭据", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ...response(null),
      ok: false,
      status: 403,
      json: async () => ({
        error: { json: { message: "test-secret and fixture-token" } },
      }),
    });
    const session = new RouterAcceptanceSession(
      "https://acceptance.example.test",
      fetch
    );
    await expect(session.request("auth.login", {}, true)).rejects.toThrow(
      "auth.login: request rejected (HTTP 403); inspect server logs privately"
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("路由验收场景离线回归", () => {
  it.each([false, true])(
    "保留四个场景且检测错误分支（注入错误=%s）",
    async wrongBranch => {
      vi.resetModules();
      for (const [key, value] of Object.entries(validEnv))
        vi.stubEnv(key, value);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const fixtures: any[] = [];
      const branches = [["end"], ["high"], ["high", "low"], ["fallback"]];
      const fetch = vi.fn(async (url: string, options: RequestInit) => {
        const endpoint = new URL(url).pathname.split("/").at(-1);
        const input = options.body
          ? JSON.parse(String(options.body)).json
          : undefined;
        if (endpoint === "auth.login")
          return response({ ok: true }, "session=fixture-token; HttpOnly");
        if (endpoint === "project.create")
          return response({ id: "fixture-project" });
        if (endpoint === "project.createWorkflow") {
          fixtures.push(input);
          return response({ id: `workflow-${fixtures.length}` });
        }
        if (
          endpoint === "project.auditWorkflow" ||
          endpoint === "workflow.publish"
        )
          return response({ ok: true });
        if (endpoint === "workflow.run")
          return response({ runId: `run-${fixtures.length}` });
        if (endpoint === "workflow.runDetail")
          return response({
            status: "success",
            nodeRuns: (wrongBranch && fixtures.length === 2
              ? ["low"]
              : branches[fixtures.length - 1]
            ).map(nodeId => ({ nodeId, status: "success" })),
          });
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });
      vi.stubGlobal("fetch", fetch);
      const run = import("../scripts/router-label-acceptance.mjs");
      if (wrongBranch) {
        await expect(run).rejects.toThrow();
        expect(fixtures).toHaveLength(2);
      } else {
        await run;
        expect(fixtures).toHaveLength(4);
        expect(
          fixtures
            .slice(1)
            .map(
              f =>
                f.definition.nodes.find((n: any) => n.type === "router").config
                  .broadcast
            )
        ).toEqual([false, true, true]);
        expect(
          log.mock.calls
            .map(([line]) => JSON.parse(line))
            .filter(e => e.executedBranches)
            .map(e => e.executedBranches)
        ).toEqual([["high"], ["high", "low"], ["fallback"]]);
      }
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("acceptance_write_scope");
      expect(output).toContain("project_created");
      expect(output).toContain("run_started");
      expect(output).not.toContain("test-only-password");
      expect(output).not.toContain("fixture-token");
      expect(
        fetch.mock.calls.every(
          ([url, options]) =>
            new URL(url).origin === validEnv.FLOW_ACCEPTANCE_CONFIRM_WRITES &&
            options.redirect === "error"
        )
      ).toBe(true);
    }
  );
});
