import { describe, expect, it } from "vitest";
import { attachOrganizationPaths } from "./organization-service";

describe("organization display paths", () => {
  it("adds stable name and code paths for duplicate department names", () => {
    const result = attachOrganizationPaths([
      { id: "root", code: "HQ", name: "总部", parentUnitId: null },
      { id: "east", code: "EAST", name: "华东", parentUnitId: "root" },
      { id: "sales-east", code: "SALES", name: "销售部", parentUnitId: "east" },
      { id: "west", code: "WEST", name: "华西", parentUnitId: "root" },
      { id: "sales-west", code: "SALES", name: "销售部", parentUnitId: "west" },
    ]);
    expect(result.find(unit => unit.id === "sales-east")).toMatchObject({
      pathName: "总部 / 华东 / 销售部",
      pathCode: "HQ/EAST/SALES",
      displayPath: "总部 / 华东 / 销售部（HQ/EAST/SALES）",
    });
    expect(result.find(unit => unit.id === "sales-west")?.displayPath).toBe(
      "总部 / 华西 / 销售部（HQ/WEST/SALES）"
    );
  });

  it("does not recurse forever when legacy data contains a parent cycle", () => {
    const result = attachOrganizationPaths([
      { id: "a", code: "A", name: "甲", parentUnitId: "b" },
      { id: "b", code: "B", name: "乙", parentUnitId: "a" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(unit => unit.displayPath.length > 0)).toBe(true);
  });
});
