import {
  createParticipantRouteCondition,
  PARTICIPANT_DATA_OPERATORS,
  PARTICIPANT_IDENTITIES,
  type ParticipantRouteCondition,
} from "@shared/participant-route-condition";
import { NodeValueEditor } from "./NodeValueEditor";
import { participantDirectoryLabel, WorkflowParticipantPicker } from "./WorkflowParticipantPicker";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useRuleNavigationFocus } from "@/hooks/useRuleNavigationFocus";
import { availableCounts, conditionText, isGroup, readApprovalCount, withApprovalCount } from "@shared/approval-condition-presentation";

export type ParticipantRoutingEditorContext = {
  workflowId?: string;
  readOnly: boolean;
  nodeNames: Record<string, string>;
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

type DirectoryKind = "user" | "role" | "department";

function conditionDirectoryIds(value: unknown) {
  const ids = { user: new Set<string>(), role: new Set<string>(), department: new Set<string>() };
  function visit(item: unknown) {
    if (isGroup(item)) return item.conditions.forEach(visit);
    const condition = item as ParticipantRouteCondition | undefined;
    if (condition?.kind === "user" && Array.isArray(condition.userIds)) condition.userIds.forEach(id => ids.user.add(String(id)));
    if (condition?.kind === "role" && Array.isArray(condition.roleKeys)) condition.roleKeys.forEach(id => ids.role.add(String(id)));
    if (condition?.kind === "department" && Array.isArray(condition.unitIds)) condition.unitIds.forEach(id => ids.department.add(String(id)));
    readApprovalCount(item)?.ids.forEach(id => ids.user.add(id));
  }
  visit(value);
  return ids;
}

function useConditionNames(context: ParticipantRoutingEditorContext, kind: DirectoryKind, ids: Set<string>) {
  const selectedIds = Array.from(ids).filter(id => id.length > 0 && id.length <= 64).slice(0, 100);
  const directory = trpc.workflow.participantDirectory.useQuery(
    { workflowId: context.workflowId ?? "", kind, query: "", selectedIds, readOnly: context.readOnly },
    { enabled: Boolean(context.workflowId && selectedIds.length), staleTime: 30_000 }
  );
  return Object.fromEntries((directory.data?.selected ?? []).map(option =>
    [option.value, participantDirectoryLabel(option.label, option.value)]));
}

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
  const [selection, select] = useState<{ path: number[]; view: "fields" | "items" | "count" } | null>(null);
  const focus = useRuleNavigationFocus();
  const ids = useMemo(() => conditionDirectoryIds(value), [value]);
  const names = {
    user: useConditionNames(context, "user", ids.user),
    role: useConditionNames(context, "role", ids.role),
    department: useConditionNames(context, "department", ids.department),
    state: Object.fromEntries(context.states.map(state => [state.value, state.label])),
  };
  const parents: Extract<ParticipantRouteCondition, { kind: "group" }>[] = [];
  let current = value;
  const path = selection?.path ?? [];
  for (const index of path) {
    if (!isGroup(current) || index >= current.conditions.length) break;
    parents.push(current);
    current = current.conditions[index];
  }
  const address = path.slice(0, parents.length);
  const active = selection && address.length === path.length ? selection : null;
  const rootCount = readApprovalCount(value);
  const count = readApprovalCount(current);
  const group = isGroup(current) ? current : undefined;
  const parentView = address.length > 1 || (address.length === 1 && Boolean(rootCount && rootCount.votes.length > 1));
  const name = (item: unknown) => conditionText(item, context.nodeNames, names);
  function open(path: number[], view: NonNullable<typeof selection>["view"]) {
    focus.pending.current = "back";
    select({ path, view });
  }
  function goBack() {
    focus.pending.current = address.at(-1) ?? "root";
    select(parentView ? { path: address.slice(0, -1), view: "items" } : null);
  }
  function change(next: ParticipantRouteCondition | undefined) {
    let result = next;
    for (let i = parents.length - 1; i >= 0; i--) {
      const parent = parents[i];
      const children = parent.conditions.slice();
      children.splice(address[i], 1, ...(result === undefined ? [] : [result]));
      result = { ...parent, conditions: children };
    }
    onChange(result);
    if (!next) goBack();
  }
  if (value === undefined)
    return (
      <button
        type="button"
        className="min-h-10 rounded border border-border px-3 text-sm"
        disabled={disabled}
        onClick={() => { onChange(createParticipantRouteCondition("group")); open([], "items"); }}
      >
        添加人员条件
      </button>
    );
  const compactCount = count && count.votes.length > 1;
  const showItems = group && (!compactCount || active?.view === "items");
  return (
    <section aria-label="人员条件" className="grid min-w-0 gap-2" data-route-condition-edit={active ? "" : undefined}>
      {active && <button type="button" className="rule-link" ref={focus.buttonRef("back")} onClick={goBack}>
        ‹ {parentView ? "返回条件组合" : "返回分支条件"}
      </button>}
      {active?.view === "count" && count ? <>
        <h4 className="rule-heading">审批通过人数</h4>
        <p className="node-value-hint">{context.nodeNames[count.node] || count.node}</p>
        <p className="node-value-hint">{count.ids.map(id => names.user[id] || `人员 ${id}`).join("、")}</p>
        <label className="grid gap-1 text-sm">至少通过人数
          <select className={control} disabled={disabled || count.votes.length === 1} value={count.required}
            onChange={event => change(withApprovalCount(count, Number(event.target.value)))}>
            {availableCounts(count).map(n => <option key={n} value={n}>{n} 人</option>)}
          </select>
        </label>
        <button className="rule-link" type="button" onClick={() => open(address, "items")}>展开逐项条件</button>
      </> : active?.view === "fields" ? <>
        <h4 className="rule-heading">{kinds.find(([key]) => key === (current as ParticipantRouteCondition | undefined)?.kind)?.[1] ?? "条件"}配置</h4>
        <ConditionRow key={address.join(".")} value={current} context={context} disabled={disabled}
          onChange={change} onRemove={() => change(undefined)} />
      </> : showItems ? <>
        <div className="route-condition-heading">
          <strong>{compactCount ? (group.match === "all" ? "全部满足" : "任一满足") : name(group)}</strong>
          <button type="button" className="rule-link" ref={focus.buttonRef("root")} onClick={() => open(address, "fields")}>编辑组合</button>
        </div>
        <div className="rule-list">
          {group.conditions.map((item, index) => (
            <button type="button" className="rule-list-item" key={index} ref={focus.buttonRef(index)}
              onClick={() => open([...address, index], (readApprovalCount(item)?.votes.length ?? 0) > 1 ? "count" : isGroup(item) ? "items" : "fields")}>
              <span>{name(item)}</span>
            </button>
          ))}
        </div>
        {!disabled && <div className="flex flex-wrap gap-2">
          {(["identity", "group"] as const).map(kind => (
            <button type="button" className="rule-link" key={kind} onClick={() => {
              change({ ...group, conditions: [...group.conditions, createParticipantRouteCondition(kind)] });
              open([...address, group.conditions.length], "fields");
            }}>{kind === "group" ? "添加条件组" : "添加条件"}</button>
          ))}
        </div>}
      </> : <div className="rule-list">
        <button type="button" className="rule-list-item" ref={focus.buttonRef("root")}
          onClick={() => open([], compactCount ? "count" : "fields")}>
          <span>{name(value)}</span>
        </button>
      </div>}
    </section>
  );
}

