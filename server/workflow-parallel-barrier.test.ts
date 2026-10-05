import { expect, it } from "vitest";
import {
  createParallelBarrier,
  arriveParallelBarrier,
  restoreParallelBarrier,
} from "./workflow-parallel-barrier";
it("所有实际派发分支到达后仅释放一次", () => {
  const initial = createParallelBarrier(["a", "b"]);
  const first = arriveParallelBarrier(initial, "b");
  expect(first.disposition).toBe("waiting");
  const second = arriveParallelBarrier(first.state, "a");
  expect(second.disposition).toBe("release");
  expect(arriveParallelBarrier(second.state, "a").disposition).toBe(
    "duplicate"
  );
  expect(initial.arrived).toEqual([]);
});
it("检查点JSON恢复后继续等待，重复完成不计入分支数", () => {
  const first = arriveParallelBarrier(
    createParallelBarrier(["a", "b", "c"]),
    "a"
  );
  const restored = JSON.parse(JSON.stringify(first.state));
  expect(arriveParallelBarrier(restored, "a").disposition).toBe("duplicate");
  const second = arriveParallelBarrier(restored, "b");
  expect(second.disposition).toBe("waiting");
  expect(arriveParallelBarrier(second.state, "c").disposition).toBe("release");
});
it("只有一个命中或默认分支时到达即可释放", () => {
  expect(
    arriveParallelBarrier(createParallelBarrier(["fallback"]), "fallback")
      .disposition
  ).toBe("release");
});
it("未知令牌和空分支不能伪造汇聚完成", () => {
  expect(() => createParallelBarrier([])).toThrow();
  expect(() => createParallelBarrier(["a", "a"])).toThrow();
  expect(() =>
    arriveParallelBarrier(createParallelBarrier(["a"]), "other")
  ).toThrow();
});

it.each([
  null,
  { expected: [], arrived: [], released: true },
  { expected: ["a", "a"], arrived: [], released: false },
  { expected: ["a", "b"], arrived: ["a", "a"], released: false },
  { expected: ["a"], arrived: ["other"], released: false },
  { expected: ["a"], arrived: [], released: true },
  { expected: ["a"], arrived: ["a"], released: false },
  { expected: ["a"], arrived: [], released: "false" },
])("损坏检查点不能伪造汇聚完成 %#", value => {
  expect(() => restoreParallelBarrier(value)).toThrow("检查点无效");
});
it("恢复状态复制数组，后续修改不会污染持久化快照", () => {
  const persisted = { expected: ["a", "b"], arrived: ["a"], released: false };
  const restored = restoreParallelBarrier(persisted);
  restored.arrived.push("b");
  expect(persisted.arrived).toEqual(["a"]);
});
