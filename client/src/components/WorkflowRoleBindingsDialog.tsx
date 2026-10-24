import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { roleExpiryInput } from "@shared/role-expiry";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import {
  useResourceDraftState,
  useResourceDraftPending,
} from "./ResourceDraftSession";

type Tab = "builtin" | "custom";
type Role = "owner" | "editor" | "operator" | "viewer";
const roleNames: Record<Role, string> = {
  owner: "所有者",
  editor: "编辑者",
  operator: "运行者",
  viewer: "查看者",
};
const roleDetails: Record<Role, string> = {
  owner: "管理流程成员、编辑、发布并运行流程。",
  editor: "编辑流程定义；发布和成员管理需另行授权。",
  operator: "运行流程并查看运行结果，不能编辑定义。",
  viewer: "查看流程定义与运行信息，不能修改或运行。",
};
const statusNames: Record<string, string> = {
  active: "有效",
  revoked: "已撤销",
  disabled: "账号停用",
  pending: "待生效",
  expired: "已到期",
};
const time = (value: unknown) =>
  value ? new Date(value as string).toLocaleString("zh-CN") : "长期有效";
const emptyForm = {
  userId: "",
  role: "viewer" as Role,
  roleCode: "",
  hours: "",
  roleSnapshot: null as {
    token: string;
    name: string;
    labels: string[];
  } | null,
};
type Revoke = { id: string; userId: number; role?: Role; label: string };

