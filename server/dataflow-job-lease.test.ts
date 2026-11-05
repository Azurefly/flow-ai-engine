import { expect, it, vi } from "vitest";
import {
  assertDataflowJobLease,
  DataflowCancelledError,
} from "./dataflow-job-lease";
const ownership = { id: "job", leaseToken: "current" };
it("有效且匹配的租约通过，并锁定Job行", async () => {
  const query = vi
    .fn()
    .mockResolvedValue([
      [{ status: "leased", leaseToken: "current", leaseValid: 1 }],
    ]);
  await expect(
    assertDataflowJobLease({ query } as any, ownership)
  ).resolves.toBeUndefined();
  expect(query.mock.calls[0]).toEqual([
    expect.stringContaining("FOR UPDATE"),
    ["job"],
  ]);
});
it("权威取消使用独立的正常停止信号", async () => {
  const query = vi
    .fn()
    .mockResolvedValue([
      [{ status: "cancelled", leaseToken: null, leaseValid: null }],
    ]);
  await expect(
    assertDataflowJobLease({ query } as any, ownership)
  ).rejects.toBeInstanceOf(DataflowCancelledError);
});
it.each([
  null,
  { status: "queued" },
  { status: "completed" },
  { status: "leased", leaseToken: "replaced", leaseValid: 1 },
  { status: "leased", leaseToken: "current", leaseValid: 0 },
])("%j是真实租约失效，不能冒充正常取消", async row => {
  const query = vi.fn().mockResolvedValue([row ? [row] : []]);
  const error = await assertDataflowJobLease({ query } as any, ownership).catch(
    e => e
  );
  expect(error).not.toBeInstanceOf(DataflowCancelledError);
  expect(error.message).toContain("租约已失效");
});
