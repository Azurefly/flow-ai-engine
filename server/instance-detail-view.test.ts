import { describe, expect, it } from "vitest";
import {
  flattenInstanceFields,
  sortInstanceActions,
} from "../client/src/components/WorkflowGovernanceRunDetail";

describe("实例详情列表展示", () => {
  it("按完成、更新、开始或创建时间自动倒序", () => {
    const actions = [
      { id: "started", startedAt: "2026-08-23T01:00:00.000Z" },
      { id: "finished", finishedAt: "2026-08-23T03:00:00.000Z" },
      { id: "created", createdAt: "2026-08-23T02:00:00.000Z" },
    ];
    const sorted = sortInstanceActions(actions);
    expect(sorted.map(item => item.id)).toEqual([
      "finished",
      "created",
      "started",
    ]);
    expect(actions.map(item => item.id)).toEqual(["started", "finished", "created"]);
  });

  it("相同操作时间按持久化执行序号倒序", () => {
    const finishedAt = "2026-08-23T11:04:55.000Z";
    const sorted = sortInstanceActions([
      { id: "second", nodeId: "apply", sequenceNo: 2, finishedAt },
      { id: "last", nodeId: "approve", sequenceNo: 6, finishedAt },
      { id: "first", nodeId: "start", sequenceNo: 1, finishedAt },
    ]);
    expect(sorted.map(item => item.id)).toEqual(["last", "second", "first"]);
  });

  it("历史同秒记录按定义快照顺序倒序回退", () => {
    const finishedAt = "2026-08-23T11:04:55.000Z";
    const definition = JSON.stringify({ nodes: [
      { id: "start" },
      { id: "annual-application" },
      { id: "submit" },
      { id: "route-days" },
      { id: "short-pending" },
      { id: "supervisor-approve" },
    ] });
    const sorted = sortInstanceActions([
      { id: "annual", nodeId: "annual-application", finishedAt },
      { id: "supervisor", nodeId: "supervisor-approve", finishedAt },
      { id: "start", nodeId: "start", finishedAt },
      { id: "pending", nodeId: "short-pending", finishedAt },
      { id: "submit", nodeId: "submit", finishedAt },
      { id: "route", nodeId: "route-days", finishedAt },
    ], definition);
    expect(sorted.map(item => item.id)).toEqual([
      "supervisor",
      "pending",
      "route",
      "submit",
      "annual",
      "start",
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
