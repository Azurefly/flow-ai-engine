import { CreationDialog } from "@/components/CreationDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
type OrganizationConfirmation =
  | {
      kind: "remove-member";
      unitId: string;
      userId: number | string;
      memberName: string;
    }
  | {
      kind: "unbind-role";
      unitId: string;
      roleId: number | string;
      roleName: string;
    }
  | {
      kind: "disable-unit";
      unitId: string;
      unitName: string;
      unitCode: string;
      affectedMemberCount: number;
    };

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
  const organization = trpc.config.organizationDirectory.useQuery(undefined, {
    retry: false,
  });
  const roles = trpc.iam.roles.useQuery({ scope: "system" }, { retry: false });
  const units = (organization.data?.units ?? []) as unknown as Unit[];
  const roleBindings = (organization.data?.roleBindings ?? []) as any[];
  const eligibleRoles = (roles.data ?? []).filter(
    (role: any) => role.scope === "system" && role.code !== "system_admin"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDirectoryOpen, setMobileDirectoryOpen] = useState(false);
  const [tab, setTab] = useState<PageTab>("overview");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const unitActionsRef = useRef<HTMLDetailsElement>(null);
  const selectedUnitActionsRef = useRef<HTMLDetailsElement>(null);
  const [unitDialog, setUnitDialog] = useState<UnitDialogMode>(null);
  const [unitForm, setUnitForm] = useState(emptyUnitForm);
  const [memberOpen, setMemberOpen] = useState(false);
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
  const [organizationConfirmation, setOrganizationConfirmation] =
    useState<OrganizationConfirmation | null>(null);
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
    await Promise.all([
      utils.config.organizationDirectory.invalidate(),
      utils.config.organizationMembersPage.invalidate(),
      utils.iam.userDirectory.invalidate(),
      utils.iam.userAuthorizationDetails.invalidate(),
      utils.iam.roleAuthorizationDetails.invalidate(),
      utils.workflow.access.invalidate(),
      utils.project.access.invalidate(),
      utils.workflow.list.invalidate(),
      utils.project.list.invalidate(),
    ]);
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
  const openUnitAction = (mode: "root" | "sibling" | "child") => {
    openUnitDialog(mode);
    if (unitActionsRef.current) unitActionsRef.current.open = false;
  };

  const submitUnit = async () => {
    try {
      let createdId: string | undefined;
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
        createdId = result.id;
      }
      await refresh();
      if (createdId) {
        setSelectedId(createdId);
        setTab("overview");
        setMobileDirectoryOpen(false);
        setQuery("");
      }
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
    if (!memberForm.userId) {
      toast.error("请先搜索并选择一个内部账号。");
      return;
    }
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
  const directSelectedMemberCount = Number(selected?.memberCount ?? 0);
  const selectedMembers = members;
  const selectedBindings = roleBindings.filter(
    binding => binding.unitId === selected?.id
  );
  const unassignedActiveUserCount = Number(
    organization.data?.unassignedActiveUserCount ?? 0
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

  const setMemberAsPrimary = (member: any) => {
    setPrimaryMembership.mutate(
      { unitId: member.unitId, userId: Number(member.userId) },
      {
        onSuccess: () => {
          void refresh();
          toast.success("主机构已更新，将用于直属上级解析。");
        },
        onError: error => toast.error(error.message),
      }
    );
  };

  const removeMemberFromUnit = (member: any) => {
    setOrganizationConfirmation({
      kind: "remove-member",
      unitId: member.unitId,
      userId: member.userId,
      memberName: member.name || member.username || "该成员",
    });
  };

  const confirmOrganizationAction = () => {
    if (!organizationConfirmation) return;
    if (organizationConfirmation.kind === "disable-unit") {
      updateUnit.mutate(
        { id: organizationConfirmation.unitId, status: "disabled" },
        {
          onSuccess: () => {
            setOrganizationConfirmation(null);
            void refresh();
            toast.success("部门状态已更新。 ");
          },
          onError: error => toast.error(error.message),
        }
      );
      return;
    }
    if (organizationConfirmation.kind === "remove-member") {
      removeMember.mutate(
        {
          unitId: organizationConfirmation.unitId,
          userId: Number(organizationConfirmation.userId),
        },
        {
          onSuccess: () => {
            setOrganizationConfirmation(null);
            void refresh();
            toast.success("成员关系已移除。");
          },
          onError: error => toast.error(error.message),
        }
      );
      return;
    }
    unbindRole.mutate(
      {
        unitId: organizationConfirmation.unitId,
        roleId: Number(organizationConfirmation.roleId),
      },
      {
        onSuccess: () => {
          setOrganizationConfirmation(null);
          void refresh();
          toast.success("权限组已解绑。");
        },
        onError: error => toast.error(error.message),
      }
    );
  };

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
              aria-label={`迁移成员：${memberIdentity}`}
              className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"
              disabled={moveMember.isPending}
              onClick={() => openMoveDialog(member)}
            >
              <MoveRight size={13} />
              迁移
            </button>
            {!member.isPrimary && (
              <button
                type="button"
                aria-label={`设为主机构：${memberIdentity}`}
                className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-foreground hover:bg-muted disabled:opacity-50 min-[1024px]:h-10"
                disabled={setPrimaryMembership.isPending}
                onClick={() => setMemberAsPrimary(member)}
              >
                <Star size={13} />
                设为主机构
              </button>
            )}
            <button
              type="button"
              aria-label={`从当前部门移除成员：${memberIdentity}`}
              className="aiflow-type-control flex h-11 items-center gap-2 rounded px-2 text-left text-aiflow-danger hover:bg-aiflow-danger-surface disabled:opacity-50 min-[1024px]:h-10"
              disabled={removeMember.isPending}
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
        await utils.iam.userDirectory.invalidate();
      }
      await assignMember.mutateAsync({
        unitId: selected.id,
        userId,
        title: newUserForm.title || undefined,
        isPrimary: newUserForm.isPrimary,
      });
      await Promise.all([refresh(), utils.iam.userDirectory.invalidate()]);
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

  return (
    <div
      data-aiflow-organization-page=""
      className="min-h-[calc(100vh-56px)] bg-background p-3 sm:p-5"
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
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
            <p className="text-[10px] font-bold tracking-[.18em] text-muted-foreground">
              ORGANIZATION MANAGEMENT
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
        {(organization.isError ||
          roles.isError ||
          (tab === "members" && membersPageQuery.isError)) && (
          <div
            role="alert"
            className="m-4 flex flex-col gap-3 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface px-4 py-3 text-sm text-aiflow-danger sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              {organization.error?.message ||
                membersPageQuery.error?.message ||
                roles.error?.message ||
                "组织管理数据读取失败。"}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-11 min-[1024px]:h-10"
              onClick={() => {
                void organization.refetch();
                void membersPageQuery.refetch();
                void roles.refetch();
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
            <div className="mt-3 max-h-[520px] overflow-y-auto">
              {organization.isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 size={15} className="animate-spin" />
                  正在读取机构树…
                </div>
              ) : (
                renderTree()
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
                          disabled={updateUnit.isPending}
                          onClick={() => {
                            selectedUnitActionsRef.current?.removeAttribute(
                              "open"
                            );
                            if (selected.status === "active") {
                              setOrganizationConfirmation({
                                kind: "disable-unit",
                                unitId: selected.id,
                                unitName: selected.name,
                                unitCode: selected.code,
                                affectedMemberCount: units.reduce(
                                  (count, unit) =>
                                    descendantIds.has(unit.id)
                                      ? count + Number(unit.memberCount ?? 0)
                                      : count,
                                  0
                                ),
                              });
                            } else {
                              updateUnit.mutate(
                                { id: selected.id, status: "active" },
                                {
                                  onSuccess: () => {
                                    void refresh();
                                    toast.success("部门状态已更新。 ");
                                  },
                                  onError: error => toast.error(error.message),
                                }
                              );
                            }
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
                              setDeleteOpen(true);
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
                            resetNewUser();
                            setCreateUserOpen(true);
                          }}
                        >
                          <UserRoundPlus size={15} />
                          新建内部用户
                        </Button>
                        <Button
                          type="button"
                          className="h-11 min-[1024px]:h-10"
                          onClick={() => setMemberOpen(true)}
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
                        onClick={() => setRoleOpen(true)}
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
                                disabled={unbindRole.isPending}
                                onClick={event => {
                                  event.currentTarget
                                    .closest("details")
                                    ?.removeAttribute("open");
                                  setOrganizationConfirmation({
                                    kind: "unbind-role",
                                    unitId: selected.id,
                                    roleId: binding.roleId,
                                    roleName: binding.roleName,
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
        description="维护部门名称、上级与负责人。保存后生效，取消保留原有信息。"
        submitLabel={unitDialog === "edit" ? "保存部门" : "确认创建"}
        pending={pending}
        onSubmit={submitUnit}
        className="max-w-3xl"
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {unitDialog !== "edit" && (
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              部门编码
              <Input
                className="aiflow-type-control h-11 min-[1024px]:h-10"
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
          <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
            部门名称
            <Input
              className="aiflow-type-control h-11 min-[1024px]:h-10"
              value={unitForm.name}
              onChange={event =>
                setUnitForm({ ...unitForm, name: event.target.value })
              }
              required
            />
          </label>
          <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
            上级部门
            <select
              className="aiflow-type-control h-11 w-full min-w-0 rounded-md border border-border bg-card px-3 min-[1024px]:h-10"
              value={unitForm.parentUnitId}
              onChange={event =>
                setUnitForm({ ...unitForm, parentUnitId: event.target.value })
              }
            >
              <option value="">无上级部门</option>
              {units
                .filter(
                  unit =>
                    unit.status === "active" &&
                    (unitDialog !== "edit" || !descendantIds.has(unit.id))
                )
                .map(unit => (
                  <option key={unit.id} value={unit.id}>
                    {unit.displayPath || `${unit.name}（${unit.code}）`}
                  </option>
                ))}
            </select>
          </label>
          <div className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
            <span>部门负责人</span>
            <OrganizationUserSelect
              ariaLabel="部门负责人"
              enabled={Boolean(unitDialog)}
              value={unitForm.managerUserId}
              selectedLabel={
                selected?.managerName
                  ? selected.managerUsername
                    ? `${selected.managerName}（${selected.managerUsername}）`
                    : selected.managerName
                  : selected?.managerUsername
              }
              placeholder="未指定负责人"
              clearLabel="清除负责人"
              onChange={value =>
                setUnitForm({ ...unitForm, managerUserId: value })
              }
            />
          </div>
          <details className="min-w-0 rounded-lg border border-border sm:col-span-2">
            <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center px-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring min-[1024px]:min-h-10">
              其他机构属性（可选）
            </summary>
            <div className="grid min-w-0 gap-3 p-3 sm:grid-cols-2">
              <Field
                label="机构类型"
                value={unitForm.unitType}
                onChange={value =>
                  setUnitForm({ ...unitForm, unitType: value })
                }
                placeholder="department / company"
              />
              <Field
                label="机构层级"
                value={unitForm.unitLevel}
                onChange={value =>
                  setUnitForm({ ...unitForm, unitLevel: value })
                }
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
                onChange={value =>
                  setUnitForm({ ...unitForm, areaCode: value })
                }
              />
              <Field
                label="机构分类"
                value={unitForm.category}
                onChange={value =>
                  setUnitForm({ ...unitForm, category: value })
                }
              />
              <Field
                label="排序"
                value={unitForm.sortOrder}
                onChange={value =>
                  setUnitForm({ ...unitForm, sortOrder: value })
                }
                type="number"
              />
            </div>
          </details>
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
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
        description="选择已有账号，设置岗位与主部门。需要创建账号时，请使用成员页的“新建内部用户”。"
        submitLabel="保存成员"
        pending={assignMember.isPending}
        onSubmit={submitMember}
      >
        <div className="aiflow-type-control grid gap-1.5 font-medium text-foreground">
          <span>内部账号</span>
          <OrganizationUserSelect
            ariaLabel="内部账号"
            enabled={memberOpen}
            value={memberForm.userId}
            placeholder="输入姓名或登录名搜索账号"
            required
            onChange={value => setMemberForm({ ...memberForm, userId: value })}
          />
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
          岗位/职务
          <Input
            value={memberForm.title}
            onChange={event =>
              setMemberForm({ ...memberForm, title: event.target.value })
            }
            maxLength={160}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
        description="创建账号并加入当前部门；失败时保留输入供修正或重试。"
        submitLabel={createdUserId ? "重试加入部门" : "创建并加入部门"}
        pending={createInternalUser.isPending || assignMember.isPending}
        onSubmit={submitNewUser}
        className="max-w-2xl"
      >
        {createdUserId && (
          <div className="rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-sm text-aiflow-warning">
            账号已创建，信息不可修改；本次仅重试加入部门。
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="登录名"
            value={newUserForm.username}
            disabled={Boolean(createdUserId)}
            onChange={value =>
              setNewUserForm({ ...newUserForm, username: value.toLowerCase() })
            }
            placeholder="字母开头，至少 3 位"
          />
          <Field
            label="姓名"
            value={newUserForm.name}
            disabled={Boolean(createdUserId)}
            onChange={value => setNewUserForm({ ...newUserForm, name: value })}
          />
          <Field
            label="初始密码"
            type="password"
            value={newUserForm.password}
            disabled={Boolean(createdUserId)}
            onChange={value =>
              setNewUserForm({ ...newUserForm, password: value })
            }
            placeholder="至少 12 位"
          />
          <Field
            label="邮箱（可选）"
            type="email"
            value={newUserForm.email}
            disabled={Boolean(createdUserId)}
            onChange={value => setNewUserForm({ ...newUserForm, email: value })}
          />
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            账号类型
            <select
              className="aiflow-type-control h-11 rounded-md border border-border bg-card px-3 min-[1024px]:h-10"
              value={newUserForm.role}
              disabled={Boolean(createdUserId)}
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
        description="将成员从当前部门迁移到目标部门；迁移失败时保留原有关系。"
        submitLabel="确认迁移"
        pending={moveMember.isPending}
        onSubmit={submitMove}
      >
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
          目标部门
          <select
            className="aiflow-type-control h-11 rounded-md border border-border bg-card px-3 min-[1024px]:h-10"
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
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
      <Dialog
        open={Boolean(organizationConfirmation)}
        onOpenChange={open => {
          if (
            !open &&
            !removeMember.isPending &&
            !unbindRole.isPending &&
            !updateUnit.isPending
          )
            setOrganizationConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {organizationConfirmation?.kind === "remove-member"
                ? "确认移出部门"
                : organizationConfirmation?.kind === "unbind-role"
                  ? "确认解绑权限组"
                  : "确认停用部门"}
            </DialogTitle>
            <DialogDescription>
              {organizationConfirmation?.kind === "remove-member"
                ? `将“${organizationConfirmation.memberName}”移出当前部门。该操作只移除部门成员关系，不会删除账号。`
                : organizationConfirmation?.kind === "unbind-role"
                  ? `确定解绑权限组“${organizationConfirmation.roleName}”吗？该部门及其成员的继承权限将立即失效。`
                  : organizationConfirmation
                    ? `停用“${organizationConfirmation.unitName}”（${organizationConfirmation.unitCode}）后，该部门及其子部门中 ${organizationConfirmation.affectedMemberCount} 个成员的部门继承角色和处理人解析可能发生变化；账号与成员关系会保留。重新启用后仍按有效角色绑定和有效期计算权限。`
                    : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={
                removeMember.isPending ||
                unbindRole.isPending ||
                updateUnit.isPending
              }
              onClick={() => setOrganizationConfirmation(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full sm:w-auto"
              disabled={
                removeMember.isPending ||
                unbindRole.isPending ||
                updateUnit.isPending
              }
              onClick={confirmOrganizationAction}
            >
              {(removeMember.isPending ||
                unbindRole.isPending ||
                updateUnit.isPending) && (
                <Loader2 className="animate-spin" size={14} />
              )}
              {organizationConfirmation?.kind === "remove-member"
                ? "确认移出"
                : organizationConfirmation?.kind === "unbind-role"
                  ? "确认解绑"
                  : "确认停用部门"}
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
          <div className="rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-3 text-sm text-aiflow-danger">
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
        description="成员按部门范围和有效期继承所选系统角色；系统管理员角色不能通过部门分配。"
        submitLabel="确认绑定"
        pending={bindRole.isPending}
        onSubmit={submitRole}
      >
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
          权限组
          <select
            className="aiflow-type-control h-11 rounded-md border border-border bg-card px-3 min-[1024px]:h-10"
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
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={roleIncludesDescendants}
            onChange={event => setRoleIncludesDescendants(event.target.checked)}
          />
          子部门成员同步继承
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
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
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
      {label}
      <Input
        className="aiflow-type-control h-11 min-[1024px]:h-10"
        type={type}
        disabled={disabled}
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

function OrganizationUserSelect({
  ariaLabel,
  enabled,
  value,
  onChange,
  placeholder,
  selectedLabel,
  clearLabel,
  required = false,
}: {
  ariaLabel: string;
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  selectedLabel?: string;
  clearLabel?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchPage, setSearchPage] = useState(0);
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebouncedSearch("");
      setSearchPage(0);
    }
  }, [open]);

  const directory = trpc.iam.userDirectory.useQuery(
    {
      search: debouncedSearch,
      status: "active",
      offset: searchPage * 20,
      limit: 20,
    },
    {
      enabled: enabled && open && Boolean(debouncedSearch),
      retry: false,
    }
  );
  const users = directory.data?.items ?? [];
  useEffect(() => {
    if (!directory.data) return;
    const lastPage = Math.max(0, Math.ceil(directory.data.total / 20) - 1);
    if (searchPage > lastPage) setSearchPage(lastPage);
  }, [directory.data, searchPage]);
  const chosenLabel =
    value && selectedUser?.id === value
      ? selectedUser.label
      : value
        ? selectedLabel || `账号 ${value}`
        : placeholder;
  const waitingForSearch =
    Boolean(search.trim()) && search.trim() !== debouncedSearch;
  const loading =
    Boolean(search.trim()) &&
    (waitingForSearch || directory.isLoading || directory.isFetching);

  const choose = (user: (typeof users)[number]) => {
    const id = String(user.id);
    setSelectedUser({
      id,
      label: user.name ? `${user.name}（${user.username}）` : user.username,
    });
    onChange(id);
    setSearch("");
    setOpen(false);
  };

  const clear = () => {
    setSelectedUser(null);
    onChange("");
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-required={required || undefined}
          disabled={!enabled}
          variant="outline"
          className="aiflow-type-control h-11 w-full min-w-0 justify-between gap-2 px-3 text-left font-normal min-[1024px]:h-10"
        >
          <span className="min-w-0 truncate">{chosenLabel}</span>
          <ChevronsUpDown
            size={15}
            className="shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            aria-label={`${ariaLabel}搜索`}
            placeholder="输入姓名、登录名或邮箱"
            className="aiflow-type-control"
            value={search}
            onValueChange={value => {
              setSearch(value);
              setSearchPage(0);
            }}
          />
          <CommandList>
            {clearLabel && value && (
              <CommandGroup>
                <CommandItem
                  value="clear-selection"
                  onSelect={clear}
                  className="aiflow-type-body min-h-11 text-muted-foreground"
                >
                  {clearLabel}
                </CommandItem>
              </CommandGroup>
            )}
            {!search.trim() ? (
              <p className="aiflow-type-body px-3 py-4 text-center text-muted-foreground">
                输入姓名、登录名或邮箱开始搜索
              </p>
            ) : loading ? (
              <div
                role="status"
                className="aiflow-type-body flex items-center justify-center gap-2 px-3 py-4 text-muted-foreground"
              >
                <Loader2 size={15} className="animate-spin" />
                正在搜索账号…
              </div>
            ) : directory.isError ? (
              <div className="aiflow-type-body grid justify-items-center gap-2 px-3 py-4 text-aiflow-danger">
                <p>{directory.error.message || "账号搜索失败。"}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="aiflow-type-control h-11 px-3 min-[1024px]:h-10"
                  onClick={() => void directory.refetch()}
                >
                  重新搜索
                </Button>
              </div>
            ) : users.length ? (
              <>
                <CommandGroup>
                  {users.map(user => {
                    const id = String(user.id);
                    return (
                      <CommandItem
                        key={id}
                        value={id}
                        onSelect={() => choose(user)}
                        className="aiflow-type-body min-h-11"
                      >
                        <Check
                          size={15}
                          className={value === id ? "opacity-100" : "opacity-0"}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {user.name || user.username}（{user.username}）
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {(directory.data?.total ?? 0) > 20 && (
                  <div
                    aria-label="人员搜索分页"
                    className="grid gap-2 border-t px-3 py-2"
                  >
                    <p className="aiflow-type-meta leading-5 text-muted-foreground">
                      显示第 {searchPage * 20 + 1}–
                      {searchPage * 20 + users.length} 个，共{" "}
                      {directory.data?.total}
                      个匹配账号；请继续输入以缩小范围。
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="aiflow-type-control min-h-10"
                        disabled={searchPage === 0 || loading}
                        onClick={() =>
                          setSearchPage(page => Math.max(0, page - 1))
                        }
                      >
                        上一页
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="aiflow-type-control min-h-10"
                        disabled={
                          loading ||
                          (searchPage + 1) * 20 >= (directory.data?.total ?? 0)
                        }
                        onClick={() => setSearchPage(page => page + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <CommandEmpty className="aiflow-type-body">
                没有找到匹配的有效账号。
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
