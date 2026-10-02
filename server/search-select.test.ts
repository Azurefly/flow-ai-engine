import { describe, expect, it } from "vitest";
import {
  searchSelectOptions,
  toggleSearchSelection,
} from "../shared/search-select";

describe("searchable permission selectors", () => {
  it("matches visible labels and account codes case-insensitively", () => {
    const options = [
      { value: "1", label: "财务部（FIN）", keywords: "finance" },
      { value: "2", label: "采购审批人", keywords: "buyer_1" },
    ];

    expect(searchSelectOptions(options, "fin").options).toEqual([options[0]]);
    expect(searchSelectOptions(options, "BUYER").options).toEqual([options[1]]);
    expect(searchSelectOptions(options, "不存在").totalMatches).toBe(0);
  });

  it("finds warehouse projects by either code or Chinese name", () => {
    const projects = [
      {
        value: "project-1",
        label: "P_BTN_VERIFY · 按钮全功能与试运行三轮验收项目",
        keywords: "P_BTN_VERIFY 按钮全功能与试运行三轮验收项目",
      },
      {
        value: "project-2",
        label: "RA_20260926004830 · 远程部署验收",
        keywords: "RA_20260926004830 远程部署验收",
      },
    ];

    expect(searchSelectOptions(projects, "p_btn").options).toEqual([
      projects[0],
    ]);
    expect(searchSelectOptions(projects, "远程部署").options).toEqual([
      projects[1],
    ]);
  });

  it("limits large result sets while reporting that more matches exist", () => {
    const options = Array.from({ length: 75 }, (_, index) => ({
      value: String(index),
      label: `测试账号 ${index}`,
    }));

    const results = searchSelectOptions(options, "测试账号", 50);

    expect(results.options).toHaveLength(50);
    expect(results.totalMatches).toBe(75);
    expect(results.hasMore).toBe(true);
  });

  it("toggles multi-select values and replaces a single-select value", () => {
    expect(toggleSearchSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSearchSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleSearchSelection(["a"], "b", 1)).toEqual(["b"]);
    expect(toggleSearchSelection(["a"], "a", 1)).toEqual([]);
  });
});
