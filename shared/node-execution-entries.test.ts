import { expect, it } from "vitest";
import { nodeExecutionEntries } from "./node-execution-entries";
it("同名重复记录不合并，编号与次数保持独立", () => {
  const records = [
    { nodeId: "start", sequenceNo: 1, status: "success" },
    { nodeId: "child", sequenceNo: 2, status: "failed" },
    { nodeId: "child", sequenceNo: 3, status: "failed" },
    { nodeId: "child", sequenceNo: 4, status: "success" },
  ];
  const result = nodeExecutionEntries(records);
  expect(result.map(r => r.occurrence)).toEqual([1, 1, 2, 3]);
  expect(result.map(r => r.totalOccurrences)).toEqual([1, 3, 3, 3]);
  expect(result.map(r => r.orderLabel)).toEqual([
    "执行 #1",
    "执行 #2",
    "执行 #3",
    "执行 #4",
  ]);
  expect(result[1].node).toBe(records[1]);
  expect(records[1]).not.toHaveProperty("occurrence");
});
it("不同节点交错出现和不同运行之间独立计数", () => {
  expect(
    nodeExecutionEntries([
      { nodeId: "a" },
      { nodeId: "b" },
      { nodeId: "a" },
    ]).map(r => r.occurrence)
  ).toEqual([1, 1, 2]);
  expect(nodeExecutionEntries([{ nodeId: "a" }])[0].occurrence).toBe(1);
});
it.each([null, 0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1])(
  "历史无有效序号 %s 使用记录顺序",
  sequenceNo => {
    expect(nodeExecutionEntries([{ sequenceNo }])[0].orderLabel).toBe(
      "记录 #1"
    );
  }
);
it("缺失节点编号的历史记录不被错误分组，特殊编号安全计数", () => {
  const result = nodeExecutionEntries([
    {},
    {},
    { nodeId: "__proto__" },
    { nodeId: "__proto__" },
  ]);
  expect(result.map(r => r.totalOccurrences)).toEqual([1, 1, 2, 2]);
});
it.each([
  ["pending", "待执行"],
  ["running", "执行中"],
  ["waiting", "等待中"],
  ["success", "成功"],
  ["failed", "失败"],
  ["skipped", "已跳过"],
])("节点状态 %s 有中文标签", (status, label) =>
  expect(nodeExecutionEntries([{ status }])[0].statusLabel).toBe(label)
);
it("未知状态保留原值，空记录集合有明确结果", () => {
  expect(nodeExecutionEntries([{ status: "__proto__" }])[0].statusLabel).toBe(
    "未知状态（__proto__）"
  );
  expect(nodeExecutionEntries()).toEqual([]);
});
