import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SearchableMultiSelect } from "./SearchableMultiSelect";

export function WorkflowParticipantPicker({
  workflowId,
  kind,
  value,
  disabled,
  readOnly = false,
  onChange,
  multiple = false,
  ordered = false,
  label: customLabel,
}: {
  workflowId: string;
  kind: "user" | "department" | "role";
  value: string[];
  disabled?: boolean;
  readOnly?: boolean;
  multiple?: boolean;
  ordered?: boolean;
  label?: string;
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim().slice(0, 100)), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const directory = trpc.workflow.participantDirectory.useQuery(
    {
      workflowId,
      kind,
      query: readOnly ? "" : search,
      selectedIds: value,
      readOnly,
    },
    { staleTime: 30_000, enabled: !disabled || (readOnly && value.length > 0) }
  );
  const people = kind === "user";
  const role = kind === "role";
  const label =
    customLabel ?? (people ? "指定处理人" : role ? "处理角色" : "处理部门");
  const options = Array.from(
    new Map(
      [
        ...(directory.data?.selected ?? []),
        ...(directory.data?.items ?? []),
      ].map(option => [option.value, option])
    ).values()
  );
  const missing = directory.isSuccess
    ? value.filter(
        id => !directory.data.selected.some(option => option.value === id)
      )
    : [];
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">
        {!multiple && (people || role) ? "* " : ""}
        {label}
      </p>
      <SearchableMultiSelect
        ariaLabel={label}
        value={value}
        options={options}
        query={query}
        onQueryChange={next => setQuery(next.slice(0, 100))}
        onChange={onChange}
        placeholder={`请选择${people ? "处理人" : role ? "角色" : "部门"}`}
        searchPlaceholder={
          people
            ? "搜索姓名或账号"
            : role
              ? "搜索角色名称或代号"
              : "搜索部门名称或代号"
        }
        emptyMessage="没有可用项目。"
        loading={directory.isFetching || query.trim() !== search}
        error={directory.isError}
        disabled={disabled || readOnly}
        requireSearch
        maxSelected={multiple ? 100 : people || role ? 1 : 100}
        hasMore={directory.data?.hasMore}
      />
      {ordered && value.length > 0 && (
        <ol aria-label="审批顺序" className="space-y-2">
          {value.map((id, index) => (
            <li
              key={id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="text-muted-foreground">{index + 1}.</span>
              <span className="min-w-0 flex-1 break-words">
                {options.find(option => option.value === id)?.label ?? id}
              </span>
              {[-1, 1].map(direction => (
                <button
                  key={direction}
                  type="button"
                  className="min-h-9 px-2 text-xs text-primary disabled:opacity-40"
                  aria-label={`${direction < 0 ? "上移" : "下移"}第${index + 1}位审批人`}
                  disabled={
                    disabled ||
                    readOnly ||
                    index + direction < 0 ||
                    index + direction >= value.length
                  }
                  onClick={() => {
                    const next = [...value];
                    [next[index], next[index + direction]] = [
                      next[index + direction],
                      next[index],
                    ];
                    onChange(next);
                  }}
                >
                  {direction < 0 ? "上移" : "下移"}
                </button>
              ))}
            </li>
          ))}
        </ol>
      )}
      {directory.isError && (
        <button
          type="button"
          className="text-sm text-blue-600 underline"
          onClick={() => void directory.refetch()}
        >
          重新查询
        </button>
      )}
      {missing.length > 0 && (
        <p role="status" className="text-xs text-amber-700">
          已选项目已停用或不存在
          {readOnly ? "，请联系流程管理员" : "，请重新选择"}：
          {missing.join("、")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {readOnly
          ? "仅查看已配置人员；修改请联系流程管理员。"
          : people
            ? "按姓名或账号搜索启用的人员。"
            : role
              ? "选择角色后，由该角色在本流程中有办理资格的人员处理。"
              : "按名称选择启用的部门；部门负责人模式留空时使用发起人的主部门。"}
      </p>
    </div>
  );
}
