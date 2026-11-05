import { expect, it } from "vitest";
import { renameConfigProperty } from "../client/src/components/workflow-config-editor";

it("renaming a structured property preserves its position and every nested value", () => {
  const payload = { recipient: ["市局", "分局"], enabled: false, limit: 0 };
  const original = { before: null, 字段名: payload, after: "" };
  const renamed = renameConfigProperty(original, "字段名", "X-Request-Id");
  expect(Object.keys(renamed)).toEqual(["before", "X-Request-Id", "after"]);
  expect(renamed["X-Request-Id"]).toBe(payload);
  expect(renamed.before).toBeNull();
  expect(renamed.after).toBe("");
  expect(original).toEqual({ before: null, 字段名: payload, after: "" });
});

it.each(["", " ", "\t\n", "existing"])(
  "rejects the invalid name %j without losing either property's value",
  name => {
    const original = { editable: { nested: [1, 2] }, existing: "keep" };
    expect(renameConfigProperty(original, "editable", name)).toBe(original);
    expect(original).toEqual({ editable: { nested: [1, 2] }, existing: "keep" });
  }
);

it("retains the same record when the name is unchanged", () => {
  const original = { name: [null, false, 0] };
  expect(renameConfigProperty(original, "name", "name")).toBe(original);
});

it("does not discard unrelated imported properties while renaming a valid field", () => {
  const original = { "": { legacy: true }, " ": [0, false], editable: "keep" };
  expect(renameConfigProperty(original, "editable", "renamed")).toEqual({
    "": { legacy: true },
    " ": [0, false],
    renamed: "keep",
  });
  expect(original.editable).toBe("keep");
});

it.each(["constructor", "toString", "__proto__"])(
  "supports the own property name %s without changing the object prototype",
  name => {
    const original = { editable: "value", sibling: "keep" };
    const renamed = renameConfigProperty(original, "editable", name);
    expect(Object.prototype.hasOwnProperty.call(renamed, name)).toBe(true);
    expect(renamed[name]).toBe("value");
    expect(renamed.sibling).toBe("keep");
    expect(Object.getPrototypeOf(renamed)).toBe(Object.prototype);
    expect(original).toEqual({ editable: "value", sibling: "keep" });
    expect(renameConfigProperty(renamed, "sibling", name)).toBe(renamed);
  }
);