export default function WorkflowRoleBindingsDialog({
  workflowId,
  workflowName,
  projectId,
  initialTab = "custom",
  archived = false,
  onClose,
}: {
  workflowId: string;
  workflowName: string;
  projectId?: string;
  initialTab?: Tab;
  archived?: boolean;
  onClose: () => void;
}) {
  const scope = projectId || `workflow:${workflowId}`;
  const [builtinForm, setBuiltinForm] = useResourceDraftState(
    scope,
    "workflow-authorization",
    `${workflowId}:builtin`,
    emptyForm
  );
  const [customForm, setCustomForm] = useResourceDraftState(
    scope,
    "workflow-authorization",
    `${workflowId}:custom`,
    emptyForm
  );
  const [labels, setLabels] = useResourceDraftState<Record<string, string>>(
    scope,
    "workflow-authorization",
    `${workflowId}:labels`,
    {},
    false
  );
  const begin = useResourceDraftPending(scope, "workflow-authorization");
  const [tab, setTab] = useState<Tab>(initialTab);
  const form = tab === "builtin" ? builtinForm : customForm;
  const setForm = tab === "builtin" ? setBuiltinForm : setCustomForm;
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState({ user: "", records: "" });
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [revoking, setRevoking] = useState<Revoke | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const origin = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const closeOrigin = useRef<HTMLElement | null>(null);
  const dirty = [builtinForm, customForm].some(
    value => JSON.stringify(value) !== JSON.stringify(emptyForm)
  );
  const access = trpc.workflow.access.useQuery(
    { id: workflowId },
    authorizationQueryPolicy(true)
  );
  const readable =
    access.isSuccess &&
    !access.isError &&
    access.data.permissions.has("workflow:view");
  const manageable =
    readable &&
    access.data!.permissions.has("workflow:members:manage") &&
    !archived &&
    !access.data!.publication?.archived;
  const members = trpc.workflow.members.useQuery(
    { workflowId },
    authorizationQueryPolicy(readable && tab === "builtin")
  );
  const roles = trpc.workflow.customRoles.useQuery(
    { workflowId },
    authorizationQueryPolicy(manageable && tab === "custom")
  );
  const assignments = trpc.workflow.customRoleAssignments.useQuery(
    { workflowId, page, query: debounced.records },
    authorizationQueryPolicy(manageable && tab === "custom")
  );
  const candidates = trpc.workflow.memberCandidates.useQuery(
    {
      workflowId,
      query: debounced.user,
      selectedIds: form.userId ? [Number(form.userId)] : [],
    },
    authorizationQueryPolicy(
      manageable && Boolean(debounced.user || form.userId)
    )
  );
  const grant = trpc.workflow.grantMember.useMutation();
  const revoke = trpc.workflow.revokeMember.useMutation();
  const bind = trpc.workflow.assignCustomRole.useMutation();
  const unbind = trpc.workflow.revokeCustomRole.useMutation();
  const utils = trpc.useUtils();
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDebounced({
          user: query.trim().slice(0, 100),
          records: search.trim(),
        }),
      250
    );
    return () => clearTimeout(timer);
  }, [query, search]);
  const validUser =
    candidates.isSuccess &&
    !candidates.isError &&
    candidates.data.some(row => String(row.id) === form.userId);
  const customRole =
    manageable && !roles.isError
      ? roles.data?.find(row => row.code === form.roleCode)
      : undefined;
  const roleConfirmed = Boolean(
    customForm.roleSnapshot?.token &&
      customRole &&
      customForm.roleSnapshot.token === customRole.configToken
  );
  const confirmRole = () => {
    if (busy || !manageable || roles.isFetching || !customRole) return;
    change({
      roleSnapshot: {
        token: customRole.configToken,
        name: customRole.name,
        labels: customRole.permissionLabels,
      },
    });
  };
  const validity = roleExpiryInput(form.hours);
  const validRole =
    tab === "builtin" ||
    Boolean(
      roleConfirmed &&
        customRole?.permissionLabels.length &&
        roles.isSuccess &&
        !roles.isFetching
    );
  const listReady =
    tab === "builtin"
      ? readable && members.isSuccess && !members.isError
      : manageable && assignments.isSuccess && !assignments.isError;
  const rows: Array<{
    id: string;
    userId: number;
    label: string;
    role?: Role;
    roleName: string;
    status: string;
    expiresAt: unknown;
    revokedAt: unknown;
    protectedOwner: boolean;
  }> =
    tab === "builtin"
      ? (listReady ? (members.data ?? []) : [])
          .filter(row =>
            `${row.name || ""} ${row.username} ${roleNames[row.role as Role]}`
              .toLocaleLowerCase()
              .includes(debounced.records.toLocaleLowerCase())
          )
          .map(row => ({
            id: row.id,
            userId: Number(row.userId),
            label: `${row.name || row.username}（${row.username}）`,
            role: row.role as Role,
            roleName: roleNames[row.role as Role] || row.role,
            status: row.authorizationStatus,
            expiresAt: row.expiresAt,
            revokedAt: row.revokedAt,
            protectedOwner: Boolean(row.protectedOwner),
          }))
      : (listReady ? (assignments.data?.items ?? []) : []).map(row => ({
          id: row.id,
          userId: Number(row.userId),
          label: `${row.name || row.username}（${row.username}）`,
          roleName: row.roleName,
          status: row.authorizationStatus,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt,
          protectedOwner: false,
        }));
  const total =
    tab === "builtin"
      ? rows.length
      : listReady
        ? (assignments.data?.total ?? 0)
        : 0;
  const visibleRows =
    tab === "builtin" ? rows.slice(page * 10, page * 10 + 10) : rows;
  useEffect(() => {
    if (listReady && page > 0 && page * 10 >= total)
      setPage(Math.max(0, Math.ceil(total / 10) - 1));
  }, [total, page, listReady]);
  const change = (value: Partial<typeof form>) => {
    setForm(current => ({ ...current, ...value }));
    setError("");
    setNotice("");
  };
  function refresh() {
    void Promise.allSettled([
      access.refetch(),
      ...(tab === "builtin"
        ? [members.refetch()]
        : manageable
          ? [roles.refetch(), assignments.refetch()]
          : []),
      ...(manageable && (form.userId || debounced.user)
        ? [candidates.refetch()]
        : []),
    ]);
  }
  function refreshAfterWrite() {
    // Acknowledged writes release the form before any read refresh finishes.
    void Promise.allSettled([
      utils.workflow.members.invalidate({ workflowId }),
      utils.workflow.customRoleAssignments.invalidate({ workflowId }),
      utils.workflow.access.invalidate({ id: workflowId }),
      utils.workflow.page.invalidate(),
      utils.workflow.get.invalidate({ id: workflowId }),
    ]);
  }
  async function write(
    action: () => Promise<void>,
    failure: (message: string) => void
  ) {
    if (lock.current || !manageable) return;
    lock.current = true;
    setBusy(true);
    const finish = begin();
    try {
      await action();
    } catch (cause) {
      failure(
        `${cause instanceof Error ? cause.message : "请求失败。"} 请先读取列表核对结果；填写已保留。`
      );
      void access.refetch();
      if (tab === "custom") void roles.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
      finish();
    }
  }
  async function submit() {
    const currentValidity = roleExpiryInput(form.hours);
    if (
      !validUser ||
      !validRole ||
      currentValidity.error ||
      !listReady ||
      query.trim() !== debounced.user
    )
      return;
    setError("");
    setNotice("");
    await write(async () => {
      if (tab === "builtin")
        await grant.mutateAsync({
          workflowId,
          userId: Number(form.userId),
          role: form.role,
          expiresAt: currentValidity.expiresAt,
        });
      else
        await bind.mutateAsync({
          workflowId,
          userId: Number(form.userId),
          roleCode: form.roleCode,
          expectedConfigToken: form.roleSnapshot?.token,
          expiresAt: currentValidity.expiresAt,
        });
      setForm(emptyForm);
      setQuery("");
      setPage(0);
      setNotice("授权已提交，可继续填写。列表正在更新。");
      refreshAfterWrite();
    }, setError);
  }
  async function confirmRevoke() {
    const selected = revoking;
    if (!selected) return;
    setRevokeError("");
    await write(async () => {
      if (selected.role)
        await revoke.mutateAsync({
          workflowId,
          userId: selected.userId,
          role: selected.role,
        });
      else await unbind.mutateAsync({ workflowId, assignmentId: selected.id });
      origin.current = null;
      setRevoking(null);
      setNotice("这项授权已撤销；其他授权来源继续生效。");
      refreshAfterWrite();
    }, setRevokeError);
  }
  function close() {
    if (lock.current || revoking || leaving) return;
    if (dirty) {
      closeOrigin.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setLeaving(true);
    } else onClose();
  }
  function exportForm() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              workflowId,
              workflowName,
              drafts: { builtin: builtinForm, custom: customForm },
              labels,
            },
            null,
            2
          ),
        ],
        { type: "application/json;charset=utf-8" }
      )
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "workflow-authorization-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-workflow-authorization=""
          className="auth-dialog"
          onEscapeKeyDown={event => {
            if (lock.current || revoking || leaving) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>流程成员与权限</DialogTitle>
            <DialogDescription>
              {workflowName} ·
              仅对当前流程生效，各项权限叠加。撤销一项不会移除其他来源的权限。
            </DialogDescription>
          </DialogHeader>
          <div className="auth-row">
            <div role="tablist" aria-label="流程授权类别" className="auth-tabs">
              {(["builtin", "custom"] as const).map(value => (
                <Button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  variant={tab === value ? "default" : "ghost"}
                  disabled={busy}
                  onClick={() => {
                    setTab(value);
                    setPage(0);
                    setError("");
                  }}
                >
                  {value === "builtin" ? "内置协作角色" : "自定义流程角色"}
                </Button>
              ))}
            </div>
            <Button
              ref={refreshButton}
              variant="outline"
              disabled={busy || access.isFetching}
              onClick={refresh}
            >
              重新读取权限与列表
            </Button>
          </div>
          {!manageable && (
            <p role="status" className="auth-info">
              {archived
                ? "流程或所属业务已归档，当前只能查看。"
                : access.isError
                  ? "权限读取失败，已暂停授权并隐藏旧列表。"
                  : !access.isSuccess
                    ? "正在确认当前权限…"
                    : "当前没有流程成员管理权限。"}
              填写仍保留在当前账号会话中，可导出后再确认权限。
            </p>
          )}
          <form
            className="auth-form"
            onSubmit={event => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 className="auth-title">
              {tab === "builtin" ? "授予协作角色" : "绑定自定义角色"}
            </h3>
            <fieldset
              disabled={busy || !manageable}
              className="min-w-0 space-y-4"
            >
              <div className="space-y-2">
                <Label>内部账号</Label>
                <SearchableMultiSelect
                  ariaLabel="待授权内部账号"
                  value={form.userId ? [form.userId] : []}
                  options={
                    manageable && !candidates.isError
                      ? (candidates.data ?? []).map(row => ({
                          value: String(row.id),
                          label: `${row.name || row.username}（${row.username}）`,
                        }))
                      : Object.entries(labels)
                          .filter(([id]) => id === form.userId)
                          .map(([value, label]) => ({ value, label }))
                  }
                  query={query}
                  onQueryChange={value => setQuery(value.slice(0, 100))}
                  onChange={ids => {
                    const selected = candidates.data?.find(
                      row => String(row.id) === ids[0]
                    );
                    if (selected)
                      setLabels(current => ({
                        ...current,
                        [String(selected.id)]:
                          `${selected.name || selected.username}（${selected.username}）`,
                      }));
                    change({ userId: ids[0] || "" });
                  }}
                  placeholder="搜索并选择启用中的账号"
                  searchPlaceholder="搜索姓名或账号"
                  emptyMessage="没有可用账号"
                  noResultsMessage="没有匹配的启用账号"
                  requireSearch
                  maxSelected={1}
                  maxResults={50}
                  hasMore={(candidates.data?.length ?? 0) > 50}
                  disabled={busy || !manageable}
                  error={candidates.isError}
                  loading={
                    candidates.isFetching || query.trim() !== debounced.user
                  }
                />
                {manageable && candidates.isError && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void candidates.refetch()}
                  >
                    重新搜索账号
                  </Button>
                )}
                {manageable &&
                  form.userId &&
                  candidates.isSuccess &&
                  !validUser && (
                    <p role="alert">
                      已选账号已停用或不可用，请重新选择；原填写已保留。
                    </p>
                  )}
              </div>
              <div className="auth-grid">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="workflow-role">
                    {tab === "builtin" ? "协作角色" : "自定义流程角色"}
                  </Label>
                  <select
                    id="workflow-role"
                    className="auth-select"
                    value={tab === "builtin" ? form.role : form.roleCode}
                    onChange={event => {
                      if (tab === "builtin")
                        change({ role: event.target.value as Role });
                      else {
                        const role = roles.data?.find(
                          row => row.code === event.target.value
                        );
                        change({
                          roleCode: event.target.value,
                          roleSnapshot: role
                            ? {
                                token: role.configToken,
                                name: role.name,
                                labels: role.permissionLabels,
                              }
                            : null,
                        });
                      }
                    }}
                  >
                    {tab === "builtin" ? (
                      Object.entries(roleNames).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="">请选择自定义流程角色</option>
                        {form.roleCode && !customRole && (
                          <option value={form.roleCode}>
                            {form.roleCode}（待核对）
                          </option>
                        )}
                        {manageable &&
                          !roles.isError &&
                          roles.data?.map(role => (
                            <option
                              key={role.code}
                              value={role.code}
                              disabled={!role.permissionLabels.length}
                            >
                              {role.name}（{role.code}）
                            </option>
                          ))}
                      </>
                    )}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workflow-role-hours">有效期（小时）</Label>
                  <Input
                    id="workflow-role-hours"
                    inputMode="numeric"
                    value={form.hours}
                    onChange={event => change({ hours: event.target.value })}
                    placeholder="留空表示长期有效"
                    aria-invalid={Boolean(validity.error)}
                    aria-describedby={
                      validity.error ? "workflow-expiry-error" : undefined
                    }
                  />
                </div>
              </div>
              {tab === "builtin" ? (
                <p className="auth-muted">{roleDetails[form.role]}</p>
              ) : (
                <section
                  data-workflow-role-preview=""
                  className="workflow-role-preview"
                  aria-label="本次绑定的角色权限"
                >
                  <p>
                    {manageable && customForm.roleSnapshot
                      ? `${roleConfirmed ? "本次确认" : "上次确认"}：${customForm.roleSnapshot.name}`
                      : manageable
                        ? "请选择并确认角色权限"
                        : "目录待确认"}
                  </p>
                  {manageable && customForm.roleSnapshot && (
                    <p className="text-muted-foreground">
                      {customForm.roleSnapshot.labels.join("、")}
                    </p>
                  )}
                  {form.roleCode && !roleConfirmed && (
                    <div role="alert">
                      <p>角色待确认，提交已暂停；人员与有效期保留。</p>
                      {customRole && (
                        <>
                          <p>
                            当前目录：{customRole.name} ·{" "}
                            {customRole.permissionLabels.join("、")}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              busy ||
                              roles.isFetching ||
                              !customRole.permissionLabels.length
                            }
                            onClick={confirmRole}
                          >
                            确认使用当前角色权限
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  <p className="auth-meta">后续修改角色权限将影响已有绑定。</p>
                </section>
              )}
              {tab === "custom" && roles.isError && (
                <p role="alert">
                  角色目录读取失败，请重新读取权限与列表；已选角色编码保留。
                </p>
              )}
              {validity.error && (
                <p
                  id="workflow-expiry-error"
                  role="alert"
                  className="auth-error"
                >
                  {validity.error}
                </p>
              )}
              <p className="auth-meta">
                {tab === "builtin"
                  ? "同一账号可拥有多个角色；重授相同角色会更新有效期。"
                  : "有效绑定不可重复提交；调整有效期请先撤销原绑定。"}
              </p>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !manageable ||
                  !listReady ||
                  !validUser ||
                  !validRole ||
                  Boolean(validity.error) ||
                  candidates.isFetching ||
                  query.trim() !== debounced.user
                }
              >
                {busy
                  ? "正在提交…"
                  : tab === "builtin"
                    ? "授予成员"
                    : "绑定到当前流程"}
              </Button>
            </fieldset>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="auth-body">
                {notice}
              </p>
            )}
          </form>
          <section className="space-y-3" aria-label="流程授权记录">
            <div className="auth-row">
              <h3 className="auth-title">
                授权记录{listReady ? `（${total}）` : ""}
              </h3>
              <p className="auth-meta">每页 10 条 · 包含到期及撤销记录</p>
            </div>
            <Input
              aria-label="搜索流程授权记录"
              placeholder="搜索账号或角色"
              value={search}
              maxLength={100}
              onChange={event => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
            {!listReady ? (
              <p role="status" className="auth-body">
                记录读取失败或权限待确认，已隐藏旧列表。
              </p>
            ) : visibleRows.length === 0 ? (
              <p className="auth-muted">没有匹配的授权记录。</p>
            ) : (
              visibleRows.map(row => (
                <div
                  data-workflow-grant={row.id}
                  key={row.id}
                  className="auth-item"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="auth-name">
                      {row.label} · {row.roleName}
                    </p>
                    <p className="auth-meta">
                      {statusNames[row.status] || "待核对"} ·{" "}
                      {row.expiresAt
                        ? `有效至 ${time(row.expiresAt)}`
                        : "长期有效"}
                      {row.protectedOwner ? " · 创建者，不可撤销" : ""}
                    </p>
                  </div>
                  {manageable && !row.revokedAt && !row.protectedOwner && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={event => {
                        origin.current = event.currentTarget;
                        setRevokeError("");
                        setRevoking({
                          id: row.id,
                          userId: row.userId,
                          role: row.role,
                          label: `${row.label} · ${row.roleName}`,
                        });
                      }}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              ))
            )}
            <div className="auth-row">
              <Button
                variant="outline"
                disabled={!listReady || page === 0 || busy}
                onClick={() => setPage(current => current - 1)}
              >
                上一页
              </Button>
              <span className="aiflow-type-meta">第 {page + 1} 页</span>
              <Button
                variant="outline"
                disabled={!listReady || (page + 1) * 10 >= total || busy}
                onClick={() => setPage(current => current + 1)}
              >
                下一页
              </Button>
            </div>
          </section>
          <div className="auth-actions">
            <Button variant="outline" disabled={busy} onClick={exportForm}>
              导出填写
            </Button>
            <Button variant="outline" disabled={busy} onClick={close}>
              关闭
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(revoking)}
        onOpenChange={open => {
          if (!open && !lock.current) setRevoking(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            (origin.current?.isConnected
              ? origin.current
              : refreshButton.current
            )?.focus({ preventScroll: true });
          }}
        >
          <AlertDialogTitle>撤销这项流程授权</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {revoking?.label} · 流程“{workflowName}
            ”。确认后仅撤销这项直接授权，其他来源的权限继续生效。
          </AlertDialogDescription>
          {revokeError && (
            <p role="alert" className="auth-error">
              {revokeError}
            </p>
          )}
          {!manageable && (
            <p role="status">管理权限待确认，撤销已暂停；请重新读取权限。</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy}
              onClick={() => setRevoking(null)}
            >
              保留授权
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy || !manageable}
              onClick={() => void confirmRevoke()}
            >
              {busy ? "正在撤销…" : "确认撤销"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={leaving}
        onOpenChange={open => {
          if (!open && !lock.current) setLeaving(false);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (closeOrigin.current?.isConnected)
              closeOrigin.current.focus({ preventScroll: true });
          }}
        >
          <AlertDialogTitle>关闭前保留授权填写</AlertDialogTitle>
          <AlertDialogDescription>
            填写尚未提交，可继续编辑或先导出；放弃填写不会撤销已提交的授权。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaving(false)}>
              继续编辑
            </AlertDialogCancel>
            <Button variant="outline" onClick={exportForm}>
              导出填写
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setBuiltinForm(emptyForm);
                setCustomForm(emptyForm);
                setLeaving(false);
                onClose();
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
