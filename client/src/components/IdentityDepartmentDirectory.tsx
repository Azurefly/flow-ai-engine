import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, Plus, UsersRound } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { visibleOrganizationIds } from "@shared/organization-tree-visibility";

export type IdentityUnit = {
  id: string; name: string; code: string; parentUnitId?: string | null;
  status: string; displayPath?: string; memberCount?: number;
};

export function IdentityDepartmentDirectory({ units, selected, onSelect, onCreate, loading, error, onRetry }: {
  units: IdentityUnit[]; selected: string; onSelect: (id: string) => void;
  onCreate: () => void; loading: boolean; error?: string; onRetry: () => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const visible = useMemo(() => visibleOrganizationIds(units, search, true), [units, search]);
  const byParent = useMemo(() => {
    const map = new Map<string, IdentityUnit[]>();
    for (const unit of units) {
      const parent = unit.parentUnitId && units.some(row => row.id === unit.parentUnitId) ? unit.parentUnitId : "";
      map.set(parent, [...(map.get(parent) ?? []), unit]);
    }
    return map;
  }, [units]);
  const renderUnits = (parent: string, ancestors: Set<string> = new Set()) =>
    (byParent.get(parent) ?? []).filter(unit => visible.has(unit.id) && !ancestors.has(unit.id)).map(unit => {
      const children = byParent.get(unit.id)?.some(child => visible.has(child.id));
      const expanded = !!search || !collapsed.has(unit.id);
      return <li key={unit.id}>
        <div className="identity-department-row">
          {children ? <button type="button" className="identity-tree-toggle" aria-label={`${expanded ? "收起" : "展开"}部门：${unit.name}`} aria-expanded={expanded} onClick={() => setCollapsed(old => {
            const next = new Set(old); next.has(unit.id) ? next.delete(unit.id) : next.add(unit.id); return next;
          })}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button> : <span className="identity-tree-toggle"/>}
          <button type="button" aria-pressed={selected === unit.id} title={`${unit.displayPath || unit.name}（${unit.code}）`} onClick={() => onSelect(unit.id)}>
            <Building2 size={15}/><span>{unit.name}{unit.status !== "active" ? "（停用）" : ""}</span><small>{unit.memberCount ?? 0}</small>
          </button>
        </div>
        {children && expanded && <ul>{renderUnits(unit.id, new Set([...Array.from(ancestors), unit.id]))}</ul>}
      </li>;
    });
  return <aside className="identity-departments" aria-label="按部门查看用户">
    <div className="identity-directory-heading"><h2>部门目录</h2><Button size="icon" variant="ghost" aria-label="新增部门" title="新增部门" disabled={loading || !!error} onClick={onCreate}><Plus size={16}/></Button></div>
    <Input aria-label="搜索部门" placeholder="搜索部门名称或编码" value={search} onChange={event => setSearch(event.target.value)}/>
    <nav aria-label="用户部门筛选">
      <button type="button" aria-pressed={selected === ""} onClick={() => onSelect("")}><UsersRound size={16}/><span>全部用户</span></button>
      <button type="button" aria-pressed={selected === "unassigned"} onClick={() => onSelect("unassigned")}><UsersRound size={16}/><span>未分配部门</span></button>
    </nav>
    <div className="identity-tree-scroll">
      {loading ? <p role="status">正在读取部门…</p> : error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={onRetry}>重新读取部门</Button></div> : <ul aria-label="部门层级">{renderUnits("")}</ul>}
      {!loading && !error && !units.length && <p>暂无部门，可先新增部门，再添加用户。</p>}
      {!!search && !visible.size && <p>没有匹配的部门。</p>}
    </div>
    <p className="identity-directory-hint">选择部门查看直属成员；新建用户将带入所选部门。</p>
  </aside>;
}
