import { WORKBENCH_STATUS_LABELS } from "./workbench-list-status";

export function formatRunStatus(status: unknown) {
  const value = String(status ?? "");
  return WORKBENCH_STATUS_LABELS[value] ?? `未知状态（原值：${value || "空"}）`;
}

export function runStatusSummary(run: {
  status?: unknown;
  flowType?: string;
  currentStateName?: string | null;
  participantStatusName?: string | null;
}) {
  return [
    { label: "执行状态", value: formatRunStatus(run.status) },
    {
      label: "业务状态",
      value:
        run.flowType === "state"
          ? run.currentStateName || "尚未进入业务状态"
          : "不适用",
    },
    {
      label: "我的办理状态",
      value: run.participantStatusName || "暂无办理记录",
    },
  ];
}
