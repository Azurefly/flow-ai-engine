import {
  normalizeReferenceOperateConfig,
  type ReferenceSignMode,
} from "@shared/reference-operate-config";
import { updateOperateApproval } from "@shared/operate-approval-editor";
import type { NodeConfig } from "@shared/workflow-node-contract";
import { WorkflowParticipantPicker } from "./WorkflowParticipantPicker";

const modes = [
  ["single", "单人办理", "指定一人办理，或由候选人领取。"],
  ["orSignFor", "或签", "任意一人通过即可；拒绝后其他人可继续审批。"],
  ["andSignFor", "会签", "达到配置的通过比例后完成审批。"],
  ["sequentialSignFor", "顺序会签", "按人员顺序逐一审批，所有人通过后完成。"],
] as const;
export function OperateApprovalEditor({
  config,
  workflowId,
  disabled,
  onChange,
}: {
  config: NodeConfig;
  workflowId?: string;
  disabled: boolean;
  onChange: (updates: NodeConfig) => void;
}) {
  const current = normalizeReferenceOperateConfig(config);
  const binding = config.bdcz as NodeConfig | undefined;
  const attribute = (config.operateAttributeMap as NodeConfig | undefined)
    ?.andSignForAttribute as NodeConfig | undefined;
  const percent =
    attribute?.passPercent !== undefined
      ? attribute.passPercent === ""
        ? ""
        : Number(attribute.passPercent) * 100
      : (binding?.hqtgbfb ?? 100);
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-muted/30 p-4"
      aria-label="审批方式配置"
    >
      <h4 className="text-sm font-semibold">审批方式</h4>
      <div
        role="radiogroup"
        aria-label="审批方式"
        className="grid gap-2 sm:grid-cols-2"
      >
        {modes.map(([mode, label, help]) => (
          <label
            key={mode}
            className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${current.signMode === mode ? "border-primary bg-primary/5" : "border-border bg-background"}`}
          >
            <input
              type="radio"
              name={`approval-${workflowId}`}
              checked={current.signMode === mode}
              disabled={disabled}
              onChange={() =>
                onChange(
                  updateOperateApproval(config, {
                    mode: mode as ReferenceSignMode,
                  })
                )
              }
            />
            <span>
              <span className="block font-medium">{label}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {help}
              </span>
            </span>
          </label>
        ))}
      </div>
      {current.signMode === "andSignFor" && (
        <label className="grid gap-1 text-sm font-medium">
          通过比例（%）
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            disabled={disabled}
            className="h-10 rounded-md border border-input bg-background px-3"
            value={String(percent)}
            onChange={event =>
              onChange(
                updateOperateApproval(config, {
                  percent:
                    event.target.value === "" ? "" : Number(event.target.value),
                })
              )
            }
          />
          <span className="text-xs font-normal text-muted-foreground">
            按人数向上取整。例如 3 人、66% 需要 2 人通过；100% 需要全员通过。
          </span>
        </label>
      )}
      {current.signMode !== "single" && workflowId && (
        <WorkflowParticipantPicker
          workflowId={workflowId}
          kind="user"
          multiple
          ordered={current.signMode === "sequentialSignFor"}
          label="参与审批的人员"
          value={current.signSelectorUserIds.map(String)}
          disabled={disabled}
          onChange={userIds =>
            onChange(updateOperateApproval(config, { userIds }))
          }
        />
      )}
      {current.signMode !== "single" && (
        <p className="text-xs leading-5 text-muted-foreground">
          审批人员须属于上方处理规则解析出的候选人。留空使用全部候选人；顺序会签留空时使用候选人的默认顺序。
        </p>
      )}
    </section>
  );
}
