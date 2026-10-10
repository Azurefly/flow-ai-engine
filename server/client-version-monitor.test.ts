import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  effect: null as null | (() => void | (() => void)),
  update: vi.fn(),
}));
vi.mock("react", () => ({
  useState: () => [false, state.update],
  useEffect: (effect: () => void | (() => void)) => {
    state.effect = effect;
  },
}));
import { useClientVersionUpdate } from "../client/src/hooks/useClientVersionUpdate";

let page: {
  visibilityState: string;
  querySelector: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let browser: {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
  state.effect = null;
  state.update.mockReset();
  page = {
    visibilityState: "visible",
    querySelector: vi.fn(() => ({
      getAttribute: () => "/assets/index-old.js",
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  browser = {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  request = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () =>
        '<script type="module" src="/assets/index-new.js"></script>',
    });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("禁用或开发入口不发请求", () => {
  useClientVersionUpdate(false);
  state.effect?.();
  expect(request).not.toHaveBeenCalled();
  page.querySelector.mockReturnValue({ getAttribute: () => "/src/main.tsx" });
  useClientVersionUpdate(true);
  state.effect?.();
  expect(request).not.toHaveBeenCalled();
});
it("发现更新后提示且停止重复请求，卸载清理监听", async () => {
  useClientVersionUpdate(true);
  const cleanup = state.effect?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.update).toHaveBeenCalledWith(true);
  expect(request).toHaveBeenCalledWith(
    "/",
    expect.objectContaining({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    })
  );
  await vi.advanceTimersByTimeAsync(600_000);
  expect(request).toHaveBeenCalledTimes(1);
  cleanup?.();
  expect(browser.removeEventListener).toHaveBeenCalledWith(
    "focus",
    expect.any(Function)
  );
  expect(page.removeEventListener).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function)
  );
});
it("隐藏页不检查，网络失败不提示更新且五分钟后重试", async () => {
  page.visibilityState = "hidden";
  request.mockRejectedValue(new Error("offline"));
  useClientVersionUpdate(true);
  const cleanup = state.effect?.();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(request).not.toHaveBeenCalled();
  page.visibilityState = "visible";
  await vi.advanceTimersByTimeAsync(300_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(state.update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(request).toHaveBeenCalledTimes(2);
  cleanup?.();
});
it("未完成请求卸载时中止，超时后也不提示更新", async () => {
  request.mockImplementation(
    (_path: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      )
  );
  useClientVersionUpdate(true);
  const cleanup = state.effect?.();
  const signal = request.mock.calls[0][1].signal as AbortSignal;
  cleanup?.();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(8_000);
  expect(state.update).not.toHaveBeenCalled();
});
it("八秒超时中止请求，焦点与轮询不产生并发检查", async () => {
  request.mockImplementation(
    (_path: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      )
  );
  useClientVersionUpdate(true);
  const cleanup = state.effect?.();
  const signal = request.mock.calls[0][1].signal as AbortSignal;
  const resume = browser.addEventListener.mock.calls[0][1] as () => void;
  resume();
  expect(request).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(8_000);
  expect(signal.aborted).toBe(true);
  expect(state.update).not.toHaveBeenCalled();
  resume();
  expect(request).toHaveBeenCalledTimes(1);
  cleanup?.();
});
