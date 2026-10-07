import { expect, it } from "vitest";
import { formatRunDuration } from "./run-duration";
it.each([
  [0, "0 ms"],
  [10, "10 ms"],
  [1.5, "1.5 ms"],
])("保留有效耗时 %s", (value, expected) =>
  expect(formatRunDuration(value)).toBe(expected)
);
it.each([null, undefined, -1, NaN, Infinity, "10", false])(
  "无有效耗时 %s 不展示单位",
  value => expect(formatRunDuration(value)).toBe("—")
);
