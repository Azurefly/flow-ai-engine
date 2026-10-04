import { describe, expect, it } from "vitest";
import { visibleTaskFormErrors } from "../shared/task-form-feedback";

describe("task form feedback", () => {
  const fields = [
    { key: "reference", readOnly: false },
    { key: "amount", readOnly: false },
    { key: "fixed", readOnly: true },
  ];
  it("hides untouched editable field errors without changing validation", () => {
    const errors = { reference: "Required", amount: "Invalid number" };
    expect(visibleTaskFormErrors(errors, new Set(), fields)).toEqual({});
    expect(errors).toEqual({ reference: "Required", amount: "Invalid number" });
    expect(
      visibleTaskFormErrors(errors, new Set(["reference"]), fields)
    ).toEqual({ reference: "Required" });
  });
  it("keeps configuration errors visible for fields the user cannot change", () => {
    expect(
      visibleTaskFormErrors({ fixed: "Required" }, new Set(), fields)
    ).toEqual({ fixed: "Required" });
  });
  it("clears corrected fields immediately and isolates a fresh task", () => {
    expect(visibleTaskFormErrors({}, new Set(["reference"]), fields)).toEqual(
      {}
    );
    expect(
      visibleTaskFormErrors({ reference: "Required" }, new Set(), fields)
    ).toEqual({});
  });
});
