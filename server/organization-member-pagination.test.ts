import { describe, expect, it } from "vitest";
import {
  organizationMemberPageWindow,
  organizationMemberSearchPattern,
} from "./organization-member-pagination";

describe("organization member pagination", () => {
  it("treats SQL LIKE wildcard characters as literal search text", () => {
    expect(organizationMemberSearchPattern(" 研发%_==部 ")).toBe(
      "%研发=%=_====部%"
    );
    expect(organizationMemberSearchPattern("  ")).toBeUndefined();
  });

  it("returns stable display ranges and clamps pages after the result count shrinks", () => {
    expect(organizationMemberPageWindow(2, 20, 45)).toEqual({
      page: 2,
      pageSize: 20,
      totalPages: 3,
      offset: 20,
      from: 21,
      to: 40,
    });
    expect(organizationMemberPageWindow(99, 20, 45)).toEqual({
      page: 3,
      pageSize: 20,
      totalPages: 3,
      offset: 40,
      from: 41,
      to: 45,
    });
  });

  it("represents an empty result without inventing a visible page", () => {
    expect(organizationMemberPageWindow(1, 20, 0)).toEqual({
      page: 1,
      pageSize: 20,
      totalPages: 0,
      offset: 0,
      from: 0,
      to: 0,
    });
  });
});
