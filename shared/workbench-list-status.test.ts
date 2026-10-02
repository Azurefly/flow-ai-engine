import { describe, expect, it } from "vitest";
import {
  getWorkbenchListStatusMessage,
  getWorkbenchStatusOptions,
  WORKBENCH_STATUS_LABELS,
} from "./workbench-list-status";

describe("工作台列表分页状态摘要", () => {
  it("流程实例筛选同时提供执行状态和业务状态", () => {
    expect(
      getWorkbenchStatusOptions(
        [
          { status: "running", stateName: "已授权" },
          { status: "failed", stateName: "已驳回终止" },
          { status: "running", stateName: "已授权" },
          { status: "success", stateName: null },
        ],
        "all",
        true
      )
    ).toEqual(["failed", "running", "success", "已授权", "已驳回终止"]);
  });

  it("保留当前页已无法看到的流程实例筛选项", () => {
    expect(
      getWorkbenchStatusOptions(
        [{ status: "running", stateName: null }],
        "已授权",
        true
      )
    ).toEqual(["running", "已授权"]);
  });

  it("待办和已办筛选仍以任务展示状态为准", () => {
    expect(
      getWorkbenchStatusOptions(
        [
          { status: "pending", displayStatus: "待审批" },
          { status: "claimed", displayStatus: "处理中" },
        ],
        "all",
        false
      )
    ).toEqual(["处理中", "待审批"]);
  });

  it("完整映射流程实例的所有运行状态，运行中不误标为等待任务", () => {
    expect(WORKBENCH_STATUS_LABELS).toEqual({
      pending: "待处理",
      claimed: "处理中",
      completed: "已办",
      queued: "排队中",
      running: "运行中",
      waiting: "等待中",
      blocked: "已阻塞",
      success: "成功",
      failed: "失败",
      cancelled: "已取消",
      terminated: "已终止",
    });
  });

  it("搜索防抖期间说明旧记录仍在显示，不暴露旧分页结果", () => {
    expect(
      getWorkbenchListStatusMessage({
        searchPending: true,
        isFetching: false,
        rowCount: 7,
        pageNumber: 3,
        hasNextPage: false,
      })
    ).toBe("正在筛选，暂显示上次读取的 7 条记录");
  });

  it("首次读取空列表时不显示零条或末页", () => {
    expect(
      getWorkbenchListStatusMessage({
        searchPending: false,
        isFetching: true,
        rowCount: 0,
        pageNumber: 1,
        hasNextPage: false,
      })
    ).toBe("正在读取符合条件的数据…");
  });

  it("后台刷新时标记当前展示的是上次读取的记录", () => {
    expect(
      getWorkbenchListStatusMessage({
        searchPending: false,
        isFetching: true,
        rowCount: 12,
        pageNumber: 2,
        hasNextPage: true,
      })
    ).toBe("正在更新本页，暂显示上次读取的 12 条记录");
  });

  it("读取完成后才报告页码、数量和继续扫描状态", () => {
    expect(
      getWorkbenchListStatusMessage({
        searchPending: false,
        isFetching: false,
        rowCount: 0,
        pageNumber: 2,
        hasNextPage: true,
      })
    ).toBe("第 2 页 · 本页已载入 0 条 · 可继续扫描授权范围");
    expect(
      getWorkbenchListStatusMessage({
        searchPending: false,
        isFetching: false,
        rowCount: -1,
        pageNumber: 0,
        hasNextPage: false,
      })
    ).toBe("第 1 页 · 本页已载入 0 条 · 已到末页");
  });
});
