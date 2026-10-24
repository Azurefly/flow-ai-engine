import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import { roleExpiryInput } from "@shared/role-expiry";
import { readRolePermissionCodes } from "@shared/role-permission-codes";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import {
  useResourceDraftState,
  useResourceDraftSummary,
  useResourceDraftPending,
} from "./ResourceDraftSession";
import { toast } from "sonner";

export type SystemRoleTarget = {
  mode: "user" | "role";
  userId?: string;
  userLabel?: string;
  roleCode?: string;
  roleName?: string;
  configToken?: string;
};
export default function SystemRoleAssignmentDialog({
  target,
  onClose,
}: {
  target: SystemRoleTarget;
  onClose: () => void;
}) {
  const initial = {
    userId: target.userId || "",
    userLabel: target.userLabel || "",
    roleCode: target.roleCode || "",
    roleName: target.roleName || "",
    token: target.configToken || "",
    hours: "",
    note: "",
  };
  const [form, setForm] = useResourceDraftState(
    "iam",
    "system-authorization",
    `${target.mode}:${target.userId || target.roleCode}`,
    initial
  );
  const begin = useResourceDraftPending("iam", "system-authorization");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [writing, setBusy] = useState(false);
  const pending = useResourceDraftSummary("iam").pending;
  const busy = writing || pending > 0;
  const [error, setError] = useState("");
  const lock = useRef(false);
  const origin = useRef<HTMLElement | null>(null);
  const roles = trpc.iam.roles.useQuery(
    undefined,
    authorizationQueryPolicy(true)
  );
  const allowed = roles.isSuccess && !roles.isError;
  const catalog = trpc.iam.permissionCatalog.useQuery(undefined, {
    enabled: allowed,
    retry: false,
  });
  const currentRole = allowed
    ? roles.data?.find(
        role => role.scope === "system" && role.code === form.roleCode
      )
    : undefined;
  const details = trpc.iam.userAuthorizationDetails.useQuery(
    { userId: Number(form.userId) || 1 },
    authorizationQueryPolicy(allowed && Boolean(form.userId))
  );
  const candidates = trpc.iam.roleAssignableUsers.useQuery(
    {
      roleId: Number(currentRole?.id) || 1,
      search: search.trim(),
      offset: page * 10,
      limit: 10,
    },
    authorizationQueryPolicy(
      allowed && target.mode === "role" && Boolean(currentRole)
    )
  );
  const grant = trpc.iam.assignSystemRole.useMutation();
  const utils = trpc.useUtils();
  const changed = Boolean(
    currentRole && form.token !== currentRole.configToken
  );
  const assigned = details.data?.directRoles.some(
    (role: any) =>
      role.scopeType === "system" && role.roleCode === form.roleCode
  );
  const valid =
    allowed &&
    currentRole &&
    !changed &&
    !roles.isFetching &&
    details.isSuccess &&
    !details.isError &&
    details.data.user.status === "active" &&
    !assigned;
  const expiry = roleExpiryInput(form.hours);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const update = (value: Partial<typeof form>) => {
    setForm(current => ({ ...current, ...value }));
    setError("");
  };
  function refresh() {
    void Promise.allSettled([
      utils.auth.me.invalidate(),
      roles.refetch(),
      ...(form.userId ? [details.refetch()] : []),
      ...(target.mode === "role" && currentRole ? [candidates.refetch()] : []),
    ]);
  }
  function close() {
    if (lock.current) return;
    if (dirty) {
      origin.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setLeaving(true);
    } else onClose();
  }
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ target, draft: form }, null, 2)], {
        type: "application/json;charset=utf-8",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "system-role-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function submit() {
    const validity = roleExpiryInput(form.hours);
    if (lock.current || busy || !valid || validity.error) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const finish = begin();
    try {
      await grant.mutateAsync({
        userId: Number(form.userId),
        roleCode: form.roleCode,
        expectedConfigToken: form.token,
        expiresAt: validity.expiresAt,
        note: form.note.trim() || undefined,
      });
      setForm(initial);
      onClose();
      toast.success("角色绑定已生效。");
      void Promise.allSettled([
        utils.iam.invalidate(),
        utils.auth.me.invalidate(),
        utils.workflow.invalidate(),
        utils.project.invalidate(),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败。");
      void details.refetch();
      void roles.refetch();
    } finally {
      lock.current = false;
      setBusy(false);
      finish();
    }
  }
  return (
    <>
      <CreationDialog
        open
        onOpenChange={open => {
          if (!open) close();
        }}
        title={target.mode === "role" ? "为角色绑定用户" : "为用户绑定角色"}
        description="授予直接系统角色，与组织继承权限叠加；相同有效绑定不可重复提交。"
        submitLabel="确认绑定"
        pending={busy}
        submitDisabled={!valid || Boolean(expiry.error)}
        onSubmit={submit}
        errorMessage={error}
        errorHint="填写已保留，请先读取列表核对结果后再决定是否重试。"
      >
        <div data-system-role-assignment="" className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || roles.isFetching}
              onClick={refresh}
            >
              重新读取角色与账号
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
          {!allowed && (
            <p role="status" className="auth-body">
              当前管理权限或目录尚未确认，已暂停提交并保留填写。
            </p>
          )}
          <fieldset disabled={busy || !allowed} className="min-w-0 space-y-3">
            {target.mode === "user" ? (
              <>
                <div className="auth-label">
                  当前用户
                  <span className="break-all font-medium">
                    {form.userLabel}
                  </span>
                </div>
                <label className="auth-label">
                  系统角色
                  <select
                    className="auth-select"
                    value={form.roleCode}
                    onChange={event => {
                      const role = roles.data?.find(
                        row => row.code === event.target.value
                      );
                      update({
                        roleCode: role?.code || "",
                        roleName: role?.name || "",
                        token: role?.configToken || "",
                      });
                    }}
                  >
                    <option value="">请选择系统角色</option>
                    {form.roleCode && !currentRole && (
                      <option value={form.roleCode}>
                        {form.roleName || form.roleCode}（待核对）
                      </option>
                    )}
                    {allowed &&
                      roles.data
                        ?.filter(role => role.scope === "system")
                        .map(role => (
                          <option key={role.id} value={role.code}>
                            {role.name}（{role.code}）
                          </option>
                        ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <div className="auth-label">
                  当前角色
                  <span className="break-all font-medium">
                    {form.roleName || target.roleName}（{form.roleCode}）
                  </span>
                </div>
                <label className="auth-label">
                  搜索内部用户
                  <Input
                    maxLength={160}
                    value={search}
                    placeholder="姓名、用户名或邮箱"
                    onChange={event => {
                      setSearch(event.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                <label className="auth-label">
                  选择内部用户
                  <select
                    className="auth-select"
                    value={form.userId}
                    disabled={candidates.isPending || candidates.isError}
                    onChange={event => {
                      const user = candidates.data?.items.find(
                        row => String(row.id) === event.target.value
                      );
                      update({
                        userId: user ? String(user.id) : "",
                        userLabel: user
                          ? `${user.name || user.username}（${user.username}）`
                          : "",
                      });
                    }}
                  >
                    <option value="">请选择启用中的账号</option>
                    {form.userId &&
                      !candidates.data?.items.some(
                        row => String(row.id) === form.userId
                      ) && (
                        <option value={form.userId}>
                          {form.userLabel}（已选）
                        </option>
                      )}
                    {allowed &&
                      !candidates.isError &&
                      candidates.data?.items.map(user => (
                        <option key={user.id} value={user.id}>
                          {user.name || user.username}（{user.username}）
                        </option>
                      ))}
                  </select>
                </label>
                <div className="auth-row">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page === 0 || candidates.isFetching}
                    onClick={() => setPage(value => value - 1)}
                  >
                    上一页
                  </Button>
                  <span className="aiflow-type-meta">
                    每页10条 · 第{page + 1}页
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      candidates.isFetching ||
                      (page + 1) * 10 >= (candidates.data?.total || 0)
                    }
                    onClick={() => setPage(value => value + 1)}
                  >
                    下一页
                  </Button>
                </div>
                {candidates.isError && (
                  <p role="alert">
                    账号目录读取失败，请重新读取；已选账号保留。
                  </p>
                )}
              </>
            )}
            <p className="auth-muted">
              当前角色权限：
              {currentRole
                ? catalog.data
                  ? readRolePermissionCodes(currentRole.permissions)
                      .map(
                        code =>
                          catalog.data?.find(item => item.code === code)
                            ?.name || "未登记权限"
                      )
                      .join("、")
                  : "正在读取权限说明"
                : "请先选择有效角色。"}
            </p>
            {changed && (
              <div role="alert" className="aiflow-type-body space-y-2">
                <p>角色配置已变化，请核对当前权限。</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update({
                      token: currentRole!.configToken,
                      roleName: currentRole!.name,
                    })
                  }
                >
                  确认使用当前权限
                </Button>
              </div>
            )}
            {assigned && (
              <p role="status" className="auth-body">
                此账号已有效绑定该角色，请先核对列表；填写仍保留。
              </p>
            )}
            {form.userId &&
              details.isSuccess &&
              details.data.user.status !== "active" && (
                <p role="alert">此账号已停用，不能绑定角色。</p>
              )}
            <label className="auth-label">
              有效期小时（可选）
              <Input
                type="number"
                min={1}
                step={1}
                value={form.hours}
                aria-invalid={Boolean(expiry.error)}
                onChange={event => update({ hours: event.target.value })}
                placeholder="留空表示长期有效"
              />
            </label>
            <p role={expiry.error ? "alert" : "status"} className="auth-muted">
              {expiry.error || "留空表示长期有效；填写整数小时后自动到期。"}
            </p>
            <label className="auth-label">
              授权备注（可选）
              <Input
                maxLength={320}
                value={form.note}
                onChange={event => update({ note: event.target.value })}
                placeholder="记录授权原因，最多320字"
              />
            </label>
          </fieldset>
        </div>
      </CreationDialog>
      <AlertDialog
        open={leaving}
        onOpenChange={open => {
          if (!open && !lock.current) setLeaving(false);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (origin.current?.isConnected)
              origin.current.focus({ preventScroll: true });
          }}
        >
          <AlertDialogTitle>关闭前保留角色授权填写</AlertDialogTitle>
          <AlertDialogDescription>
            填写尚未提交，可继续编辑或先导出；放弃填写不会撤销已提交的授权。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLeaving(false)}>
              继续编辑
            </AlertDialogCancel>
            <Button variant="outline" onClick={exportDraft}>
              导出填写
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setForm(initial);
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
