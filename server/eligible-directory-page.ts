export async function eligibleDirectoryPage<T extends { id: number }>(
  fetchPage: (afterId: number) => Promise<T[]>,
  eligible: (item: T) => Promise<boolean>,
  limit = 51
) {
  const result: T[] = [];
  let afterId = 0;
  for (;;) {
    const page = await fetchPage(afterId);
    if (!page.length) return result;
    for (const item of page) {
      if (item.id <= afterId) throw new Error("人员目录分页顺序无效。");
      afterId = item.id;
      if (await eligible(item)) result.push(item);
      if (result.length >= limit) return result;
    }
  }
}
