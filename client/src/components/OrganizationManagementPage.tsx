import { CreationDialog } from "@/components/CreationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  KeyRound,
  Loader2,
  MoveRight,
  Plus,
  Search,
  Star,
  Trash2,
  UserPlus,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Unit = Record<string, any> & {
  id: string;
  code: string;
  name: string;
  pathName?: string;
  pathCode?: string;
  displayPath?: string;
  parentUnitId?: string | null;
  status: "active" | "disabled";
};
type UnitDialogMode = "root" | "sibling" | "child" | "edit" | null;
type PageTab = "overview" | "members" | "permissions";

const emptyUnitForm = {
  code: "",
  name: "",
  parentUnitId: "",
  managerUserId: "",
  unitType: "department",
  unitLevel: "",
  standardCode: "",
  areaCode: "",
  category: "",
  sortOrder: "0",
  description: "",
};

export default function OrganizationManagementPage({
  onBack,
}: {
  onBack: () => void;
}) {
  const utils = trpc.useUtils();
  const organization = trpc.config.organization.useQuery(undefined, {
    retry: false,
  });
  const users = trpc.iam.users.useQuery(undefined, { retry: false });
  const roles = trpc.iam.roles.useQuery({ scope: "system" }, { retry: false });
  const units = (organization.data?.units ?? []) as Unit[];
  const members = (organization.data?.members ?? []) as any[];
  const roleBindings = (organization.data?.roleBindings ?? []) as any[];
  const activeUsers = (users.data ?? []).filter(
    (user: any) => user.status === "active"
  );
  const eligibleRoles = (roles.data ?? []).filter(
    (role: any) => role.scope === "system" && role.code !== "system_admin"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PageTab>("overview");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [unitDialog, setUnitDialog] = useState<UnitDialogMode>(null);
  const [unitForm, setUnitForm] = useState(emptyUnitForm);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [memberForm, setMemberForm] = useState({
    userId: "",
    title: "",
    isPrimary: true,
  });
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [roleIncludesDescendants, setRoleIncludesDescendants] = useState(true);
  const [roleExpiresAt, setRoleExpiresAt] = useState("");
  const [movingMember, setMovingMember] = useState<any | null>(null);
  const [moveForm, setMoveForm] = useState({
    toUnitId: "",
    title: "",
    makePrimary: false,
  });
  const [roleMember, setRoleMember] = useState<any | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createdUserId, setCreatedUserId] = useState<number | null>(null);
  const [newUserForm, setNewUserForm] = useState({
    username: "",
    password: "",
    name: "",
    email: "",
    role: "user" as "user" | "admin",
    title: "",
    isPrimary: true,
  });
  const selected = units.find(unit => unit.id === selectedId) ?? null;

  useEffect(() => {
    if (!units.length) {
      setSelectedId(null);
      return;
    }
    setExpanded(current =>
      current.size ? current : new Set(units.map(unit => unit.id))
    );
    if (!selectedId || !units.some(unit => unit.id === selectedId))
      setSelectedId(units[0].id);
  }, [selectedId, units]);

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

  const visibleIds = useMemo(() => {
    if (!query.trim()) return null;
    const value = query.trim().toLowerCase();
    const ids = new Set<string>();
    for (const unit of units) {
      if (
        !`${unit.name} ${unit.code} ${unit.pathName || ""} ${unit.pathCode || ""} ${unit.standardCode || ""}`
          .toLowerCase()
          .includes(value)
      )
        continue;
      ids.add(unit.id);
      let parentId = unit.parentUnitId;
      while (parentId) {
        ids.add(parentId);
        parentId = units.find(item => item.id === parentId)?.parentUnitId;
      }
    }
    return ids;
  }, [query, units]);

  const createUnit = trpc.config.createOrganizationUnit.useMutation();
  const updateUnit = trpc.config.updateOrganizationUnit.useMutation();
  const assignMember = trpc.config.assignOrganizationMember.useMutation();
  const removeMember = trpc.config.removeOrganizationMember.useMutation();
  const setPrimaryMembership =
    trpc.config.setPrimaryOrganizationMembership.useMutation();
  const moveMember = trpc.config.moveOrganizationMember.useMutation();
  const deleteUnit = trpc.config.deleteOrganizationUnit.useMutation();
  const createInternalUser = trpc.iam.createUser.useMutation();
  const bindRole = trpc.config.bindOrganizationRole.useMutation();
  const unbindRole = trpc.config.unbindOrganizationRole.useMutation();
  const refresh = async () => {
    await utils.config.organization.invalidate();
  };

  const openUnitDialog = (mode: Exclude<UnitDialogMode, null>) => {
    if (mode === "edit" && selected) {
      setUnitForm({
        code: selected.code,
        name: selected.name,
        parentUnitId: selected.parentUnitId || "",
        managerUserId: selected.managerUserId
          ? String(selected.managerUserId)
          : "",
        unitType: selected.unitType || "",
        unitLevel: selected.unitLevel ? String(selected.unitLevel) : "",
        standardCode: selected.standardCode || "",
        areaCode: selected.areaCode || "",
        category: selected.category || "",
        sortOrder: String(selected.sortOrder || 0),
        description: selected.description || "",
      });
    } else {
      const parentUnitId =
        mode === "child"
          ? selected?.id || ""
          : mode === "sibling"
            ? selected?.parentUnitId || ""
            : "";
      setUnitForm({ ...emptyUnitForm, parentUnitId });
    }
    setUnitDialog(mode);
  };

  const submitUnit = async () => {
    try {
      const common = {
        name: unitForm.name,
        parentUnitId: unitForm.parentUnitId || null,
        managerUserId: unitForm.managerUserId
          ? Number(unitForm.managerUserId)
          : null,
        unitType: unitForm.unitType || null,
        unitLevel: unitForm.unitLevel ? Number(unitForm.unitLevel) : null,
        standardCode: unitForm.standardCode || null,
        areaCode: unitForm.areaCode || null,
        category: unitForm.category || null,
        sortOrder: Number(unitForm.sortOrder || 0),
        description: unitForm.description || null,
      };
      if (unitDialog === "edit" && selected)
        await updateUnit.mutateAsync({ id: selected.id, ...common });
      else {
        const result = await createUnit.mutateAsync({
          code: unitForm.code,
          ...common,
        });
        setSelectedId(result.id);
      }
      await refresh();
      setUnitDialog(null);
      setUnitForm(emptyUnitForm);
      toast.success(
        unitDialog === "edit" ? "部门信息已保存。" : "部门已创建。 "
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "部门保存失败。");
    }
  };

  const submitMember = async () => {
    if (!selected) return;
    try {
      await assignMember.mutateAsync({
        unitId: selected.id,
        userId: Number(memberForm.userId),
        title: memberForm.title || undefined,
        isPrimary: memberForm.isPrimary,
      });
      await refresh();
      setMemberOpen(false);
      setMemberForm({ userId: "", title: "", isPrimary: true });
      toast.success("成员与岗位关系已保存。 ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "成员保存失败。");
    }
  };

  const submitRole = async () => {
    if (!selected) return;
    try {
      await bindRole.mutateAsync({
        unitId: selected.id,
        roleId: Number(roleId),
        includeDescendants: roleIncludesDescendants,
        expiresAt: roleExpiresAt ? new Date(roleExpiresAt) : null,
      });
      await refresh();
      setRoleOpen(false);
      setRoleId("");
      setRoleIncludesDescendants(true);
      setRoleExpiresAt("");
      toast.success("部门权限组已绑定，成员权限即时生效。 ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "权限组绑定失败。");
    }
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
  const directSelectedMembers = members.filter(
    member => member.unitId === selected?.id
  );
  const selectedMembers = members.filter(member => {
    const inScope = includeDescendants
      ? descendantIds.has(member.unitId)
      : member.unitId === selected?.id;
    if (!inScope) return false;
    const keyword = memberQuery.trim().toLowerCase();
    return (
      !keyword ||
      `${member.name || ""} ${member.username || ""} ${member.title || ""}`
        .toLowerCase()
        .includes(keyword)
    );
  });
  const selectedBindings = roleBindings.filter(
    binding => binding.unitId === selected?.id
  );
  const assignedUserIds = new Set(members.map(member => Number(member.userId)));
  const unassignedUsers = activeUsers.filter(
    (user: any) => !assignedUserIds.has(Number(user.id))
  );
  const pending = createUnit.isPending || updateUnit.isPending;

  const openMoveDialog = (member: any) => {
    setMovingMember(member);
    setMoveForm({
      toUnitId: "",
      title: member.title || "",
      makePrimary: Boolean(member.isPrimary),
    });
  };

  const submitMove = async () => {
    if (!movingMember || !moveForm.toUnitId) return;
    try {
      await moveMember.mutateAsync({
        fromUnitId: movingMember.unitId,
        toUnitId: moveForm.toUnitId,
        userId: Number(movingMember.userId),
        title: moveForm.title,
        makePrimary: moveForm.makePrimary,
      });
      await refresh();
      setMovingMember(null);
      toast.success("成员已迁移到目标部门。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "成员迁移失败。");
    }
  };

  const resetNewUser = () => {
    setCreatedUserId(null);
    setNewUserForm({
      username: "",
      password: "",
      name: "",
      email: "",
      role: "user",
      title: "",
      isPrimary: true,
    });
  };

  const submitNewUser = async () => {
    if (!selected) return;
    let userId = createdUserId;
    try {
      if (!userId) {
        const created = await createInternalUser.mutateAsync({
          username: newUserForm.username,
          password: newUserForm.password,
          name: newUserForm.name,
          email: newUserForm.email || undefined,
          role: newUserForm.role,
        });
        userId = created.userId;
        setCreatedUserId(userId);
        await utils.iam.users.invalidate();
      }
      await assignMember.mutateAsync({
        unitId: selected.id,
        userId,
        title: newUserForm.title || undefined,
        isPrimary: newUserForm.isPrimary,
      });
      await Promise.all([refresh(), utils.iam.users.invalidate()]);
      setCreateUserOpen(false);
      resetNewUser();
      toast.success("内部用户已创建并加入当前部门。");
    } catch (error) {
      toast.error(
        userId
          ? `账号已创建，但加入部门失败：${error instanceof Error ? error.message : "请重试"}`
          : error instanceof Error
            ? error.message
            : "内部用户创建失败。"
      );
    }
  };

  const confirmDeleteUnit = async () => {
    if (!selected) return;
    const fallbackId = selected.parentUnitId || null;
    try {
      await deleteUnit.mutateAsync({ id: selected.id });
      setDeleteOpen(false);
      setSelectedId(fallbackId);
      await refresh();
      toast.success("空部门已删除。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "部门删除失败。");
    }
  };

  const renderTree = (parentId = "root", depth = 0): ReactNode =>
    (childrenByParent.get(parentId) ?? []).map(unit => {
      if (visibleIds && !visibleIds.has(unit.id)) return null;
      const children = childrenByParent.get(unit.id) ?? [];
      const isExpanded = expanded.has(unit.id) || Boolean(query.trim());
      return (
        <div key={unit.id}>
          <div
            className={`group flex items-center gap-1 rounded-md pr-2 ${selectedId === unit.id ? "bg-[#eaf1ff] text-[#245fc8]" : "text-slate-600 hover:bg-slate-50"}`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
          >
            <button
              type="button"
              className="grid h-8 w-6 shrink-0 place-items-center text-slate-400"
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
              className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
              onClick={() => {
                setSelectedId(unit.id);
                setTab("overview");
              }}
            >
              <Building2 size={14} className="shrink-0" />
              <span className="truncate">{unit.name}</span>
              {unit.status === "disabled" && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400">
                  停用
                </span>
              )}
            </button>
          </div>
          {children.length && isExpanded && renderTree(unit.id, depth + 1)}
        </div>
      );
    });

  return (
    <div
      data-aiflow-organization-page=""
      className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-3 sm:p-5"
    >
      <div className="mx-auto max-w-[1440px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <button
              type="button"
              className="mb-2 flex items-center gap-1 text-sm text-[#2d6bea] hover:underline"
              onClick={onBack}
            >
              <ArrowLeft size={15} />
              返回系统配置
            </button>
            <p className="text-[10px] font-bold tracking-[.18em] text-[#5b72a8]">
              ORGANIZATION MANAGEMENT
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-800">
              组织架构管理
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              部门、成员、岗位和权限组共享当前流程引擎
              MySQL，并直接驱动直属上级与角色处理人解析。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => openUnitDialog("root")}
            >
              <Plus size={15} />
              新增根部门
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!selected || !selected.parentUnitId}
              onClick={() => openUnitDialog("sibling")}
            >
              <Plus size={15} />
              新增同级
            </Button>
            <Button
              type="button"
              disabled={!selected}
              onClick={() => openUnitDialog("child")}
            >
              <Plus size={15} />
              新增子部门
            </Button>
          </div>
        </header>
        {(organization.isError || users.isError || roles.isError) && (
          <div
            role="alert"
            className="m-4 flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {organization.error?.message ||
                users.error?.message ||
                roles.error?.message ||
                "组织管理数据读取失败。"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void organization.refetch();
                void users.refetch();
                void roles.refetch();
              }}
            >
              重新加载
            </Button>
          </div>
        )}
        <div className="grid min-h-[650px] lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-[#fbfcfe] p-3 lg:border-b-0 lg:border-r">
            <label className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-slate-400">
              <Search size={14} />
              <Input
                aria-label="搜索组织机构"
                className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                placeholder="搜索名称、编码、标准编码"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </label>
            <div className="mt-3 max-h-[520px] overflow-y-auto">
              {organization.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
                  <Loader2 size={15} className="animate-spin" />
                  正在读取机构树…
                </div>
              ) : (
                renderTree()
              )}
              {!organization.isLoading && !units.length && (
                <div className="p-6 text-center text-sm text-slate-400">
                  尚未创建部门，请点击“新增根部门”。
                </div>
              )}
              {!organization.isLoading &&
                Boolean(query.trim()) &&
                units.length > 0 &&
                visibleIds?.size === 0 && (
                  <div className="p-6 text-center text-sm text-slate-400">
                    没有匹配的机构，请更换关键词。
                  </div>
                )}
            </div>
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
              <p className="font-semibold text-slate-700">账号归属提示</p>
              <p className="mt-1">
                未分配部门账号：{unassignedUsers.length}{" "}
                个。成员可属于多个部门，唯一主部门用于直属上级解析。
              </p>
            </div>
          </aside>
          <section className="min-w-0 p-4 sm:p-6">
            {!selected ? (
              <div className="grid min-h-[460px] place-items-center text-sm text-slate-400">
                请从左侧选择部门，或创建根部门。
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="min-w-0 break-words text-xl font-semibold text-slate-800">
                        {selected.name}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${selected.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {selected.status === "active" ? "启用" : "停用"}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs text-[#2d6bea]">
                      {selected.code}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {selected.displayPath ||
                        `${selected.name}（${selected.code}）`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openUnitDialog("edit")}
                    >
                      <Edit3 size={14} />
                      编辑部门
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateUnit.mutate(
                          {
                            id: selected.id,
                            status:
                              selected.status === "active"
                                ? "disabled"
                                : "active",
                          },
                          {
                            onSuccess: () => {
                              void refresh();
                              toast.success("部门状态已更新。 ");
                            },
                            onError: error => toast.error(error.message),
                          }
                        )
                      }
                    >
                      {selected.status === "active" ? "停用" : "启用"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 size={14} />
                      删除部门
                    </Button>
                  </div>
                </div>
                <div
                  role="tablist"
                  aria-label="组织部门详情"
                  className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200"
                >
                  {(
                    [
                      { id: "overview", label: "部门概览", icon: Building2 },
                      {
                        id: "members",
                        label: `成员与岗位 (${directSelectedMembers.length})`,
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
                      className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm ${tab === item.id ? "border-[#2d6bea] bg-blue-50 text-[#245fc8]" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
                      onClick={() => setTab(item.id)}
                    >
                      <item.icon size={15} />
                      {item.label}
                    </button>
                  ))}
                </div>
                {tab === "overview" && (
                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                    <div className="rounded-lg border border-slate-200 p-4 md:col-span-2 xl:col-span-3">
                      <p className="text-xs font-medium text-slate-400">
                        部门说明
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {selected.description || "未填写说明"}
                      </p>
                    </div>
                  </div>
                )}
                {tab === "members" && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-slate-500">
                        成员可跨部门任职；主部门变化在同一事务内完成。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            resetNewUser();
                            setCreateUserOpen(true);
                          }}
                        >
                          <UserRoundPlus size={15} />
                          新建内部用户
                        </Button>
                        <Button
                          type="button"
                          onClick={() => setMemberOpen(true)}
                        >
                          <UserPlus size={15} />
                          添加已有成员
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
                      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-slate-400">
                        <Search size={14} />
                        <Input
                          aria-label="搜索部门成员"
                          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
                          placeholder="搜索姓名、登录名或岗位"
                          value={memberQuery}
                          onChange={event => setMemberQuery(event.target.value)}
                        />
                      </label>
                      <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={includeDescendants}
                          onChange={event =>
                            setIncludeDescendants(event.target.checked)
                          }
                        />
                        包含子机构成员
                      </label>
                    </div>
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[920px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs text-slate-500">
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
                              className="border-t border-slate-100"
                            >
                              <td className="max-w-[220px] break-words px-4 py-3 font-medium text-slate-800">
                                {member.name || member.username}
                              </td>
                              <td className="max-w-[220px] break-all px-4 py-3 text-xs text-slate-500">
                                {member.username}
                              </td>
                              <td className="max-w-[220px] break-words px-4 py-3">
                                {member.title || "未配置"}
                              </td>
                              <td className="px-4 py-3 text-slate-500">
                                {member.unitDisplayPath ||
                                  member.unitName ||
                                  "—"}
                              </td>
                              <td className="px-4 py-3">
                                {member.isPrimary ? (
                                  <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-700">
                                    主部门
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">
                                    兼任部门
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setRoleMember(member)}
                                  >
                                    <Eye size={13} />
                                    权限
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={moveMember.isPending}
                                    onClick={() => openMoveDialog(member)}
                                  >
                                    <MoveRight size={13} />
                                    迁移
                                  </Button>
                                  {!member.isPrimary && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={setPrimaryMembership.isPending}
                                      onClick={() =>
                                        setPrimaryMembership.mutate(
                                          {
                                            unitId: member.unitId,
                                            userId: Number(member.userId),
                                          },
                                          {
                                            onSuccess: () => {
                                              void refresh();
                                              toast.success(
                                                "主机构已更新，将用于直属上级解析。"
                                              );
                                            },
                                            onError: error =>
                                              toast.error(error.message),
                                          }
                                        )
                                      }
                                    >
                                      <Star size={13} />
                                      设为主机构
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={removeMember.isPending}
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `确定将“${member.name || member.username}”移出当前部门吗？`
                                        )
                                      )
                                        removeMember.mutate(
                                          {
                                            unitId: member.unitId,
                                            userId: member.userId,
                                          },
                                          {
                                            onSuccess: () => {
                                              void refresh();
                                              toast.success(
                                                "成员关系已移除。 "
                                              );
                                            },
                                            onError: error =>
                                              toast.error(error.message),
                                          }
                                        );
                                    }}
                                  >
                                    移除
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!selectedMembers.length && (
                            <tr>
                              <td
                                colSpan={6}
                                className="p-10 text-center text-slate-400"
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
                  </div>
                )}
                {tab === "permissions" && (
                  <div className="mt-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-slate-500">
                        绑定后，部门启用成员按有效期实时继承权限；可选择是否覆盖子部门成员。
                      </p>
                      <Button type="button" onClick={() => setRoleOpen(true)}>
                        <KeyRound size={15} />
                        绑定权限组
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {selectedBindings.map(binding => (
                        <div
                          key={binding.id}
                          className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="min-w-0 break-words font-semibold text-slate-800">
                                {binding.roleName}
                              </p>
                              <code className="max-w-full break-all rounded bg-slate-100 px-2 py-1 text-[10px] text-[#245fc8]">
                                {binding.roleCode}
                              </code>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {binding.roleDescription || "未填写权限组说明"}
                            </p>
                            <p className="mt-2 text-xs text-slate-500">
                              {binding.includeDescendants
                                ? "当前部门及所有子部门成员"
                                : "仅当前部门直接成员"}
                              {binding.expiresAt
                                ? ` · 有效至 ${new Date(binding.expiresAt).toLocaleString()}`
                                : " · 长期有效"}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={unbindRole.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `确定解绑权限组“${binding.roleName}”吗？成员继承权限将立即失效。`
                                )
                              )
                                unbindRole.mutate(
                                  {
                                    unitId: selected.id,
                                    roleId: binding.roleId,
                                  },
                                  {
                                    onSuccess: () => {
                                      void refresh();
                                      toast.success("权限组已解绑。 ");
                                    },
                                    onError: error =>
                                      toast.error(error.message),
                                  }
                                );
                            }}
                          >
                            解绑
                          </Button>
                        </div>
                      ))}
                      {!selectedBindings.length && (
                        <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">
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

      <CreationDialog
        open={Boolean(unitDialog)}
        onOpenChange={open => {
          if (!open) setUnitDialog(null);
        }}
        title={
          unitDialog === "edit"
            ? "编辑部门"
            : unitDialog === "root"
              ? "新增根部门"
              : unitDialog === "sibling"
                ? "新增同级部门"
                : "新增子部门"
        }
        description="按 BDP 参考字段填写机构信息后调用真实组织接口；取消不会写入数据库。"
        submitLabel={unitDialog === "edit" ? "保存部门" : "确认创建"}
        pending={pending}
        onSubmit={submitUnit}
        className="max-w-3xl"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {unitDialog !== "edit" && (
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              部门编码
              <Input
                value={unitForm.code}
                onChange={event =>
                  setUnitForm({
                    ...unitForm,
                    code: event.target.value.toUpperCase(),
                  })
                }
                placeholder="例如 RND_TEAM"
                required
              />
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            部门名称
            <Input
              value={unitForm.name}
              onChange={event =>
                setUnitForm({ ...unitForm, name: event.target.value })
              }
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            上级部门
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={unitForm.parentUnitId}
              onChange={event =>
                setUnitForm({ ...unitForm, parentUnitId: event.target.value })
              }
            >
              <option value="">无上级部门</option>
              {units
                .filter(
                  unit => unit.id !== selected?.id && unit.status === "active"
                )
                .map(unit => (
                  <option key={unit.id} value={unit.id}>
                    {unit.displayPath || `${unit.name}（${unit.code}）`}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            部门负责人
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={unitForm.managerUserId}
              onChange={event =>
                setUnitForm({ ...unitForm, managerUserId: event.target.value })
              }
            >
              <option value="">未指定负责人</option>
              {activeUsers.map((user: any) => (
                <option key={user.id} value={user.id}>
                  {user.name || user.username}（{user.username}）
                </option>
              ))}
            </select>
          </label>
          <Field
            label="机构类型"
            value={unitForm.unitType}
            onChange={value => setUnitForm({ ...unitForm, unitType: value })}
            placeholder="department / company"
          />
          <Field
            label="机构层级"
            value={unitForm.unitLevel}
            onChange={value => setUnitForm({ ...unitForm, unitLevel: value })}
            type="number"
            placeholder="留空自动计算"
          />
          <Field
            label="标准编码"
            value={unitForm.standardCode}
            onChange={value =>
              setUnitForm({ ...unitForm, standardCode: value })
            }
          />
          <Field
            label="行政区划"
            value={unitForm.areaCode}
            onChange={value => setUnitForm({ ...unitForm, areaCode: value })}
          />
          <Field
            label="机构分类"
            value={unitForm.category}
            onChange={value => setUnitForm({ ...unitForm, category: value })}
          />
          <Field
            label="排序"
            value={unitForm.sortOrder}
            onChange={value => setUnitForm({ ...unitForm, sortOrder: value })}
            type="number"
          />
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          部门说明
          <Textarea
            value={unitForm.description}
            onChange={event =>
              setUnitForm({ ...unitForm, description: event.target.value })
            }
            maxLength={2000}
          />
        </label>
      </CreationDialog>
      <CreationDialog
        open={memberOpen}
        onOpenChange={setMemberOpen}
        title={`添加成员到${selected ? `“${selected.name}”` : "部门"}`}
        description="选择现有内部账号并提交真实成员关系接口；新账号请使用成员页的“新建内部用户”。"
        submitLabel="保存成员"
        pending={assignMember.isPending}
        onSubmit={submitMember}
      >
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          内部账号
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={memberForm.userId}
            onChange={event =>
              setMemberForm({ ...memberForm, userId: event.target.value })
            }
            required
          >
            <option value="">请选择账号</option>
            {activeUsers.map((user: any) => (
              <option key={user.id} value={user.id}>
                {user.name || user.username}（{user.username}）
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          岗位/职务
          <Input
            value={memberForm.title}
            onChange={event =>
              setMemberForm({ ...memberForm, title: event.target.value })
            }
            maxLength={160}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={memberForm.isPrimary}
            onChange={event =>
              setMemberForm({ ...memberForm, isPrimary: event.target.checked })
            }
          />
          设为该成员的主部门（驱动直属上级解析）
        </label>
      </CreationDialog>
      <CreationDialog
        open={createUserOpen}
        onOpenChange={open => {
          setCreateUserOpen(open);
          if (!open && !createdUserId) resetNewUser();
        }}
        title={`新建内部用户并加入${selected ? `“${selected.name}”` : "部门"}`}
        description="提交时先调用真实账号创建接口，再自动写入当前部门成员关系；失败时保留输入供修正或重试。"
        submitLabel={createdUserId ? "重试加入部门" : "创建并加入部门"}
        pending={createInternalUser.isPending || assignMember.isPending}
        onSubmit={submitNewUser}
        className="max-w-2xl"
      >
        {createdUserId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            账号已经创建，本次提交只重试加入当前部门，不会重复创建账号。
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="登录名"
            value={newUserForm.username}
            onChange={value =>
              setNewUserForm({ ...newUserForm, username: value.toLowerCase() })
            }
            placeholder="字母开头，至少 3 位"
          />
          <Field
            label="姓名"
            value={newUserForm.name}
            onChange={value => setNewUserForm({ ...newUserForm, name: value })}
          />
          <Field
            label="初始密码"
            type="password"
            value={newUserForm.password}
            onChange={value =>
              setNewUserForm({ ...newUserForm, password: value })
            }
            placeholder="至少 12 位"
          />
          <Field
            label="邮箱（可选）"
            type="email"
            value={newUserForm.email}
            onChange={value => setNewUserForm({ ...newUserForm, email: value })}
          />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            账号类型
            <select
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={newUserForm.role}
              onChange={event =>
                setNewUserForm({
                  ...newUserForm,
                  role: event.target.value as "user" | "admin",
                })
              }
            >
              <option value="user">普通用户</option>
              <option value="admin">系统管理员</option>
            </select>
          </label>
          <Field
            label="岗位/职务（可选）"
            value={newUserForm.title}
            onChange={value => setNewUserForm({ ...newUserForm, title: value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={newUserForm.isPrimary}
            onChange={event =>
              setNewUserForm({
                ...newUserForm,
                isPrimary: event.target.checked,
              })
            }
          />
          设为新用户的主机构（驱动直属上级解析）
        </label>
      </CreationDialog>
      <CreationDialog
        open={Boolean(movingMember)}
        onOpenChange={open => {
          if (!open) setMovingMember(null);
        }}
        title={`迁移成员${movingMember ? `“${movingMember.name || movingMember.username}”` : ""}`}
        description="成员关系将在同一事务内从当前部门移动到目标部门；原关系只有在目标关系保存成功后才会删除。"
        submitLabel="确认迁移"
        pending={moveMember.isPending}
        onSubmit={submitMove}
      >
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          目标部门
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={moveForm.toUnitId}
            onChange={event =>
              setMoveForm({ ...moveForm, toUnitId: event.target.value })
            }
            required
          >
            <option value="">请选择目标部门</option>
            {units
              .filter(
                unit =>
                  unit.id !== movingMember?.unitId && unit.status === "active"
              )
              .map(unit => (
                <option key={unit.id} value={unit.id}>
                  {unit.displayPath || `${unit.name}（${unit.code}）`}
                </option>
              ))}
          </select>
        </label>
        <Field
          label="迁移后岗位/职务"
          value={moveForm.title}
          onChange={value => setMoveForm({ ...moveForm, title: value })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={moveForm.makePrimary}
            onChange={event =>
              setMoveForm({ ...moveForm, makePrimary: event.target.checked })
            }
          />
          将目标部门设为该成员的主机构
        </label>
      </CreationDialog>
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
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
            <RoleSourceList
              title="用户直接角色"
              empty="当前没有有效的系统级直接角色。"
              roles={roleMember?.directRoles ?? []}
              source={role =>
                role.expiresAt
                  ? `有效至 ${new Date(role.expiresAt).toLocaleString("zh-CN", { hour12: false })}`
                  : "系统级直接授权"
              }
            />
            <RoleSourceList
              title="部门继承角色"
              empty="当前没有从所属部门继承角色。"
              roles={roleMember?.inheritedRoles ?? []}
              source={role => `继承自 ${role.unitName || "未命名部门"}`}
            />
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRoleMember(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除部门</DialogTitle>
            <DialogDescription>
              仅空部门可以删除。若仍有子部门、成员或权限组，服务端会明确阻止并保留全部数据。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            待删除：{selected?.name || "未选择部门"}（{selected?.code || "—"}）
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={deleteUnit.isPending}
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteUnit.isPending}
              onClick={confirmDeleteUnit}
            >
              {deleteUnit.isPending && (
                <Loader2 className="animate-spin" size={14} />
              )}
              确认删除空部门
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreationDialog
        open={roleOpen}
        onOpenChange={setRoleOpen}
        title={`绑定${selected ? `“${selected.name}”` : "部门"}权限组`}
        description="仅允许系统范围且非 system_admin 的角色；保存后按部门范围和有效期实时继承。"
        submitLabel="确认绑定"
        pending={bindRole.isPending}
        onSubmit={submitRole}
      >
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          权限组
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={roleId}
            onChange={event => setRoleId(event.target.value)}
            required
          >
            <option value="">请选择权限组</option>
            {eligibleRoles
              .filter(
                (role: any) =>
                  !selectedBindings.some(
                    binding => Number(binding.roleId) === Number(role.id)
                  )
              )
              .map((role: any) => (
                <option key={role.id} value={role.id}>
                  {role.name}（{role.code}）
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={roleIncludesDescendants}
            onChange={event => setRoleIncludesDescendants(event.target.checked)}
          />
          子部门成员同步继承
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          到期时间（可选）
          <Input
            type="datetime-local"
            value={roleExpiresAt}
            onChange={event => setRoleExpiresAt(event.target.value)}
          />
        </label>
      </CreationDialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-2 break-words text-sm font-medium text-slate-700">
        {value}
      </p>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <Input
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
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
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-3 grid gap-2">
        {roles.map((role, index) => (
          <div
            key={`${role.roleId}-${role.unitId || role.assignmentId || index}`}
            className="rounded-md border border-slate-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 break-words text-sm font-medium text-slate-700">
                {role.roleName}
              </span>
              <code className="max-w-full break-all rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                {role.roleCode}
              </code>
            </div>
            <p className="mt-1 text-xs text-slate-500">{source(role)}</p>
          </div>
        ))}
        {!roles.length && (
          <p className="rounded-md border border-dashed border-slate-200 bg-white p-4 text-center text-xs text-slate-400">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}
