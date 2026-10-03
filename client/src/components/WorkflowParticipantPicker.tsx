import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SearchableMultiSelect } from "./SearchableMultiSelect";

export function WorkflowParticipantPicker({
  workflowId,
  kind,
  value,
  disabled,
  onChange,
}: {
  workflowId: string;
  kind: "user" | "department";
  value: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim().slice(0, 100)), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const directory = trpc.workflow.participantDirectory.useQuery(
    { workflowId, kind, query: search, selectedIds: value },
    { staleTime: 30_000, enabled: !disabled }
  );
  const people = kind === "user";
  const label = people ? "指定处理人" : "处理部门";
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
        {people ? "* " : ""}
        {label}
      </p>
      <SearchableMultiSelect
        ariaLabel={label}
        value={value}
        options={options}
        query={query}
        onQueryChange={next => setQuery(next.slice(0, 100))}
        onChange={onChange}
        placeholder={people ? "请选择处理人" : "请选择部门"}
        searchPlaceholder={people ? "搜索姓名或账号" : "搜索部门名称或代号"}
        emptyMessage="没有可用项目。"
        loading={directory.isFetching || query.trim() !== search}
        error={directory.isError}
        disabled={disabled}
        requireSearch
        maxSelected={people ? 1 : 100}
        hasMore={directory.data?.hasMore}
      />
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
          已选项目已停用或不存在，请重新选择：{missing.join("、")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {people
          ? "按姓名或账号搜索启用的人员。"
          : "按名称选择启用的部门；部门负责人模式留空时使用发起人的主部门。"}
      </p>
    </div>
  );
}
