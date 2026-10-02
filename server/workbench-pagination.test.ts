import { describe, expect, it } from "vitest";
import {
  collectAuthorizedPage,
  decodeWorkbenchPageCursor,
  encodeWorkbenchPageCursor,
  type WorkbenchPageCursor,
} from "./workbench-pagination";

type Row = { id: string; visible: boolean };

function rowCursor(
  row: Row
): Extract<WorkbenchPageCursor, { kind: "instance" }> {
  return {
    kind: "instance",
    createdAt: "2026-09-26 12:00:00.000000",
    id: row.id,
  };
}

function loadAfter(rows: Row[]) {
  return async (
    cursor: Extract<WorkbenchPageCursor, { kind: "instance" }> | undefined,
    limit: number
  ) => {
    const start = cursor ? rows.findIndex(row => row.id === cursor.id) + 1 : 0;
    return rows.slice(start, start + limit);
  };
}

describe("工作台授权分页游标", () => {
  it("对游标进行编码并拒绝错误资源类型或格式", () => {
    const cursor: WorkbenchPageCursor = {
      kind: "task",
      rank: 1,
      createdAt: "2026-09-26 12:00:00.000000",
      id: "task-42",
    };
    expect(
      decodeWorkbenchPageCursor(encodeWorkbenchPageCursor(cursor), "task")
    ).toEqual(cursor);
    expect(() =>
      decodeWorkbenchPageCursor(encodeWorkbenchPageCursor(cursor), "instance")
    ).toThrow("列表游标无效");
    expect(() => decodeWorkbenchPageCursor("not-a-cursor", "task")).toThrow(
      "列表游标无效"
    );
  });

  it("权限过滤后仍连续翻页，不会漏掉被限量查询挤到后面的可见项", async () => {
    const rows = [
      { id: "01", visible: false },
      { id: "02", visible: true },
      { id: "03", visible: false },
      { id: "04", visible: true },
      { id: "05", visible: true },
    ];
    const first = await collectAuthorizedPage({
      limit: 2,
      batchSize: 2,
      loadBatch: loadAfter(rows),
      getCursor: rowCursor,
      isAuthorized: async row => row.visible,
    });
    expect(first.items.map(row => row.id)).toEqual(["02", "04"]);
    expect(first.hasMore).toBe(true);
    const second = await collectAuthorizedPage({
      limit: 2,
      batchSize: 2,
      cursor: decodeWorkbenchPageCursor(
        first.nextCursor ?? undefined,
        "instance"
      ) as Extract<WorkbenchPageCursor, { kind: "instance" }>,
      loadBatch: loadAfter(rows),
      getCursor: rowCursor,
      isAuthorized: async row => row.visible,
    });
    expect(second.items.map(row => row.id)).toEqual(["05"]);
    expect(second.hasMore).toBe(false);
  });

  it("扫描上限内没有可见记录时返回可前进游标，末页则停止", async () => {
    const rows = [
      { id: "01", visible: false },
      { id: "02", visible: false },
      { id: "03", visible: true },
      { id: "04", visible: true },
    ];
    const first = await collectAuthorizedPage({
      limit: 2,
      scanLimit: 2,
      batchSize: 2,
      loadBatch: loadAfter(rows),
      getCursor: rowCursor,
      isAuthorized: async row => row.visible,
    });
    expect(first.items).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await collectAuthorizedPage({
      limit: 2,
      scanLimit: 3,
      batchSize: 2,
      cursor: decodeWorkbenchPageCursor(
        first.nextCursor ?? undefined,
        "instance"
      ) as Extract<WorkbenchPageCursor, { kind: "instance" }>,
      loadBatch: loadAfter(rows),
      getCursor: rowCursor,
      isAuthorized: async row => row.visible,
    });
    expect(second.items.map(row => row.id)).toEqual(["03", "04"]);
    expect(second.hasMore).toBe(false);
  });
});
