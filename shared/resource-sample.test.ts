import { expect, it } from "vitest";
import { readResourceSample } from "./resource-sample";

const schema = [
  { name: "id", type: "string" },
  { name: "amount", type: "number" },
  { name: "active", type: "boolean" },
];

it("preserves textual identifiers and creates typed sample values", () => {
  expect(
    readResourceSample(schema, [
      { key: "id", value: "00101" },
      { key: "amount", value: "250.5" },
      { key: "active", value: "false" },
    ])
  ).toEqual([{ id: "00101", amount: 250.5, active: false }]);
});

it.each(["", "abc", "9007199254740993"])(
  "rejects invalid numeric sample %s",
  value => {
    expect(() =>
      readResourceSample(schema, [{ key: "amount", value }])
    ).toThrow();
  }
);

it("rejects invalid booleans and duplicate fields", () => {
  expect(() =>
    readResourceSample(schema, [{ key: "active", value: "yes" }])
  ).toThrow();
  expect(() =>
    readResourceSample(schema, [
      { key: "id", value: "a" },
      { key: "id", value: "b" },
    ])
  ).toThrow();
});

it("validates structured sample values and empty samples", () => {
  expect(readResourceSample([], [])).toEqual([]);
  expect(
    readResourceSample(
      [{ name: "items", type: "array" }],
      [{ key: "items", value: "[1,false]" }]
    )
  ).toEqual([{ items: [1, false] }]);
  expect(() =>
    readResourceSample(
      [{ name: "items", type: "array" }],
      [{ key: "items", value: "{}" }]
    )
  ).toThrow();
});
