import type { ConsoleRoute } from "./console-route";

export type WorkspaceCommand = {
  label: string;
  description: string;
  keywords: string;
  route: ConsoleRoute;
};
export function workspaceCommands(
  canManageIdentity: boolean,
  isAdmin: boolean
): WorkspaceCommand[] {
  return [
    {
      label: "业务中心",
      description: "选择业务，进入流程设计和数据资源",
      keywords: "项目 流程设计",
      route: { section: "flows", view: "center" },
    },
    {
      label: "已启动流程",
      description: "办理待办、查看发起记录和运行状态",
      keywords: "任务 审批 待办 运行",
      route: { section: "runs", view: "workbench" },
    },
    {
      label: "流程仓库",
      description: "查找与复用流程模板",
      keywords: "模板 仓库",
      route: { section: "warehouse" },
    },
    ...(canManageIdentity
      ? [
          {
            label: "人员与权限",
            description: "维护账号、角色及权限来源",
            keywords: "用户 角色 授权",
            route: { section: "system", view: "identity" },
          },
          {
            label: "组织管理",
            description: "维护组织结构和继承授权",
            keywords: "部门 组织",
            route: { section: "system", view: "organization" },
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: "系统配置",
            description: "管理平台显示和审批规则",
            keywords: "通用 设置",
            route: { section: "system", view: "config" },
          },
        ]
      : []),
  ] as WorkspaceCommand[];
}
export function filterWorkspaceCommands(
  commands: WorkspaceCommand[],
  search: string
) {
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter(item =>
    terms.every(term =>
      `${item.label} ${item.description} ${item.keywords}`
        .toLocaleLowerCase()
        .includes(term)
    )
  );
}
