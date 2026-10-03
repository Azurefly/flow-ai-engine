import { expect, it, vi } from "vitest";
import { eligibleDirectoryPage } from "./eligible-directory-page";
it("继续扫描前两百人之后的合法处理人", async () => {
  const fetch = vi.fn(async (after: number) =>
    after === 0
      ? Array.from({ length: 200 }, (_, i) => ({ id: i + 1 }))
      : after === 200
        ? [{ id: 201 }]
        : []
  );
  expect(
    await eligibleDirectoryPage(fetch, async item => item.id === 201)
  ).toEqual([{ id: 201 }]);
  expect(fetch.mock.calls.map(call => call[0])).toEqual([0, 200, 201]);
});
it("达到结果上限即停止，避免枚举全部用户", async () => {
  const fetch = vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]);
  expect(await eligibleDirectoryPage(fetch, async () => true, 2)).toEqual([
    { id: 1 },
    { id: 2 },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("目录重复返回旧页时停止而不是无限循环", async () => {
  await expect(
    eligibleDirectoryPage(
      async () => [{ id: 1 }],
      async () => false
    )
  ).rejects.toThrow("分页顺序无效");
});
