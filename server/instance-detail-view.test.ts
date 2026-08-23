import { describe, expect, it } from "vitest";
import {
  flattenInstanceFields,
  sortInstanceActions,
} from "../client/src/components/WorkflowGovernanceRunDetail";

describe("实例详情列表展示", () => {
  it("按完成、更新、开始或创建时间自动倒序", () => {
    const sorted = sortInstanceActions([
      { id: "started", startedAt: "2026-08-23T01:00:00.000Z" },
      { id: "finished", finishedAt: "2026-08-23T03:00:00.000Z" },
      { id: "created", createdAt: "2026-08-23T02:00:00.000Z" },
    ]);
    expect(sorted.map(item => item.id)).toEqual([
      "finished",
      "created",
      "started",
    ]);
  });

  it("将输入输出对象递归转换为字段列表而不是原始 JSON 文本", () => {
    expect(
      flattenInstanceFields({
        applicant: { name: "张三" },
        days: 2,
        tags: ["年假", "紧急"],
      })
    ).toEqual([
      { field: "applicant.name", value: "张三" },
      { field: "days", value: "2" },
      { field: "tags[0]", value: "年假" },
      { field: "tags[1]", value: "紧急" },
    ]);
  });
});
