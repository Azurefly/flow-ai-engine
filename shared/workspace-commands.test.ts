import { expect, it } from "vitest";
import {
  filterWorkspaceCommands,
  workspaceCommands,
} from "./workspace-commands";
it("普通成员仅见业务页面，身份管理员和系统管理员按能力获取入口", () => {
  expect(workspaceCommands(false, false).map(item => item.label)).toEqual([
    "业务中心",
    "已启动流程",
    "流程仓库",
  ]);
  expect(workspaceCommands(true, false).map(item => item.label)).toContain(
    "人员与权限"
  );
  expect(workspaceCommands(true, false).map(item => item.label)).not.toContain(
    "系统配置"
  );
  expect(workspaceCommands(true, true).map(item => item.label)).toContain(
    "系统配置"
  );
});
it("支持业务词和多关键词搜索，不把无法访问的入口重新带回结果", () => {
  const commands = workspaceCommands(false, false);
  expect(
    filterWorkspaceCommands(commands, " 审批 待办 ").map(item => item.label)
  ).toEqual(["已启动流程"]);
  expect(filterWorkspaceCommands(commands, "授权")).toEqual([]);
  expect(filterWorkspaceCommands(commands, " ")).toEqual(commands);
});
