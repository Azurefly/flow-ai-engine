import {
  createParticipantRouteCondition,
  PARTICIPANT_DATA_OPERATORS,
  PARTICIPANT_IDENTITIES,
  type ParticipantRouteCondition,
} from "@shared/participant-route-condition";
import { NodeValueEditor } from "./NodeValueEditor";
import { WorkflowParticipantPicker } from "./WorkflowParticipantPicker";

export type ParticipantRoutingEditorContext = {
  workflowId?: string;
  readOnly: boolean;
  states: Array<{ value: string; label: string }>;
};

const control =
  "min-h-10 w-full min-w-0 rounded border border-border bg-card px-2 text-sm";
const kinds = [
  ["identity", "流程身份"],
  ["role", "角色"],
  ["user", "指定人员"],
  ["department", "部门及子部门"],
  ["state", "当前个人状态"],
  ["data", "业务数据"],
  ["group", "条件组"],
] as const;

export function ParticipantRouteConditionEditor({
  value,
  context,
  disabled,
  onChange,
}: {
  value: unknown;
  context: ParticipantRoutingEditorContext;
  disabled: boolean;
  onChange: (value: ParticipantRouteCondition | undefined) => void;
}) {
  if (value === undefined)
    return (
      <button
        type="button"
        className="min-h-10 rounded border border-border px-3 text-sm"
        disabled={disabled}
        onClick={() => onChange(createParticipantRouteCondition("group"))}
      >
        配置人员组合条件
      </button>
    );
  return (
    <section aria-label="人员组合条件" className="grid min-w-0 gap-2">
      <p className="text-xs text-muted-foreground">
        对本次受影响人员逐一判断。组合条件与已有身份、附加数据条件同时满足时进入此分支。
      </p>
      <ConditionRow
        value={value}
        context={context}
        disabled={disabled}
        path="条件"
        onChange={onChange}
        onRemove={() => onChange(undefined)}
      />
    </section>
  );
}

