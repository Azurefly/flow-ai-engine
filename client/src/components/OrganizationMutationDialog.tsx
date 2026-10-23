import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import {
  initialOrganizationDraft,
  organizationDraftKey,
  organizationUnitFields,
  mergeOrganizationFields,
  type OrganizationTarget,
  type OrganizationFields,
} from "@shared/organization-form";
import { roleExpiryDateInput } from "@shared/role-expiry";
import { readRolePermissionCodes } from "@shared/role-permission-codes";
import { CreationDialog } from "./CreationDialog";
import {
  useResourceDraftState,
  useResourceDraftPending,
  useResourceDraftSummary,
} from "./ResourceDraftSession";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

type Props = {
  target: OrganizationTarget;
  units: any[];
  bindings: any[];
  reading: boolean;
  onClose: () => void;
  onRead: () => Promise<unknown>;
  onSaved: (value?: {
    createdId?: string;
    deletedId?: string;
    parentId?: string | null;
  }) => void;
};
const fieldLabels: Record<string, string> = {
  code: "部门编码",
  name: "部门名称",
  parentUnitId: "上级部门",
  managerUserId: "负责人",
  unitType: "机构类型",
  unitLevel: "机构层级",
  standardCode: "标准编码",
  areaCode: "行政区划",
  category: "机构分类",
  sortOrder: "排序",
  description: "部门说明",
};
export default function OrganizationMutationDialog({
  target,
  units,
  bindings,
  reading,
  onClose,
  onRead,
  onSaved,
}: Props) {
  const initial = initialOrganizationDraft(target);
  const [draft, setDraft] = useResourceDraftState(
    "organization",
    "organization-configuration",
    organizationDraftKey(target),
    initial
  );
  const begin = useResourceDraftPending(
    "organization",
    "organization-configuration"
  );
  const globalPending = useResourceDraftSummary("organization").pending;
  const [writing, setWriting] = useState(false),
    [error, setError] = useState(""),
    [leaving, setLeaving] = useState(false);
  const lock = useRef(false),
    origin = useRef<HTMLElement | null>(null);
  const busy = writing || globalPending > 0;
  const fields = draft.fields,
    text = (key: string) => String(fields[key] ?? ""),
    checked = (key: string) => Boolean(fields[key]);
  const update = (value: Partial<OrganizationFields>) => {
    if (lock.current || busy) return;
    if (typeof value.code === "string") value.code = value.code.toUpperCase();
    if (typeof value.username === "string")
      value.username = value.username.toLowerCase();
    setDraft(old => ({
      ...old,
      fields: { ...old.fields, ...value } as OrganizationFields,
    }));
    setError("");
  };
  const current = units.find(unit => unit.id === target.unit?.id);
  const editing = target.kind === "unit" && target.mode === "edit";
  const creating = target.kind === "unit" && !editing;
  const roleMode = target.kind === "role";
  const editingMember = target.kind === "member" && Boolean(target.member);
  const needsMember = [
    "member",
    "move",
    "primary",
    "remove",
    "new-user",
  ].includes(target.kind);
  const memberId =
    target.kind === "member"
      ? editingMember
        ? Number(target.member!.userId)
        : Number(text("userId"))
      : target.kind === "new-user"
        ? draft.createdUserId
        : Number(target.member?.userId);
  const utils = trpc.useUtils();
  const roles = trpc.iam.roles.useQuery(
    { scope: "system" },
    authorizationQueryPolicy(roleMode)
  );
  const catalog = trpc.iam.permissionCatalog.useQuery(undefined, {
    enabled: roleMode,
    retry: false,
  });
  const member = trpc.config.organizationMemberConfiguration.useQuery(
    { userId: memberId || 1 },
    authorizationQueryPolicy(needsMember && Boolean(memberId))
  );
  const currentMember =
    member.isSuccess && !member.isError
      ? member.data?.memberships.find(row => row.unitId === target.unit?.id)
      : undefined;
  const roleOptions = roles.isSuccess && !roles.isError ? roles.data : [];
  const selectedRole = roleOptions?.find(
    row => String(row.id) === text("roleId")
  );
  const permissions = readRolePermissionCodes(selectedRole?.permissions);
  const binding = bindings.find(
    row =>
      row.unitId === target.unit?.id &&
      Number(row.roleId) ===
        Number(
          target.kind === "unbind" ? target.binding?.roleId : text("roleId")
        )
  );
  useEffect(() => {
    if (
      needsMember &&
      memberId &&
      member.isSuccess &&
      !member.isFetching &&
      !draft.membershipToken
    )
      setDraft(old =>
        old.membershipToken
          ? old
          : { ...old, membershipToken: member.data.membershipToken }
      );
  }, [
    needsMember,
    memberId,
    member.isSuccess,
    member.isFetching,
    member.data?.membershipToken,
    draft.membershipToken,
    setDraft,
  ]);
  const unitChanged = Boolean(
    !creating &&
      current &&
      target.kind !== "unbind" &&
      draft.configToken !== current.configToken
  );
  const memberChanged = Boolean(
    needsMember &&
      memberId &&
      member.data &&
      draft.membershipToken &&
      draft.membershipToken !== member.data.membershipToken
  );
  const roleChanged = Boolean(
    roleMode && selectedRole && draft.roleToken !== selectedRole.configToken
  );
  const bindingChanged = Boolean(
    target.kind === "unbind" &&
      binding &&
      draft.configToken !== binding.configToken
  );
  const expiry = roleExpiryDateInput(text("expiresAt"));
  const reviewBusy =
    busy ||
    reading ||
    (roleMode && roles.isFetching) ||
    (needsMember && Boolean(memberId) && member.isFetching);
  const unavailable = !creating && !current;
  const inactive =
    ["member", "new-user", "role", "primary"].includes(target.kind) &&
    current?.status !== "active";
  const loadedMember =
    !needsMember ||
    !memberId ||
    (member.isSuccess &&
      !member.isError &&
      member.data.user?.status !== undefined);
  const roleValid =
    !roleMode ||
    (roles.isSuccess &&
      !roles.isError &&
      selectedRole &&
      permissions.length &&
      !binding &&
      draft.roleToken);
  const destination =
    member.isSuccess && !member.isError
      ? member.data.memberships.find(row => row.unitId === text("toUnitId"))
      : undefined;
  const memberValid =
    target.kind !== "member" ||
    (memberId &&
      member.data?.user?.status === "active" &&
      (editingMember ? Boolean(currentMember) : !currentMember) &&
      draft.membershipToken);
  const sourceValid =
    !["move", "primary", "remove"].includes(target.kind) ||
    (Boolean(currentMember) && draft.membershipToken);
  const chosenParent = units.find(
    row => row.id === text("parentUnitId") && row.status === "active"
  );
  const chosenDestination = units.find(
    row =>
      row.id === text("toUnitId") &&
      row.status === "active" &&
      row.id !== target.unit?.id
  );
  const valid =
    !unavailable &&
    !inactive &&
    !reviewBusy &&
    loadedMember &&
    roleValid &&
    memberValid &&
    sourceValid &&
    !unitChanged &&
    !memberChanged &&
    !roleChanged &&
    !bindingChanged &&
    !expiry.error &&
    (target.kind !== "unit" ||
      !text("parentUnitId") ||
      Boolean(chosenParent)) &&
    (target.kind !== "move" ||
      (Boolean(chosenDestination) &&
        (!destination || checked("confirmMerge")))) &&
    (target.kind !== "unbind" || Boolean(binding));
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(draft.base) ||
    Boolean(draft.createdUserId);
  function finish() {
    setDraft(initial);
    onClose();
  }
  function close() {
    if (lock.current || busy) return;
    if (!dirty) {
      finish();
      return;
    }
    origin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLeaving(true);
  }
  function read() {
    if (!busy)
      void Promise.allSettled([
        onRead(),
        ...(roleMode ? [roles.refetch()] : []),
        ...(needsMember && memberId ? [member.refetch()] : []),
      ]);
  }
  function rebaseMember() {
    if (reviewBusy || !member.isSuccess || member.isError) return;
    let base = draft.base;
    if (currentMember && (editingMember || target.kind === "move"))
      base = {
        ...base,
        title: currentMember.title || "",
        [target.kind === "move" ? "makePrimary" : "isPrimary"]: Boolean(
          currentMember.isPrimary
        ),
      };
    setDraft(old => ({
      ...old,
      membershipToken: member.data!.membershipToken,
      base,
      fields: {
        ...mergeOrganizationFields(old.base, old.fields, base),
        ...(target.kind === "move" ? { confirmMerge: false } : {}),
      },
    }));
    setError("");
  }
  function rebaseUnit() {
    if (reviewBusy || !current) return;
    if (editing) {
      const latest = organizationUnitFields(current);
      setDraft(old => ({
        ...old,
        fields: mergeOrganizationFields(old.base, old.fields, latest),
        base: latest,
        configToken: current.configToken,
      }));
    } else setDraft(old => ({ ...old, configToken: current.configToken }));
    setError("");
  }
  async function submit() {
    if (lock.current || busy || !valid) return;
    lock.current = true;
    setWriting(true);
    setError("");
    const end = begin();
    setDraft(old => ({ ...old, attempted: true }));
    let acknowledgedUserId = draft.createdUserId;
    try {
      const id = target.unit?.id;
      let result: Parameters<Props["onSaved"]>[0];
      if (target.kind === "unit") {
        const common = {
          name: text("name"),
          parentUnitId: text("parentUnitId") || null,
          managerUserId: text("managerUserId")
            ? Number(text("managerUserId"))
            : null,
          unitType: text("unitType") || null,
          unitLevel: text("unitLevel") ? Number(text("unitLevel")) : null,
          standardCode: text("standardCode") || null,
          areaCode: text("areaCode") || null,
          category: text("category") || null,
          sortOrder: Number(text("sortOrder") || 0),
          description: text("description") || null,
        };
        if (editing) {
          if (!id || !draft.configToken)
            throw new Error("编辑目标不可用，请先重新读取部门。");
          await utils.client.config.updateOrganizationUnit.mutate({
            id,
            expectedConfigToken: draft.configToken,
            ...common,
          });
        } else
          result = {
            createdId: (
              await utils.client.config.createOrganizationUnit.mutate({
                code: text("code"),
                ...common,
              })
            ).id,
          };
      } else if (!id) throw new Error("操作目标不可用，请先重新读取部门。");
      else if (target.kind === "member")
        await utils.client.config.assignOrganizationMember.mutate({
          unitId: id,
          userId: memberId!,
          title: text("title") || undefined,
          isPrimary: checked("isPrimary"),
          expectedMembershipToken: draft.membershipToken,
          onlyIfAbsent: !editingMember,
        });
      else if (target.kind === "new-user") {
        let userId = draft.createdUserId,
          token = draft.membershipToken;
        if (!userId) {
          userId = (
            await utils.client.iam.createUser.mutate({
              username: text("username"),
              name: text("name"),
              password: text("password"),
              email: text("email") || undefined,
              role: text("role") === "admin" ? "admin" : "user",
            })
          ).userId;
          acknowledgedUserId = userId;
          setDraft(old => ({
            ...old,
            createdUserId: userId,
            fields: { ...old.fields, password: "" },
          }));
        }
        if (!token) {
          token = (
            await utils.config.organizationMemberConfiguration.fetch({ userId })
          ).membershipToken;
          setDraft(old => ({ ...old, membershipToken: token }));
        }
        await utils.client.config.assignOrganizationMember.mutate({
          unitId: id,
          userId,
          title: text("title") || undefined,
          isPrimary: checked("isPrimary"),
          expectedMembershipToken: token,
          onlyIfAbsent: true,
        });
      } else if (target.kind === "move")
        await utils.client.config.moveOrganizationMember.mutate({
          fromUnitId: id,
          toUnitId: text("toUnitId"),
          userId: memberId!,
          title: text("title"),
          makePrimary: checked("makePrimary"),
          expectedMembershipToken: draft.membershipToken,
        });
      else if (target.kind === "remove")
        await utils.client.config.removeOrganizationMember.mutate({
          unitId: id,
          userId: memberId!,
          expectedMembershipToken: draft.membershipToken,
        });
      else if (target.kind === "primary")
        await utils.client.config.setPrimaryOrganizationMembership.mutate({
          unitId: id,
          userId: memberId!,
          expectedMembershipToken: draft.membershipToken,
        });
      else if (target.kind === "role")
        await utils.client.config.bindOrganizationRole.mutate({
          unitId: id,
          roleId: Number(text("roleId")),
          includeDescendants: checked("includeDescendants"),
          expiresAt: expiry.expiresAt ?? null,
          expectedRoleConfigToken: draft.roleToken,
          onlyIfAbsent: true,
        });
      else if (target.kind === "unbind")
        await utils.client.config.unbindOrganizationRole.mutate({
          unitId: id,
          roleId: Number(target.binding?.roleId),
          expectedConfigToken: draft.configToken,
        });
      else if (target.kind === "status")
        await utils.client.config.updateOrganizationUnit.mutate({
          id,
          status: target.status,
          expectedConfigToken: draft.configToken,
        });
      else if (target.kind === "delete") {
        await utils.client.config.deleteOrganizationUnit.mutate({
          id,
          expectedConfigToken: draft.configToken,
        });
        result = { deletedId: id, parentId: target.unit?.parentUnitId };
      }
      setDraft(initial);
      onClose();
      onSaved(result);
    } catch (cause) {
      setError(
        (acknowledgedUserId ? "账号已创建，本次仅需重试加入部门。" : "") +
          (cause instanceof Error
            ? cause.message
            : "保存结果暂不可确认，请先读取列表核对。")
      );
      read();
    } finally {
      lock.current = false;
      setWriting(false);
      end();
    }
  }
  const unitName = target.unit
    ? `${target.unit.name}（${target.unit.code}）`
    : "根部门";
  const person = target.member
    ? `${target.member.name || target.member.username}（${target.member.username}）`
    : "";
  const titles: Record<OrganizationTarget["kind"], string> = {
    unit: editing
      ? "编辑部门"
      : target.mode === "root"
        ? "新增根部门"
        : target.mode === "child"
          ? "新增子部门"
          : "新增同级部门",
    member: editingMember ? "编辑成员岗位" : "添加成员",
    "new-user": "新建内部用户并加入部门",
    move: "迁移成员",
    role: "绑定部门权限组",
    remove: "确认移出部门",
    primary: "确认设为主部门",
    unbind: "确认解绑权限组",
    status: target.status === "active" ? "确认启用部门" : "确认停用部门",
    delete: "确认删除部门",
  };
  const submitLabels: Partial<Record<OrganizationTarget["kind"], string>> = {
    unit: editing ? "保存部门" : "确认创建",
    member: "保存成员",
    "new-user": draft.createdUserId ? "重试加入部门" : "创建并加入部门",
    move: "确认迁移",
    role: "确认绑定",
    remove: "确认移出",
    primary: "确认设置",
    unbind: "确认解绑",
    status: target.status === "active" ? "确认启用部门" : "确认停用部门",
    delete: "确认删除空部门",
  };
  const showUnitValue = (
    key: string,
    value: string | boolean,
    values: OrganizationFields
  ) =>
    key === "parentUnitId"
      ? value
        ? units.find(row => row.id === value)?.displayPath || "原上级部门不可用"
        : "无上级部门"
      : key === "managerUserId"
        ? String(
            values.managerLabel || (value ? "原负责人不可用" : "未指定负责人")
          )
        : String(value || "未填写");
  const descendants = new Set<string>();
  if (editing && target.unit) {
    const queue = [target.unit.id];
    while (queue.length) {
      const id = queue.pop()!;
      if (descendants.has(id)) continue;
      descendants.add(id);
      queue.push(
        ...units.filter(row => row.parentUnitId === id).map(row => row.id)
      );
    }
  }
  const select = (label: string, key: string, options: React.ReactNode) => (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      {label}
      <select
        aria-label={label}
        className="h-11 min-w-0 rounded-md border border-border bg-card px-3 min-[1024px]:h-10"
        value={text(key)}
        onChange={e =>
          update(
            key === "toUnitId"
              ? { toUnitId: e.target.value, confirmMerge: false }
              : { [key]: e.target.value }
          )
        }
      >
        {options}
      </select>
    </label>
  );
  const input = (
    label: string,
    key: string,
    type = "text",
    disabled = false
  ) => (
    <Field
      key={key}
      label={label}
      value={text(key)}
      type={type}
      disabled={disabled}
      required={
        ["code", "name", "username", "password"].includes(key) && !disabled
      }
      minLength={key === "password" ? 12 : key === "username" ? 3 : undefined}
      onChange={value => update({ [key]: value })}
    />
  );
  const checkbox = (label: string, key: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        className="mt-1"
        type="checkbox"
        checked={checked(key)}
        onChange={e => update({ [key]: e.target.checked })}
      />
      {label}
    </label>
  );
  function exportDraft() {
    const values = { ...draft.fields };
    delete values.password;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { target, draft: { ...draft, fields: values } },
            null,
            2
          ),
        ],
        { type: "application/json;charset=utf-8" }
      )
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "organization-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const observed =
    ((target.kind === "member" && !editingMember) ||
      target.kind === "new-user") &&
    draft.attempted &&
    currentMember;
  return (
    <>
      <CreationDialog
        open
        title={titles[target.kind]}
        description={
          target.kind === "unit"
            ? "维护部门信息；保存失败保留填写，配置变化时先核对。"
            : "操作对象固定为下方所示部门和账号。请核对后提交。"
        }
        submitLabel={submitLabels[target.kind]}
        onOpenChange={open => {
          if (!open) close();
        }}
        pending={busy}
        submitDisabled={!valid || Boolean(observed)}
        errorMessage={error}
        onSubmit={submit}
        destructive={
          ["remove", "unbind", "delete"].includes(target.kind) ||
          (target.kind === "status" && target.status === "disabled")
        }
        className={target.kind === "unit" ? "max-w-3xl" : "max-w-2xl"}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={reviewBusy}
            onClick={read}
          >
            重新读取组织与权限
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={exportDraft}
          >
            导出填写
          </Button>
        </div>
        {target.unit && (
          <p className="break-words text-sm">
            当前部门：<strong>{unitName}</strong>
            {person && (
              <>
                <br />
                当前成员：{person}
              </>
            )}
          </p>
        )}
        {unavailable && (
          <p role="alert" className="text-sm text-destructive">
            目标部门不可用，已暂停提交。填写仍保留，请重新读取。
          </p>
        )}
        {inactive && (
          <p role="alert" className="text-sm text-destructive">
            目标部门已停用，请核对当前部门状态。
          </p>
        )}
        {unitChanged && (
          <div
            role="alert"
            className="grid gap-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 text-sm"
          >
            <p>部门配置已变化，请核对后继续。本次填写不会被自动覆盖。</p>
            {editing &&
              Object.keys(organizationUnitFields(current))
                .filter(
                  key =>
                    organizationUnitFields(current)[key] !== draft.base[key]
                )
                .map(key => (
                  <p className="break-words" key={key}>
                    {fieldLabels[key]}：
                    {showUnitValue(key, draft.base[key], draft.base)} →{" "}
                    {showUnitValue(
                      key,
                      organizationUnitFields(current)[key],
                      organizationUnitFields(current)
                    )}
                  </p>
                ))}
            <Button
              type="button"
              variant="outline"
              disabled={reviewBusy}
              onClick={rebaseUnit}
            >
              {editing ? "合并最新配置并保留本次修改" : "确认使用当前部门信息"}
            </Button>
          </div>
        )}
        {needsMember && memberId && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p>当前部门归属</p>
            {member.isError ? (
              <p role="alert">读取失败，已暂停提交，请重新读取。</p>
            ) : (
              member.data?.memberships.map(row => (
                <p key={String(row.id)}>
                  {row.unitName}（{row.unitCode}） · {row.title || "未配置岗位"}
                  {row.isPrimary ? " · 主部门" : ""}
                </p>
              ))
            )}
            {member.isSuccess && !member.data.memberships.length && (
              <p>尚未加入部门。</p>
            )}
            {memberChanged && (
              <>
                <p role="alert" className="mt-2 text-aiflow-warning">
                  成员归属已变化，请核对当前列表。岗位与目标填写仍保留。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2"
                  disabled={reviewBusy}
                  onClick={rebaseMember}
                >
                  确认使用当前成员归属
                </Button>
              </>
            )}
          </div>
        )}
        {target.kind === "unit" && text("parentUnitId") && !chosenParent && (
          <p role="alert" className="text-sm text-destructive">
            所选上级部门不可用，请保留其他填写并选择有效部门。
          </p>
        )}
        {target.kind === "move" && text("toUnitId") && !chosenDestination && (
          <p role="alert" className="text-sm text-destructive">
            目标部门已不可用，请重新选择；岗位填写仍保留。
          </p>
        )}
        {needsMember && member.isSuccess && !member.data.user && (
          <p role="alert" className="text-sm text-destructive">
            目标账号不可用，请先重新读取并核对。
          </p>
        )}
        {target.kind === "unbind" && !reading && !binding && (
          <p role="status" className="text-sm">
            该权限绑定已不存在，无需重复解绑。
          </p>
        )}
        {bindingChanged && (
          <p role="alert" className="text-sm text-aiflow-warning">
            权限绑定已变化，当前范围为
            {binding.includeDescendants ? "含子部门" : "仅本部门"}，到期时间
            {binding.expiresAt
              ? new Date(binding.expiresAt).toLocaleString()
              : "长期有效"}
            。
            <Button
              type="button"
              variant="outline"
              disabled={reviewBusy}
              onClick={() =>
                setDraft(old => ({ ...old, configToken: binding.configToken }))
              }
            >
              确认当前绑定后继续
            </Button>
          </p>
        )}
        {observed && (
          <div className="grid gap-2 rounded-lg border border-aiflow-info-border p-3 text-sm">
            <p>
              列表中已存在该部门关系。请核对上方岗位与主部门信息；不会重复加入。
            </p>
            <Button type="button" variant="outline" onClick={finish}>
              已核对，结束填写
            </Button>
          </div>
        )}
        {target.kind === "unit" && (
          <>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {!editing && input("部门编码", "code")}
              {input("部门名称", "name")}
              {select(
                "上级部门",
                "parentUnitId",
                <>
                  <option value="">无上级部门</option>
                  {units
                    .filter(
                      row => row.status === "active" && !descendants.has(row.id)
                    )
                    .map(row => (
                      <option key={row.id} value={row.id}>
                        {row.displayPath || `${row.name}（${row.code}）`}
                      </option>
                    ))}
                </>
              )}
              <div className="grid min-w-0 gap-1.5 text-sm font-medium">
                <span>部门负责人</span>
                <OrganizationUserSelect
                  ariaLabel="部门负责人"
                  enabled
                  value={text("managerUserId")}
                  selectedLabel={text("managerLabel") || undefined}
                  placeholder="未指定负责人"
                  clearLabel="清除负责人"
                  onChange={(value, label) =>
                    update({ managerUserId: value, managerLabel: label || "" })
                  }
                />
              </div>
              <details className="rounded-lg border border-border sm:col-span-2">
                <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm">
                  其他机构属性（可选）
                </summary>
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  {[
                    "unitType",
                    "unitLevel",
                    "standardCode",
                    "areaCode",
                    "category",
                    "sortOrder",
                  ].map(key =>
                    input(
                      fieldLabels[key],
                      key,
                      ["unitLevel", "sortOrder"].includes(key)
                        ? "number"
                        : "text"
                    )
                  )}
                </div>
              </details>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              <span id="organization-unit-description-label">部门说明</span>
              <Textarea
                aria-labelledby="organization-unit-description-label"
                value={text("description")}
                maxLength={2000}
                onChange={e => update({ description: e.target.value })}
              />
            </label>
          </>
        )}
        {target.kind === "member" && (
          <>
            {!editingMember && (
              <div className="grid gap-1.5 text-sm font-medium">
                <span>内部账号</span>
                <OrganizationUserSelect
                  ariaLabel="内部账号"
                  enabled
                  value={text("userId")}
                  selectedLabel={
                    member.data?.user &&
                    Number(member.data.user.id) === Number(text("userId"))
                      ? `${member.data.user.name || member.data.user.username}（${member.data.user.username}）`
                      : text("userLabel") || undefined
                  }
                  placeholder="输入姓名或登录名搜索账号"
                  required
                  onChange={value => {
                    if (lock.current || busy) return;
                    update({ userId: value });
                    setDraft(old => ({ ...old, membershipToken: "" }));
                  }}
                />
              </div>
            )}
            {input("岗位/职务", "title")}
            {checkbox("设为该成员的主部门（驱动直属上级解析）", "isPrimary")}
            {currentMember && !editingMember && !draft.attempted && (
              <p role="alert" className="text-sm text-aiflow-warning">
                该账号已在当前部门，请核对现有岗位，不会覆盖。
              </p>
            )}
          </>
        )}
        {target.kind === "new-user" && (
          <>
            {draft.createdUserId && (
              <p
                role="status"
                className="rounded-lg border border-aiflow-warning-border p-3 text-sm"
              >
                账号已创建，账号信息不可修改；本次仅重试加入部门。
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {input(
                "登录名",
                "username",
                "text",
                Boolean(draft.createdUserId)
              )}
              {input("姓名", "name", "text", Boolean(draft.createdUserId))}
              {input(
                "初始密码",
                "password",
                "password",
                Boolean(draft.createdUserId)
              )}
              {input(
                "邮箱（可选）",
                "email",
                "email",
                Boolean(draft.createdUserId)
              )}
              <label className="grid gap-1.5 text-sm font-medium">
                账号类型
                <select
                  className="h-11 rounded-md border border-border bg-card px-3"
                  value={text("role")}
                  disabled={Boolean(draft.createdUserId)}
                  onChange={e => update({ role: e.target.value })}
                >
                  <option value="user">普通用户</option>
                  <option value="admin">系统管理员</option>
                </select>
              </label>
              {input("岗位/职务（可选）", "title")}
            </div>
            {checkbox("设为新用户的主部门（驱动直属上级解析）", "isPrimary")}
            <p className="text-sm text-muted-foreground">
              初始密码不包含在导出文件中，请另行保管。
            </p>
          </>
        )}
        {target.kind === "move" && (
          <>
            {select(
              "目标部门",
              "toUnitId",
              <>
                <option value="">请选择目标部门</option>
                {units
                  .filter(
                    row => row.status === "active" && row.id !== target.unit?.id
                  )
                  .map(row => (
                    <option key={row.id} value={row.id}>
                      {row.displayPath || `${row.name}（${row.code}）`}
                    </option>
                  ))}
              </>
            )}
            {destination && (
              <div
                role="alert"
                className="grid gap-2 rounded-lg border border-aiflow-warning-border p-3 text-sm"
              >
                <p>
                  该成员已在目标部门任职（{destination.title || "未配置岗位"}
                  ）。迁移会移除原部门关系，并使用本次岗位更新目标部门。
                </p>
                {checkbox("已核对，允许合并到现有部门关系", "confirmMerge")}
              </div>
            )}
            {input("迁移后岗位/职务", "title")}
            {checkbox("将目标部门设为该成员的主部门", "makePrimary")}
          </>
        )}
        {roleMode && (
          <>
            <label className="grid gap-1.5 text-sm font-medium">
              权限组
              <select
                aria-label="权限组"
                className="h-11 min-w-0 rounded-md border border-border bg-card px-3"
                value={text("roleId")}
                onChange={e => {
                  update({ roleId: e.target.value });
                  setDraft(old => ({
                    ...old,
                    roleToken:
                      roles.data?.find(row => String(row.id) === e.target.value)
                        ?.configToken || "",
                  }));
                }}
              >
                <option value="">请选择权限组</option>
                {roleOptions
                  ?.filter(
                    row => row.scope === "system" && row.code !== "system_admin"
                  )
                  .map(row => (
                    <option
                      key={row.id}
                      value={row.id}
                      disabled={
                        !readRolePermissionCodes(row.permissions).length
                      }
                    >
                      {row.name}（{row.code}）
                    </option>
                  ))}
              </select>
            </label>
            {roles.isError && (
              <p role="alert" className="text-sm text-destructive">
                权限组读取失败，请重新读取。填写仍保留。
              </p>
            )}
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">绑定后的权限</p>
              <p>流程权限覆盖全部流程，不限于本部门创建的流程。</p>
              <ul className="mt-2 grid gap-1">
                {permissions.map(code => (
                  <li key={code}>
                    {catalog.data?.find(row => row.code === code)?.name || code}
                  </li>
                ))}
              </ul>
              {roleChanged && (
                <>
                  <p role="alert" className="mt-2 text-aiflow-warning">
                    角色配置已变化，请重新核对上方权限。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reviewBusy}
                    onClick={() =>
                      setDraft(old => ({
                        ...old,
                        roleToken: selectedRole!.configToken,
                      }))
                    }
                  >
                    确认使用当前权限
                  </Button>
                </>
              )}
              {binding && (
                <p role="alert" className="mt-2 text-aiflow-warning">
                  该权限组已绑定，不会覆盖范围与有效期。请读取当前列表核对。
                </p>
              )}
            </div>
            {checkbox("子部门成员同步继承", "includeDescendants")}
            {input("到期时间（可选）", "expiresAt", "datetime-local")}
            {expiry.error && (
              <p role="alert" className="text-sm text-destructive">
                {expiry.error}
              </p>
            )}
          </>
        )}
        {target.kind === "remove" && (
          <p className="text-sm">
            仅移除当前部门关系，不会删除账号；其他部门关系保留。
          </p>
        )}
        {target.kind === "primary" && (
          <p className="text-sm">
            将此部门设为该成员的唯一主部门，用于直属上级解析。
          </p>
        )}
        {target.kind === "unbind" && (
          <p className="text-sm">
            解绑“{target.binding?.roleName}
            ”后，本部门及继承范围内成员的相应权限立即失效。
          </p>
        )}
        {target.kind === "status" && (
          <p className="text-sm">
            {target.status === "disabled"
              ? `停用后，本部门及子部门约 ${target.affectedMemberCount ?? 0} 个成员的继承权限和处理人解析可能变化；账号与成员关系保留。`
              : "启用后将按现有权限绑定与有效期恢复计算成员权限。"}
          </p>
        )}
        {target.kind === "delete" && (
          <p className="text-sm">
            仅空部门可以删除。仍有子部门、成员、权限组或其他引用时会阻止删除，并保留现有数据。
          </p>
        )}
      </CreationDialog>
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            origin.current?.focus();
          }}
        >
          <AlertDialogTitle>保留当前填写？</AlertDialogTitle>
          <AlertDialogDescription>
            尚有未保存的组织填写。放弃填写不会撤销已创建的账号或已提交的组织变更。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续填写</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setLeaving(false);
                finish();
              }}
            >
              放弃填写并关闭
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  required,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
      {label}
      <Input
        className="aiflow-type-control h-11 min-[1024px]:h-10"
        type={type}
        disabled={disabled}
        required={required}
        minLength={minLength}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
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
  onChange: (value: string, label?: string) => void;
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
    const label = user.name
      ? `${user.name}（${user.username}）`
      : user.username;
    setSelectedUser({ id, label });
    onChange(id, label);
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
