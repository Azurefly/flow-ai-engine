import { visibleOrganizationIds } from "../../../shared/organization-tree-visibility";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import {
  organizationDraftKey,
  type OrganizationTarget,
} from "@shared/organization-form";
import {
  useResourceDraftState,
  useResourceDraftSummary,
  ResourceDraftRecoveryNotice,
} from "./ResourceDraftSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Edit3,
  Eye,
  KeyRound,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Plus,
  Search,
  Star,
  Trash2,
  UserPlus,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
const OrganizationMutationDialog = lazy(
  () => import("./OrganizationMutationDialog")
);

type Unit = Record<string, any> & {
  id: string;
  code: string;
  name: string;
  pathName?: string;
  pathCode?: string;
  displayPath?: string;
  memberCount?: number;
  parentUnitId?: string | null;
  status: "active" | "disabled";
};
type UnitDialogMode = "root" | "sibling" | "child" | "edit" | null;
type PageTab = "overview" | "members" | "permissions";
export default function OrganizationManagementPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const organization = trpc.config.organizationDirectory.useQuery(
    undefined,
    authorizationQueryPolicy(true)
  );
  const units = (organization.data?.units ?? []) as unknown as Unit[];
  const roleBindings = (organization.data?.roleBindings ?? []) as any[];
  const [selectedId, setSelectedId] = useResourceDraftState<string | null>(
    "organization",
    "view",
    "selection",
    null,
    false
  );
  const [dialogTarget, setDialogTarget] =
    useResourceDraftState<OrganizationTarget | null>(
      "organization",
      "context",
      "dialog",
      null,
      false
    );
  const busy = useResourceDraftSummary("organization").pending > 0;
  const pendingSelection = useRef<{ id: string; from: string | null } | null>(
    null
  );
  const [receipt, setReceipt] = useState(false);
  const openDialog = (target: OrganizationTarget) => {
    if (!busy && !dialogTarget) {
      setReceipt(false);
      setDialogTarget(structuredClone(target));
    }
  };
  const [mobileDirectoryOpen, setMobileDirectoryOpen] = useState(false);
  const [tab, setTab] = useResourceDraftState<PageTab>(
    "organization",
    "view",
    "tab",
    "overview",
    false
  );
  const [query, setQuery] = useState("");
  const [showDisabled, setShowDisabled] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const unitActionsRef = useRef<HTMLDetailsElement>(null);
  const selectedUnitActionsRef = useRef<HTMLDetailsElement>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(1);
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const membersPageQuery = trpc.config.organizationMembersPage.useQuery(
    {
      unitId: selectedId ?? "00000000-0000-0000-0000-000000000000",
      includeDescendants,
      search: memberSearch,
      page: memberPage,
      pageSize: 10,
    },
    { enabled: Boolean(selectedId) && tab === "members", retry: false }
  );
  const members = (membersPageQuery.data?.items ?? []) as any[];
  const memberPageInfo = membersPageQuery.data;
  const [roleMember, setRoleMember] = useState<any | null>(null);
  const roleMemberDetails = trpc.iam.userAuthorizationDetails.useQuery(
    { userId: Number(roleMember?.userId ?? 0) },
    {
      enabled: Boolean(roleMember),
      retry: false,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    }
  );
  const liveRoleAccount = roleMemberDetails.data?.user as any;
  const selected = units.find(unit => unit.id === selectedId) ?? null;

  useEffect(() => {
    if (pendingSelection.current) {
      const pending = pendingSelection.current;
      if (selectedId !== pending.from) pendingSelection.current = null;
      else if (units.some(unit => unit.id === pending.id)) {
        pendingSelection.current = null;
        setSelectedId(pending.id);
      } else return;
    }
    if (!units.length) {
      if (selectedId) setSelectedId(null);
      return;
    }
    const ids = visibleOrganizationIds(units, "", showDisabled);
    const available = units.filter(unit => ids.has(unit.id));
    setExpanded(current =>
      current.size ? current : new Set(units.map(unit => unit.id))
    );
    if (!selectedId || !ids.has(selectedId))
      setSelectedId(
        available.find(unit => unit.status === "active")?.id ??
          available[0]?.id ??
          null
      );
  }, [selectedId, units, showDisabled]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setMemberSearch(memberQuery.trim());
      setMemberPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [memberQuery]);

  useEffect(() => {
    setMemberPage(1);
  }, [selectedId, includeDescendants]);

  useEffect(() => {
    const resolvedPage = membersPageQuery.data?.page;
    if (resolvedPage && resolvedPage !== memberPage)
      setMemberPage(resolvedPage);
  }, [memberPage, membersPageQuery.data?.page]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Unit[]>();
    for (const unit of units) {
      const key = unit.parentUnitId || "root";
      map.set(key, [...(map.get(key) ?? []), unit]);
    }
    map.forEach(children =>
      children.sort(
        (a: Unit, b: Unit) =>
          Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
          a.name.localeCompare(b.name, "zh-CN")
      )
    );
    return map;
  }, [units]);
  const duplicateUnitNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const unit of units) {
      const name = unit.name.trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );
  }, [units]);

  const visibleIds = useMemo(
    () => visibleOrganizationIds(units, query, showDisabled),
    [units, query, showDisabled]
  );
  const refresh = () =>
    Promise.allSettled([
      utils.config.organizationDirectory.invalidate(),
      utils.config.organizationMembersPage.invalidate(),
      utils.iam.invalidate(),
      utils.auth.me.invalidate(),
      utils.workflow.access.invalidate(),
      utils.workflow.list.invalidate(),
      utils.workflow.page.invalidate(),
      utils.workflow.get.invalidate(),
      utils.project.invalidate(),
    ]);
  const read = () =>
    Promise.allSettled([
      organization.refetch(),
      utils.auth.me.fetch(),
      ...(selectedId && tab === "members" ? [membersPageQuery.refetch()] : []),
    ]);
  const openUnitDialog = (mode: Exclude<UnitDialogMode, null>) =>
    openDialog({ kind: "unit", mode, unit: selected });
  const openUnitAction = (mode: "root" | "sibling" | "child") => {
    openUnitDialog(mode);
    if (unitActionsRef.current) unitActionsRef.current.open = false;
  };
  const saved = (value?: {
    createdId?: string;
    deletedId?: string;
    parentId?: string | null;
  }) => {
    setReceipt(true);
    if (value?.createdId) {
      pendingSelection.current = { id: value.createdId, from: selectedId };
      setTab("overview");
      setQuery("");
      setMobileDirectoryOpen(false);
    }
    if (value?.deletedId === selectedId) setSelectedId(value.parentId || null);
    void refresh();
  };
  const descendantIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selected?.id) return ids;
    const queue = [selected.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (ids.has(id)) continue;
      ids.add(id);
      queue.push(...(childrenByParent.get(id) ?? []).map(unit => unit.id));
    }
    return ids;
  }, [childrenByParent, selected?.id]);
  const directSelectedMemberCount = Number(selected?.memberCount ?? 0);
  const selectedMembers = members;
  const selectedBindings = roleBindings.filter(
    binding => binding.unitId === selected?.id
  );
  const unassignedActiveUserCount = Number(
    organization.data?.unassignedActiveUserCount ?? 0
  );
  const memberUnit = (member: any) =>
    units.find(unit => unit.id === member.unitId);
  const openMoveDialog = (member: any) =>
    openDialog({ kind: "move", unit: memberUnit(member), member });
  const setMemberAsPrimary = (member: any) =>
    openDialog({ kind: "primary", unit: memberUnit(member), member });
  const removeMemberFromUnit = (member: any) =>
    openDialog({ kind: "remove", unit: memberUnit(member), member });

  const renderMemberActions = (member: any) => {
    const memberIdentity = `${member.name || member.username}（${member.username}）`;
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`查看成员权限来源：${memberIdentity}`}
          className="aiflow-type-control h-11 min-[1024px]:h-10"
          onClick={() => setRoleMember(member)}
        >
          <Eye size={13} />
          权限
        </Button>
        <details className="relative">
          <summary
            aria-label={`更多成员操作：${memberIdentity}`}
            className="aiflow-type-control inline-flex h-11 cursor-pointer list-none items-center rounded-md border border-border px-2.5 text-muted-foreground hover:bg-muted min-[1024px]:h-10"
          >
            更多
          </summary>
          <div className="absolute right-0 z-20 mt-1 grid min-w-36 gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
            <button
              type="button"
              aria-label={`编辑岗位：${memberIdentity}`}
              disabled={busy}
              className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"
              onClick={() =>
                openDialog({ kind: "member", unit: memberUnit(member), member })
              }
            >
              <Edit3 size={13} />
              编辑岗位
            </button>
            <button
              type="button"
              aria-label={`迁移成员：${memberIdentity}`}
              className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"
              disabled={busy}
              onClick={() => openMoveDialog(member)}
            >
              <MoveRight size={13} />
              迁移
            </button>
            {!member.isPrimary && (
              <button
                type="button"
                aria-label={`设为主部门：${memberIdentity}`}
                className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"
                disabled={busy}
                onClick={() => setMemberAsPrimary(member)}
              >
                <Star size={13} />
                设为主部门
              </button>
            )}
            <button
              type="button"
              aria-label={`从当前部门移除成员：${memberIdentity}`}
              className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-aiflow-danger hover:bg-aiflow-danger-surface disabled:opacity-50 min-[1024px]:h-10"
              disabled={busy}
              onClick={() => removeMemberFromUnit(member)}
            >
              <Trash2 size={13} />
              移除
            </button>
          </div>
        </details>
      </div>
    );
  };

  const renderTree = (parentId = "root", depth = 0): ReactNode =>
    (childrenByParent.get(parentId) ?? []).map(unit => {
      if (visibleIds && !visibleIds.has(unit.id)) return null;
      const children = (childrenByParent.get(unit.id) ?? []).filter(child =>
        visibleIds.has(child.id)
      );
      const isExpanded = expanded.has(unit.id) || Boolean(query.trim());
      const isDuplicateName = duplicateUnitNames.has(unit.name.trim());
      return (
        <div key={unit.id}>
          <div
            className={`group flex items-center gap-1 rounded-md pr-2 ${selectedId === unit.id ? "bg-accent text-aiflow-info" : "text-muted-foreground hover:bg-muted"}`}
            style={{ paddingLeft: `${8 + Math.min(depth, 4) * 16}px` }}
          >
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center text-muted-foreground min-[1024px]:h-10 min-[1024px]:w-10"
              aria-label={`${isExpanded ? "收起" : "展开"}${unit.name}`}
              disabled={!children.length}
              onClick={() =>
                setExpanded(current => {
                  const next = new Set(current);
                  next.has(unit.id) ? next.delete(unit.id) : next.add(unit.id);
                  return next;
                })
              }
            >
              {children.length ? (
                isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )
              ) : (
                <span className="h-1 w-1 rounded-full bg-slate-300" />
              )}
            </button>
            <button
              type="button"
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
              title={`${unit.name}${isDuplicateName ? `（${unit.code}）` : ""}`}
              onClick={() => {
                setSelectedId(unit.id);
                setMobileDirectoryOpen(false);
              }}
            >
              <Building2 size={14} className="shrink-0" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {unit.name}
              </span>
              {isDuplicateName && (
                <span
                  className="max-w-20 shrink-0 truncate rounded bg-muted px-1 py-0.5 font-mono text-xs text-muted-foreground"
                  title={unit.code}
                >
                  {unit.code}
                </span>
              )}
              {unit.status === "disabled" && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  停用
                </span>
              )}
            </button>
          </div>
          {children.length > 0 && isExpanded && renderTree(unit.id, depth + 1)}
        </div>
      );
    });

  if (organization.isError)
    return (
      <section role="alert" className="aiflow-page-frame grid gap-3">
        <p>组织目录暂不可用，已隐藏缓存。请重新读取组织与权限。</p>
        <ResourceDraftRecoveryNotice onRetry={() => void read()} />
        <Button
          variant="outline"
          disabled={busy || organization.isFetching}
          onClick={() => void read()}
        >
          重新读取组织与权限
        </Button>
      </section>
    );
  if (organization.isLoading) return <p role="status">正在读取组织目录…</p>;
  return (
    <div
      data-aiflow-organization-page=""
      className="aiflow-page-frame bg-background"
    >
      <div className="aiflow-page-content overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-col gap-4 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <button
              type="button"
              className="aiflow-type-control mb-2 flex min-h-11 items-center gap-1 text-aiflow-info hover:underline min-[1024px]:min-h-10"
              onClick={onBack}
            >
              <ArrowLeft size={15} />
              返回系统配置
            </button>
            <p className="aiflow-type-meta font-medium text-muted-foreground">
              人员与权限
            </p>
            <h1 className="aiflow-type-page-title mt-1 font-semibold text-foreground">
              组织架构管理
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              管理部门、负责人、成员岗位与权限来源，支持流程按直属上级或角色分配任务。
            </p>
          </div>
          <details
            ref={unitActionsRef}
            className="relative self-start sm:self-auto"
          >
            <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-md bg-[#2d6bea] px-3 text-sm font-medium text-white shadow-2xs hover:bg-[#245fc8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 min-[1024px]:h-10">
              <Plus size={15} />
              新增部门 <ChevronDown size={14} />
            </summary>
            <div className="absolute right-0 z-30 mt-1 grid min-w-48 gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
              <button
                type="button"
                className="flex h-11 items-center gap-2 rounded px-2.5 text-left text-sm text-foreground hover:bg-muted min-[1024px]:h-10"
                onClick={() => openUnitAction("root")}
              >
                <Plus size={14} />
                新增根部门
              </button>
              {selected && (
                <>
                  <button
                    type="button"
                    className="flex h-11 items-center gap-2 rounded px-2.5 text-left text-sm text-foreground hover:bg-muted min-[1024px]:h-10"
                    onClick={() => openUnitAction("sibling")}
                  >
                    <Plus size={14} />
                    新增同级部门
                  </button>
                  <button
                    type="button"
                    className="flex h-11 items-center gap-2 rounded px-2.5 text-left text-sm text-foreground hover:bg-muted min-[1024px]:h-10"
                    onClick={() => openUnitAction("child")}
                  >
                    <Plus size={14} />
                    新增子部门
                  </button>
                </>
              )}
            </div>
          </details>
        </header>
        {receipt && (
          <p
            role="status"
            className="m-4 rounded-lg border border-aiflow-success-border bg-aiflow-success-surface p-3 text-sm"
          >
            组织配置已保存{organization.isFetching ? "，正在刷新列表。" : "。"}
          </p>
        )}
        {tab === "members" && membersPageQuery.isError && (
          <div
            role="alert"
            className="m-4 flex flex-col gap-3 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface px-4 py-3 text-sm text-aiflow-danger sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {membersPageQuery.error?.message || "组织管理数据读取失败。"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 min-[1024px]:h-10"
              onClick={() => {
                void organization.refetch();
                void membersPageQuery.refetch();
              }}
            >
              重新加载
            </Button>
          </div>
        )}
        <div className="grid min-h-[650px] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside
            className={`border-b border-border bg-muted p-3 lg:border-b-0 lg:border-r ${selected && !mobileDirectoryOpen ? "hidden lg:block" : ""}`}
          >
            <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground min-[1024px]:h-10">
              <Search size={14} />
              <Input
                aria-label="搜索组织机构"
                className="h-11 border-0 px-0 shadow-none focus-visible:ring-0 min-[1024px]:h-7"
                placeholder="搜索名称、编码、标准编码"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showDisabled}
                onChange={event => setShowDisabled(event.target.checked)}
              />
              显示停用部门
            </label>
            <div className="mt-3 max-h-[520px] overflow-y-auto">
              {organization.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 size={15} className="animate-spin" />
                  正在读取机构树…
                </div>
              ) : (
                renderTree()
              )}
              {!organization.isLoading &&
                units.length > 0 &&
                !query.trim() &&
                visibleIds.size === 0 && (
                  <p className="p-6 text-sm text-muted-foreground">
                    暂无启用部门，可勾选“显示停用部门”。
                  </p>
                )}
              {!organization.isLoading && !units.length && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  尚未创建部门，请点击“新增根部门”。
                </div>
              )}
              {!organization.isLoading &&
                Boolean(query.trim()) &&
                units.length > 0 &&
                visibleIds?.size === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    没有匹配的机构，请更换关键词。
                  </div>
                )}
            </div>
            <div className="mt-4 rounded-lg border border-border bg-card p-3">
              <p className="aiflow-type-section-title font-semibold text-foreground">
                账号归属提示
              </p>
              <p className="aiflow-type-body mt-1 text-muted-foreground">
                未分配部门账号：{unassignedActiveUserCount}{" "}
                个。成员可属于多个部门，唯一主部门用于直属上级解析。
              </p>
            </div>
          </aside>
          <section
            className={`min-w-0 p-4 sm:p-6 ${mobileDirectoryOpen ? "hidden lg:block" : ""}`}
          >
            {!selected ? (
              <div className="grid min-h-[460px] place-items-center text-sm text-muted-foreground">
                请从左侧选择部门，或创建根部门。
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mb-3 h-11 lg:hidden"
                      onClick={() => setMobileDirectoryOpen(true)}
                    >
                      <Building2 size={14} />
                      切换部门
                    </Button>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-xl font-semibold text-foreground">
                        {selected.name}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${selected.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
                      >
                        {selected.status === "active" ? "启用" : "停用"}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-aiflow-info">
                      {selected.code}
                    </p>
                    <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
                      {selected.displayPath ||
                        `${selected.name}（${selected.code}）`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 min-[1024px]:h-10"
                      onClick={() => openUnitDialog("edit")}
                    >
                      <Edit3 size={14} />
                      编辑部门
                    </Button>
                    <details ref={selectedUnitActionsRef} className="relative">
                      <summary
                        aria-label="更多部门操作"
                        className="aiflow-type-control inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md border border-border px-3 text-foreground hover:bg-muted"
                      >
                        <MoreHorizontal size={15} />
                        更多操作
                        <ChevronDown size={14} />
                      </summary>
                      <div className="absolute right-0 z-30 mt-1 grid min-w-48 gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
                        <button
                          type="button"
                          className="aiflow-type-control flex min-h-11 items-center gap-2 rounded px-2.5 text-left text-foreground hover:bg-muted"
                          disabled={busy}
                          onClick={() => {
                            selectedUnitActionsRef.current?.removeAttribute(
                              "open"
                            );
                            openDialog({
                              kind: "status",
                              unit: selected,
                              status:
                                selected.status === "active"
                                  ? "disabled"
                                  : "active",
                              affectedMemberCount: units.reduce(
                                (count, unit) =>
                                  descendantIds.has(unit.id)
                                    ? count + Number(unit.memberCount ?? 0)
                                    : count,
                                0
                              ),
                            });
                          }}
                        >
                          {selected.status === "active"
                            ? "停用部门"
                            : "启用部门"}
                        </button>
                        <div className="mt-1 border-t border-border pt-1">
                          <button
                            type="button"
                            className="aiflow-type-control flex min-h-11 w-full items-center gap-2 rounded px-2.5 text-left text-aiflow-danger hover:bg-aiflow-danger-surface"
                            onClick={() => {
                              selectedUnitActionsRef.current?.removeAttribute(
                                "open"
                              );
                              openDialog({ kind: "delete", unit: selected });
                            }}
                          >
                            <Trash2 size={14} />
                            删除部门…
                          </button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
                <div
                  role="tablist"
                  aria-label="组织部门详情"
                  className="mt-5 grid min-w-0 grid-cols-3 gap-1 border-b border-border sm:flex sm:flex-wrap"
                >
                  {(
                    [
                      { id: "overview", label: "部门概览", icon: Building2 },
                      {
                        id: "members",
                        label: `成员与岗位 (${directSelectedMemberCount})`,
                        icon: UsersRound,
                      },
                      {
                        id: "permissions",
                        label: `权限组 (${selectedBindings.length})`,
                        icon: KeyRound,
                      },
                    ] as const
                  ).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      className={`aiflow-type-control flex h-11 min-w-0 items-center justify-center gap-1 border-b-2 px-1.5 text-center sm:gap-2 sm:px-4 ${tab === item.id ? "border-aiflow-info bg-aiflow-info-surface text-aiflow-info" : "border-transparent text-muted-foreground hover:bg-muted"}`}
                      onClick={() => setTab(item.id)}
                    >
                      <item.icon size={15} />
                      <span className="min-w-0 whitespace-normal">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
                {tab === "overview" && (
                  <div className="mt-4 grid grid-cols-1 gap-2 min-[448px]:grid-cols-2 xl:grid-cols-3">
                    <Info
                      label="上级部门"
                      value={selected.parentName || "根部门"}
                    />
                    <Info
                      label="完整组织路径"
                      value={
                        selected.displayPath ||
                        `${selected.name}（${selected.code}）`
                      }
                    />
                    <Info
                      label="部门负责人"
                      value={
                        selected.managerName ||
                        selected.managerUsername ||
                        "未指定"
                      }
                    />
                    <details className="min-w-0 rounded-lg border border-border min-[448px]:col-span-2 xl:col-span-3">
                      <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center px-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring min-[1024px]:min-h-10">
                        更多组织属性
                      </summary>
                      <div className="grid min-w-0 grid-cols-1 gap-2 p-3 min-[448px]:grid-cols-2 xl:grid-cols-3">
                        <Info
                          label="机构类型"
                          value={selected.unitType || "未配置"}
                        />
                        <Info
                          label="机构层级"
                          value={
                            selected.unitLevel
                              ? `第 ${selected.unitLevel} 级`
                              : "未配置"
                          }
                        />
                        <Info
                          label="标准编码"
                          value={selected.standardCode || "未配置"}
                        />
                        <Info
                          label="行政区划"
                          value={selected.areaCode || "未配置"}
                        />
                        <Info
                          label="机构分类"
                          value={selected.category || "未配置"}
                        />
                        <Info
                          label="排序"
                          value={String(selected.sortOrder || 0)}
                        />
                        <Info
                          label="更新时间"
                          value={
                            selected.updatedAt
                              ? new Date(selected.updatedAt).toLocaleString(
                                  "zh-CN",
                                  { hour12: false }
                                )
                              : "—"
                          }
                        />
                      </div>
                    </details>
                    <div className="rounded-lg border border-border p-4 min-[448px]:col-span-2 xl:col-span-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        部门说明
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {selected.description || "未填写说明"}
                      </p>
                    </div>
                  </div>
                )}
                {tab === "members" && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="aiflow-type-body text-muted-foreground">
                        成员可跨部门任职；主部门用于确定直属上级。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 min-[1024px]:h-10"
                          onClick={() => {
                            openDialog({ kind: "new-user", unit: selected });
                          }}
                        >
                          <UserRoundPlus size={15} />
                          新建内部用户
                        </Button>
                        <Button
                          type="button"
                          className="h-11 min-[1024px]:h-10"
                          onClick={() =>
                            openDialog({ kind: "member", unit: selected })
                          }
                        >
                          <UserPlus size={15} />
                          添加已有成员
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted p-3 sm:flex-row sm:items-center">
                      <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 text-muted-foreground min-[1024px]:h-10">
                        <Search size={14} />
                        <Input
                          aria-label="搜索部门成员"
                          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                          placeholder="搜索姓名、登录名或岗位"
                          value={memberQuery}
                          onChange={event => setMemberQuery(event.target.value)}
                        />
                      </label>
                      <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={includeDescendants}
                          onChange={event =>
                            setIncludeDescendants(event.target.checked)
                          }
                        />
                        包含子机构成员
                      </label>
                    </div>
                    {membersPageQuery.isFetching && (
                      <p
                        role="status"
                        aria-live="polite"
                        className="aiflow-type-body mt-3 text-muted-foreground"
                      >
                        正在读取当前范围的成员…
                      </p>
                    )}
                    <div className="mt-4 grid gap-3 min-[1024px]:grid-cols-2 min-[1360px]:hidden">
                      {selectedMembers.map(member => (
                        <article
                          key={member.id}
                          className="min-w-0 rounded-lg border border-border bg-card p-3"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="aiflow-type-card-title break-words font-semibold text-foreground">
                                {member.name || member.username}
                              </h3>
                              <p className="aiflow-type-meta mt-0.5 break-all text-muted-foreground">
                                {member.username}
                                <OrganizationAccountStatus
                                  status={member.userStatus}
                                />
                              </p>
                            </div>
                            <span className="aiflow-type-meta shrink-0 rounded bg-aiflow-info-surface px-2 py-1 text-aiflow-info">
                              {member.isPrimary ? "主部门" : "兼任部门"}
                            </span>
                          </div>
                          <div className="aiflow-type-body mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                            <span>{member.title || "未配置岗位"}</span>
                            <span className="text-muted-foreground">
                              {member.unitName || selected.name}
                            </span>
                          </div>
                          <div className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-1">
                            <details className="min-w-0">
                              <summary className="aiflow-type-control inline-flex min-h-11 cursor-pointer items-center text-muted-foreground hover:text-foreground">
                                部门路径
                              </summary>
                              <p className="aiflow-type-body break-words leading-5 text-muted-foreground">
                                {member.unitDisplayPath ||
                                  member.unitName ||
                                  "—"}
                              </p>
                            </details>
                            <div className="shrink-0">
                              {renderMemberActions(member)}
                            </div>
                          </div>
                        </article>
                      ))}
                      {!selectedMembers.length &&
                        !membersPageQuery.isFetching &&
                        !membersPageQuery.isError && (
                          <div className="rounded-lg border border-dashed border-input px-4 py-10 text-center text-sm text-muted-foreground">
                            {memberQuery.trim()
                              ? "没有匹配的成员，请更换关键词。"
                              : includeDescendants
                                ? "当前机构及子机构暂无成员。"
                                : "当前部门暂无成员。"}
                          </div>
                        )}
                    </div>
                    <div className="mt-4 hidden overflow-x-auto min-[1360px]:block">
                      <table className="w-full min-w-[920px] text-left text-sm">
                        <thead className="bg-muted text-sm text-muted-foreground">
                          <tr>
                            <th className="px-4 py-3">成员</th>
                            <th className="px-4 py-3">登录名</th>
                            <th className="px-4 py-3">岗位/职务</th>
                            <th className="px-4 py-3">所属部门</th>
                            <th className="px-4 py-3">部门关系</th>
                            <th className="px-4 py-3">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMembers.map(member => (
                            <tr
                              key={member.id}
                              className="border-t border-border"
                            >
                              <td className="max-w-[220px] break-words px-4 py-3 font-medium text-foreground">
                                {member.name || member.username}
                                <OrganizationAccountStatus
                                  status={member.userStatus}
                                />
                              </td>
                              <td className="aiflow-type-meta max-w-[220px] break-all px-4 py-3 text-muted-foreground">
                                {member.username}
                              </td>
                              <td className="max-w-[220px] break-words px-4 py-3">
                                {member.title || "未配置"}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {member.unitDisplayPath ||
                                  member.unitName ||
                                  "—"}
                              </td>
                              <td className="px-4 py-3">
                                {member.isPrimary ? (
                                  <span className="rounded bg-aiflow-info-surface px-2 py-1 text-xs text-aiflow-info">
                                    主部门
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">
                                    兼任部门
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {renderMemberActions(member)}
                              </td>
                            </tr>
                          ))}
                          {!selectedMembers.length &&
                            !membersPageQuery.isFetching &&
                            !membersPageQuery.isError && (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="p-10 text-center text-muted-foreground"
                                >
                                  {memberQuery.trim()
                                    ? "没有匹配的成员，请更换关键词。"
                                    : includeDescendants
                                      ? "当前机构及子机构暂无成员。"
                                      : "当前部门暂无成员。"}
                                </td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                    {memberPageInfo && memberPageInfo.total > 0 && (
                      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="aiflow-type-body text-muted-foreground">
                          显示 {memberPageInfo.from}–{memberPageInfo.to} 项，共{" "}
                          {memberPageInfo.total} 位成员
                        </p>
                        {memberPageInfo.totalPages > 1 && (
                          <nav
                            aria-label="成员分页"
                            className="flex items-center gap-2"
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-11 min-[1024px]:h-10"
                              disabled={
                                memberPageInfo.page <= 1 ||
                                membersPageQuery.isFetching
                              }
                              onClick={() =>
                                setMemberPage(page => Math.max(1, page - 1))
                              }
                            >
                              上一页
                            </Button>
                            <span
                              aria-live="polite"
                              className="aiflow-type-meta whitespace-nowrap text-muted-foreground"
                            >
                              第 {memberPageInfo.page} /{" "}
                              {memberPageInfo.totalPages} 页
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-11 min-[1024px]:h-10"
                              disabled={
                                memberPageInfo.page >=
                                  memberPageInfo.totalPages ||
                                membersPageQuery.isFetching
                              }
                              onClick={() => setMemberPage(page => page + 1)}
                            >
                              下一页
                            </Button>
                          </nav>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {tab === "permissions" && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="aiflow-type-body text-muted-foreground">
                        绑定后，部门启用成员按有效期实时继承权限；可选择是否覆盖子部门成员。
                      </p>
                      <Button
                        type="button"
                        className="h-11 min-[1024px]:h-10"
                        onClick={() => {
                          openDialog({ kind: "role", unit: selected });
                        }}
                      >
                        <KeyRound size={15} />
                        绑定权限组
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {selectedBindings.map(binding => (
                        <div
                          key={binding.id}
                          className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="aiflow-type-card-title min-w-0 break-words font-semibold text-foreground">
                                {binding.roleName}
                              </p>
                              <code className="aiflow-type-meta max-w-full break-all rounded bg-muted px-2 py-1 text-aiflow-info">
                                {binding.roleCode}
                              </code>
                            </div>
                            <p className="aiflow-type-body mt-1 text-muted-foreground">
                              {binding.roleDescription || "未填写权限组说明"}
                            </p>
                            <p className="aiflow-type-body mt-2 text-muted-foreground">
                              {binding.includeDescendants
                                ? "当前部门及所有子部门成员"
                                : "仅当前部门直接成员"}
                              {binding.expiresAt
                                ? ` · 有效至 ${new Date(binding.expiresAt).toLocaleString()}`
                                : " · 长期有效"}
                            </p>
                          </div>
                          <details className="relative self-start">
                            <summary
                              aria-label={`权限组 ${binding.roleName} 的操作`}
                              className="aiflow-type-control inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md border border-border px-3 text-foreground hover:bg-muted"
                            >
                              <MoreHorizontal size={15} />
                              更多操作
                              <ChevronDown size={14} />
                            </summary>
                            <div className="absolute right-0 z-30 mt-1 grid min-w-40 gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
                              <button
                                type="button"
                                className="aiflow-type-control flex min-h-11 items-center gap-2 rounded px-2.5 text-left text-aiflow-danger hover:bg-aiflow-danger-surface"
                                disabled={busy}
                                onClick={event => {
                                  event.currentTarget
                                    .closest("details")
                                    ?.removeAttribute("open");
                                  openDialog({
                                    kind: "unbind",
                                    unit: selected,
                                    binding,
                                  });
                                }}
                              >
                                <Trash2 size={14} />
                                解绑权限组…
                              </button>
                            </div>
                          </details>
                        </div>
                      ))}
                      {!selectedBindings.length && (
                        <div className="aiflow-type-body rounded-lg border border-dashed border-border px-4 py-5 text-center text-muted-foreground">
                          当前部门尚未绑定权限组。
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <Dialog
        open={Boolean(roleMember)}
        onOpenChange={open => !open && setRoleMember(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {roleMember?.name || roleMember?.username || "成员"}的权限来源
            </DialogTitle>
            <DialogDescription>
              直接授权与部门继承分栏展示；部门解绑后继承权限立即失效，不会变成直接授权。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="aiflow-type-body text-muted-foreground">
              {roleMember?.username} · 系统级角色 · 每 30 秒更新
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={roleMemberDetails.isFetching}
              onClick={() => void roleMemberDetails.refetch()}
            >
              刷新权限来源
            </Button>
          </div>
          {roleMemberDetails.isError ? (
            <div role="alert" className="text-sm text-destructive">
              <p>读取权限来源失败：{roleMemberDetails.error.message}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void roleMemberDetails.refetch()}
              >
                重新读取权限
              </Button>
            </div>
          ) : roleMemberDetails.isLoading ? (
            <p role="status">正在读取最新权限来源…</p>
          ) : roleMemberDetails.data ? (
            <>
              {liveRoleAccount?.status === "disabled" && (
                <p
                  role="alert"
                  className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground"
                >
                  账号已停用：下方保留角色配置来源，该账号不能登录或执行操作。
                </p>
              )}
              {liveRoleAccount?.status === "active" &&
                liveRoleAccount?.role === "admin" && (
                  <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
                    系统管理员账号拥有全部系统权限，下方展示额外配置的角色来源。
                  </p>
                )}
              <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
                <RoleSourceList
                  title="用户直接角色"
                  empty="当前没有有效期内的系统级直接角色。"
                  roles={(roleMemberDetails.data.directRoles ?? []).filter(
                    role => role.scopeType === "system"
                  )}
                  source={role =>
                    role.expiresAt
                      ? `有效至 ${new Date(role.expiresAt).toLocaleString("zh-CN", { hour12: false })}`
                      : "系统级直接授权 · 长期"
                  }
                />
                <RoleSourceList
                  title="部门继承角色"
                  empty="当前没有从所属部门继承角色。"
                  roles={roleMemberDetails.data.inheritedRoles ?? []}
                  source={role =>
                    `继承自 ${role.unitName || "未命名部门"}${role.unitCode ? `（${role.unitCode}）` : ""} · ${role.expiresAt ? `有效至 ${new Date(role.expiresAt).toLocaleString("zh-CN", { hour12: false })}` : "长期"}`
                  }
                />
              </div>
            </>
          ) : (
            <p role="status">未找到该账号的权限来源。</p>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setRoleMember(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogTarget && (
        <Suspense
          fallback={
            <div
              role="status"
              className="fixed inset-0 z-50 grid place-items-center bg-background/90"
            >
              正在读取组织表单…
            </div>
          }
        >
          <OrganizationMutationDialog
            key={organizationDraftKey(dialogTarget)}
            target={dialogTarget}
            units={units}
            bindings={roleBindings}
            reading={organization.isFetching}
            onClose={() => setDialogTarget(null)}
            onRead={read}
            onSaved={saved}
          />
        </Suspense>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border p-3">
      <p className="aiflow-type-meta font-medium text-muted-foreground">
        {label}
      </p>
      <p className="aiflow-type-body mt-1 break-words font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

function RoleSourceList({
  title,
  empty,
  roles,
  source,
}: {
  title: string;
  empty: string;
  roles: any[];
  source: (role: any) => string;
}) {
  return (
    <section className="rounded-lg border border-border bg-muted p-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 grid gap-2">
        {roles.map((role, index) => (
          <div
            key={`${role.roleId}-${role.unitId || role.assignmentId || index}`}
            className="rounded-md border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">
                {role.roleName}
              </span>
              <code className="max-w-full break-all rounded bg-aiflow-info-surface px-1.5 py-0.5 text-[10px] text-aiflow-info">
                {role.roleCode}
              </code>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{source(role)}</p>
          </div>
        ))}
        {!roles.length && (
          <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}

function OrganizationAccountStatus({ status }: { status: unknown }) {
  const label =
    status === "active"
      ? "账号启用"
      : status === "disabled"
        ? "账号停用"
        : "账号状态未确认";
  return (
    <span
      className={`aiflow-type-meta ml-2 inline-flex whitespace-nowrap rounded px-1.5 py-0.5 font-normal ${status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}