function ConditionRow({
  value,
  context,
  disabled,
  onChange,
  onRemove,
}: {
  value: unknown;
  context: ParticipantRoutingEditorContext;
  disabled: boolean;
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
        label={label}
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
      className="grid min-w-0 gap-3"
      disabled={disabled}
      aria-label="编辑条件"
    >
      <div className="rule-controls">
        <select
          aria-label="条件类型"
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
        {kind !== "role" && <label className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={condition.negate === true}
            onChange={event => update({ negate: event.target.checked })}
          />
          反向匹配
        </label>}
        <button
          type="button"
          className="min-h-10 px-2 text-sm text-muted-foreground"
          aria-label={kind === "group" ? "删除整个条件组" : "删除此条件"}
          onClick={onRemove}
        >
          {kind === "group" ? "删除条件组" : "删除此条件"}
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
              value={`${condition.negate ? "not-" : ""}${condition.match}`}
              onChange={event => {
                const value = event.target.value;
                update({ match: value.endsWith("all") ? "all" : "any", negate: value.startsWith("not-") });
              }}
            >
              <option value="any">拥有所选任一角色</option>
              <option value="all">拥有所选全部角色</option>
              <option value="not-any">没有所选的任何角色</option>
              <option value="not-all">缺少所选的至少一个角色</option>
            </select>
          </label>
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
            label="待判断的数据"
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
              label="比较值"
              onChange={right => update({ right })}
            />
          )}
        </>
      )}
    </fieldset>
  );
}