function ConditionRow({
  value,
  context,
  disabled,
  path,
  onChange,
  onRemove,
}: {
  value: unknown;
  context: ParticipantRoutingEditorContext;
  disabled: boolean;
  path: string;
  onChange: (value: ParticipantRouteCondition) => void;
  onRemove: () => void;
}) {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const kind = kinds.find(([key]) => key === raw.kind)?.[0];
  if (!kind)
    return (
      <div role="alert" className="text-sm">
        条件类型无效。
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(createParticipantRouteCondition("identity"))}
        >
          重新配置条件
        </button>
      </div>
    );
  const condition = {
    ...createParticipantRouteCondition(kind),
    ...raw,
  } as ParticipantRouteCondition;
  const update = (patch: Record<string, unknown>) =>
    onChange({ ...condition, ...patch } as ParticipantRouteCondition);
  const picker = (
    pickerKind: "user" | "role" | "department",
    values: string[],
    label: string,
    change: (values: string[]) => void
  ) =>
    context.workflowId ? (
      <WorkflowParticipantPicker
        workflowId={context.workflowId}
        kind={pickerKind}
        multiple
        label={`${path} · ${label}`}
        value={values}
        onChange={change}
        disabled={disabled}
        readOnly={context.readOnly}
        purpose="condition"
      />
    ) : (
      <p className="text-sm text-muted-foreground">保存流程后可搜索{label}。</p>
    );
  return (
    <fieldset
      className="grid min-w-0 gap-3 rounded border border-border bg-card p-3"
      disabled={disabled}
      aria-label={path}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <select
          aria-label={`${path}类型`}
          className={control + " flex-1"}
          value={kind}
          onChange={event =>
            onChange(
              createParticipantRouteCondition(
                event.target.value as ParticipantRouteCondition["kind"]
              )
            )
          }
        >
          {kinds.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={condition.negate === true}
            onChange={event => update({ negate: event.target.checked })}
          />
          取反
        </label>
        <button
          type="button"
          className="min-h-10 px-2 text-sm text-muted-foreground"
          aria-label={`删除${path}`}
          onClick={onRemove}
        >
          删除
        </button>
      </div>
      {condition.kind === "group" && (
        <>
          <label className="grid gap-1 text-sm">
            组合方式
            <select
              className={control}
              value={condition.match}
              onChange={event => update({ match: event.target.value })}
            >
              <option value="all">全部满足（且）</option>
              <option value="any">任一满足（或）</option>
            </select>
          </label>
          {(Array.isArray(condition.conditions)
            ? condition.conditions
            : []
          ).map((child, index, children) => (
            <ConditionRow
              key={index}
              value={child}
              context={context}
              disabled={disabled}
              path={`${path}.${index + 1}`}
              onChange={next =>
                update({
                  conditions: children.map((item, current) =>
                    current === index ? next : item
                  ),
                })
              }
              onRemove={() =>
                update({
                  conditions: children.filter(
                    (_, current) => current !== index
                  ),
                })
              }
            />
          ))}
          <div className="flex flex-wrap gap-2">
            {(["identity", "group"] as const).map(nextKind => (
              <button
                key={nextKind}
                type="button"
                className="min-h-10 rounded border border-border px-3 text-sm"
                onClick={() =>
                  update({
                    conditions: [
                      ...(Array.isArray(condition.conditions)
                        ? condition.conditions
                        : []),
                      createParticipantRouteCondition(nextKind),
                    ],
                  })
                }
              >
                {nextKind === "group" ? "添加条件组" : "添加条件"}
              </button>
            ))}
          </div>
        </>
      )}
      {condition.kind === "identity" && (
        <label className="grid gap-1 text-sm">
          匹配身份
          <select
            className={control}
            value={condition.identity}
            onChange={event => update({ identity: event.target.value })}
          >
            {PARTICIPANT_IDENTITIES.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {condition.kind === "role" && (
        <>
          {picker(
            "role",
            Array.isArray(condition.roleKeys) ? condition.roleKeys : [],
            "角色",
            roleKeys => update({ roleKeys })
          )}
          <label className="grid gap-1 text-sm">
            角色匹配
            <select
              className={control}
              value={condition.match}
              onChange={event => update({ match: event.target.value })}
            >
              <option value="any">拥有所选任一角色</option>
              <option value="all">拥有所选全部角色</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            选择“任一角色”并取反，可匹配不属于这些角色的参与人。
          </p>
        </>
      )}
      {condition.kind === "user" &&
        picker(
          "user",
          Array.isArray(condition.userIds) ? condition.userIds.map(String) : [],
          "人员",
          userIds => update({ userIds: userIds.map(Number) })
        )}
      {condition.kind === "department" && (
        <>
          {picker(
            "department",
            Array.isArray(condition.unitIds) ? condition.unitIds : [],
            "部门",
            unitIds => update({ unitIds })
          )}
          <label className="grid gap-1 text-sm">
            部门成员关系
            <select
              className={control}
              value={condition.membership}
              onChange={event => update({ membership: event.target.value })}
            >
              <option value="any">任一所属部门</option>
              <option value="primary">仅主部门</option>
            </select>
          </label>
          <div className="node-config-columns grid min-w-0 gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              起始层级
              <input
                type="number"
                min={0}
                step={1}
                className={control}
                value={condition.minDepth}
                onChange={event =>
                  update({
                    minDepth:
                      event.target.value === ""
                        ? 0
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-sm">
              最深层级
              <input
                type="number"
                min={condition.minDepth}
                step={1}
                className={control}
                disabled={disabled || condition.maxDepth === null}
                value={condition.maxDepth ?? ""}
                onChange={event =>
                  update({
                    maxDepth:
                      event.target.value === ""
                        ? 0
                        : Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={condition.maxDepth === null}
              onChange={event =>
                update({
                  maxDepth: event.target.checked ? null : condition.minDepth,
                })
              }
            />
            包含全部下级层级
          </label>
          <p className="text-xs text-muted-foreground">
            本部门为第 0 层，直属子部门为第 1 层。0–2
            包含本部门及两层子部门，1–2
            仅包含这两层子部门。多个部门满足任一个即可。
          </p>
        </>
      )}
      {condition.kind === "state" && (
        <fieldset className="grid gap-2 text-sm">
          <legend>匹配当前状态（任一）</legend>
          {context.states.map(state => (
            <label
              key={state.value}
              className="flex min-h-9 items-center gap-2"
            >
              <input
                type="checkbox"
                checked={
                  Array.isArray(condition.stateCodes) &&
                  condition.stateCodes.includes(state.value)
                }
                onChange={event => {
                  const current = Array.isArray(condition.stateCodes)
                    ? condition.stateCodes
                    : [];
                  update({
                    stateCodes: event.target.checked
                      ? [...current, state.value]
                      : current.filter(value => value !== state.value),
                  });
                }}
              />
              {state.label}
            </label>
          ))}
        </fieldset>
      )}
      {condition.kind === "data" && (
        <>
          <NodeValueEditor
            value={condition.left}
            disabled={disabled}
            label={`${path} · 待判断的数据`}
            onChange={left => update({ left })}
          />
          <label className="grid gap-1 text-sm">
            比较方式
            <select
              className={control}
              value={condition.operator}
              onChange={event => update({ operator: event.target.value })}
            >
              {PARTICIPANT_DATA_OPERATORS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {condition.operator !== "exists" && (
            <NodeValueEditor
              value={condition.right ?? ""}
              disabled={disabled}
              label={`${path} · 比较值`}
              onChange={right => update({ right })}
            />
          )}
        </>
      )}
    </fieldset>
  );
}
