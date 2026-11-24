import type { AssistantObjectFocus } from "@shared/assistant-scope";
import type { AssistantConfig } from "../../../server/assistant-store";

export type AssistantPage = {
  surface: "home" | "project" | "workflow" | "editor" | "monitor" | "workbench";
  workflowName?: string;
  dataFlow?: boolean;
  hasUnsavedChanges?: boolean;
  focus?: AssistantObjectFocus;
};

export function assistantStarters(page: AssistantPage, tools: AssistantConfig["tools"]) {
  type Starter = { label: string; prompt: string };
  const starters: Starter[] = [];
  const add = (label: string, prompt: string, tool: AssistantConfig["tools"][number] = "workspaceRead") => {
    if (tools.includes(tool)) starters.push({ label, prompt });
  };
  if (page.focus?.kind === "task") {
    add("检查当前任务", "核对当前任务的办理资格、到期时间、可选结果、必填项和会签进度。");
    if (tools.includes("workspaceRead"))
      add("准备办理当前任务", "我想办理当前任务。请先核对资格、可选结果和必填字段，等我提供办理决定后再准备预览。", "workspaceWrite");
  } else if (page.focus) {
    add("诊断当前实例", page.focus.kind === "dataRun"
      ? "诊断当前数据流实例，说明失败或等待的节点、处理行数、质量门结果和血缘。"
      : "诊断当前实例，说明它处于什么状态、在哪些节点失败或等待，以及审批进度。");
  }
  if (["editor", "workflow", "monitor"].includes(page.surface)) {
    add("检查已保存的画布", "检查当前流程已保存的画布，按节点、连线和字段列出结构问题与修复建议。");
    add("运行预检", "对当前流程做正式运行预检，列出准入、资源和办理人问题。只检查，不发起运行。");
    add("对比最近版本", "先查看当前流程的版本历史，再比较最近两个已保存版本，列出节点和连线的变化。");
    if (page.dataFlow) {
      add("查数据流调度", "检查当前数据流程的调度状态、配置版本和下次运行时间。");
      add("准备测试运行", "为当前数据流程准备一次测试运行。如需输入，请先向我询问，提交前展示预览。", "workspaceWrite");
    }
    else add("查看近期失败", "查询当前流程最近一周的失败实例与运行指标，列出可打开的实例。");
  } else if (page.surface === "project") {
    add("盘点项目流程", "汇总当前项目的流程类型、审核及发布状态，列出仍待处理的设计或审核事项。");
    add("查数据资源", "列出当前项目可用的数据资产，说明读取能力，并区分暂不可用的资产。");
    add("设计流程草稿", "我想在当前项目设计一个流程。请先确认流程类型、业务步骤、办理人和分支条件。", "createWorkflowDraft");
    add("查看项目待办", "查询我在当前项目的待办，并按到期时间说明需要关注的事项。");
  } else {
    if (tools.includes("workspaceRead")) {
      add("盘点我的待办", "查看我的工作台和待办，说明需要关注的任务、到期情况和查看入口。");
      add("查找业务项目", "列出我有权查看的业务项目，注明项目状态和显示范围。");
      add("查看办理日历", "查询我未来一周的办理日历，按日期整理待关注事项。");
    } else {
      add("查看我的待办", "查看我的待办任务，列出状态和可打开的任务。", "listMyTasks");
      add("查看我的已办", "查看我最近办理过的任务和当前结果。", "listMyCompletedTasks");
    }
    add("查找流程", "我想查一个流程。请先让我提供流程名或使用场景。", "searchWorkflows");
  }
  return starters;
}
