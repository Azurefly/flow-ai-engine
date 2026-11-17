import {
  participantOperation,
  PARTICIPANT_RELATION_OPTIONS,
  PARTICIPANT_SCOPE_OPTIONS,
} from "@shared/participant-state";
import { WorkflowParticipantPicker } from "./WorkflowParticipantPicker";
import { TaskFormSchemaEditor } from "./TaskFormSchemaEditor";
import { WorkflowOutcomeEditor } from "./WorkflowOutcomeEditor";

const inputClass =
  "min-h-10 w-full min-w-0 rounded border border-border bg-card px-2 text-sm";

export function ParticipantOperationEditor({
  config,
  workflowId,
  disabled,
  readOnly,
  targets,
  onChange,
}: {
  config: Record<string, unknown>;
  workflowId?: string;
  disabled: boolean;
  readOnly: boolean;
  targets: Record<string, string>;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const operation = participantOperation(config);
  const update = (key: string, value: unknown) =>
    onChange({ ...config, [key]: value });
  const mode = String(config.assigneeMode || "user");
  const text = (key: string, label: string, placeholder?: string) => (
    <label className="grid gap-1 text-sm">
      {label}
      <input
        className={inputClass}
        disabled={disabled}
        value={String(config[key] ?? "")}
        placeholder={placeholder}
        onChange={event => update(key, event.target.value)}
      />
    </label>
  );
  return (
    <div className="grid min-w-0 gap-4" data-participant-operation-editor="">
      <p className="text-xs text-muted-foreground">
        当前状态卡持有人可以办理此操作。连接结果出口到路由，为受影响人员分配下一状态。
      </p>
      {text("nodeDh", "操作代号")}
      {text("czmc", "操作名称")}
      {text("instruction", "办理说明")}
      <label className="grid gap-1 text-sm">
        提交关系
        <select
          className={inputClass}
          disabled={disabled}
          value={operation.relation}
          onChange={event => {
            const relation = event.target.value;
            update("participantOperation", {
              relation,
              scope:
                relation === "create"
                  ? "actor_and_receivers"
                  : relation === "consume"
                    ? "relation"
                    : "actor",
            });
          }}
        >
          {PARTICIPANT_RELATION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        受影响人员
        <select
          className={inputClass}
          disabled={disabled}
          value={operation.scope}
          onChange={event =>
            update("participantOperation", {
              ...operation,
              scope: event.target.value,
            })
          }
        >
          {PARTICIPANT_SCOPE_OPTIONS.filter(option =>
            operation.relation === "create"
              ? ["actor_and_receivers", "all"].includes(option.value)
              : operation.relation === "consume"
                ? ["actor", "relation", "all"].includes(option.value)
                : ["actor", "all"].includes(option.value)
          ).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {operation.relation === "consume" && (
        <p className="text-xs text-muted-foreground">
          使用持卡人当前绑定的提交关系。成功后，本轮旧操作失效，双方可用操作按目标状态重新生成。
        </p>
      )}
      {operation.relation === "create" && (
        <fieldset
          className="grid gap-3 rounded border border-border p-3"
          disabled={disabled}
        >
          <legend className="px-1 text-sm font-medium">本次接收人</legend>
          <label className="grid gap-1 text-sm">
            接收人来源
            <select
              className={inputClass}
              value={mode}
              onChange={event => update("assigneeMode", event.target.value)}
            >
              {[
                ["user", "指定人员"],
                ["form_user", "办理表单中的人员"],
                ["role", "角色成员"],
                ["department", "部门成员"],
                ["department_manager", "部门主管"],
                ["sender_manager", "操作人的直属主管"],
                ["initiator", "流程发起人"],
                ["initiator_manager", "发起人的直属主管"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {workflowId &&
            ["user", "role", "department", "department_manager"].includes(
              mode
            ) && (
              <WorkflowParticipantPicker
                workflowId={workflowId}
                label="选择接收人来源"
                kind={
                  mode === "user"
                    ? "user"
                    : mode === "role"
                      ? "role"
                      : "department"
                }
                value={
                  mode === "user"
                    ? config.assigneeUserId
                      ? [String(config.assigneeUserId)]
                      : []
                    : mode === "role"
                      ? config.assigneeRoleCode
                        ? [String(config.assigneeRoleCode)]
                        : []
                      : Array.isArray(config.assigneeUnitIds)
                        ? config.assigneeUnitIds.map(String)
                        : []
                }
                multiple={
                  mode === "department" || mode === "department_manager"
                }
                disabled={disabled}
                readOnly={readOnly}
                onChange={ids =>
                  update(
                    mode === "user"
                      ? "assigneeUserId"
                      : mode === "role"
                        ? "assigneeRoleCode"
                        : "assigneeUnitIds",
                    mode === "user"
                      ? Number(ids[0]) || ""
                      : mode === "role"
                        ? ids[0] || ""
                        : ids
                  )
                }
              />
            )}
          {mode === "form_user" && (
            <>
              {text(
                "assigneeFormField",
                "接收人字段路径",
                "result.receiverUserId"
              )}
              <p className="text-xs text-muted-foreground">
                result 引用本次办理表单，input 引用启动输入。例如
                result.receiverUserId，需要在下方表单配置对应的数字字段。
              </p>
            </>
          )}
        </fieldset>
      )}
      <TaskFormSchemaEditor
        value={config.formSchema ?? { fields: [] }}
        disabled={disabled}
        onChange={value => update("formSchema", value)}
        advanced={null}
      />
      <WorkflowOutcomeEditor
        targets={targets}
        config={config}
        value={config.outcomes}
        mode="explicit"
        disabled={disabled}
        onChange={outcomes =>
          onChange({ ...config, outcomeMode: "explicit", outcomes })
        }
        advanced={null}
      />
    </div>
  );
}
