import { afterEach, expect, it, vi } from "vitest";
import { withDataflowConnectorDeadline } from "./dataflow-connector-deadline";
afterEach(() => vi.useRealTimers());
it("正常返回不销毁连接且清除截止计时器", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn();
  expect(await withDataflowConnectorDeadline({ destroy }, async () => 23)).toBe(
    23
  );
  expect(destroy).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("同步或异步错误保留原错误并清除计时器", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn();
  await expect(
    withDataflowConnectorDeadline({ destroy }, async () => {
      throw new Error("query failed");
    })
  ).rejects.toThrow("query failed");
  expect(vi.getTimerCount()).toBe(0);
});
it("销毁异常也只拒绝当前操作，不产生未捕获计时器异常", async () => {
  vi.useFakeTimers();
  const result = withDataflowConnectorDeadline({ destroy() { throw new Error("socket cleanup failed"); } }, () => new Promise<never>(() => {}), 1000);
  const assertion = expect(result).rejects.toThrow("连接已关闭");
  await vi.advanceTimersByTimeAsync(1000); await assertion;
});
it.each([
  [10, 1000],
  [200_000, 120_000],
  [NaN, 60_000],
])(
  "配置%s仍有有限截止时间%i，超时销毁且迟到结果不能变成功",
  async (configured, ms) => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    let resolve!: (n: number) => void;
    const result = withDataflowConnectorDeadline(
      { destroy },
      () =>
        new Promise<number>(done => {
          resolve = done;
        }),
      configured
    );
    const assertion = expect(result).rejects.toThrow("连接已关闭");
    await vi.advanceTimersByTimeAsync(ms);
    await assertion;
    expect(destroy).toHaveBeenCalledOnce();
    resolve(23);
    expect(vi.getTimerCount()).toBe(0);
  }
);
