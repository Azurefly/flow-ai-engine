import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { roleExpiryInput } from "@shared/role-expiry";
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
const statusLabel: Record<string, string> = {
  active: "有效",
  revoked: "已撤销",
  disabled: "账号停用",
  pending: "待生效",
  expired: "已到期",
};
const time = (value: unknown) =>
  value ? new Date(value as string).toLocaleString("zh-CN") : "长期有效";
export default function WorkflowRoleBindingsDialog({
  workflowId,
  workflowName,
  onClose,
}: {
  workflowId: string;
  workflowName: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [roleCode, setRoleCode] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [search, setSearch] = useState("");
  const [queries, setQueries] = useState({ user: "", assignments: "" });
  const [page, setPage] = useState(0);
  const [hours, setHours] = useState("");
  const [error, setError] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setQueries({ user: userQuery, assignments: search }),
      250
    );
    return () => clearTimeout(timer);
  }, [userQuery, search]);
  const roles = trpc.workflow.customRoles.useQuery(
    { workflowId },
    { retry: false }
  );
  const assignments = trpc.workflow.customRoleAssignments.useQuery(
    { workflowId, page, query: queries.assignments },
    {
      retry: false,
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    }
  );
  const users = trpc.workflow.memberCandidates.useQuery(
    { workflowId, query: queries.user, selectedIds: userIds.map(Number) },
    { enabled: Boolean(queries.user.trim() || userIds.length), retry: false }
  );
  const grant = trpc.workflow.assignCustomRole.useMutation({ retry: false });
  const revoke = trpc.workflow.revokeCustomRole.useMutation({ retry: false });
  const validUser = Boolean(
    userIds[0] && users.data?.some(item => String(item.id) === userIds[0])
  );
  const expiryError = roleExpiryInput(hours).error;
  const validRole = Boolean(
    roles.isSuccess &&
      !roles.isFetching &&
      roles.data.some(
        role => role.code === roleCode && role.permissionLabels.length > 0
      )
  );
  async function refresh() {
    await Promise.all([
      utils.workflow.customRoleAssignments.invalidate({ workflowId }),
      utils.workflow.members.invalidate({ workflowId }),
      utils.workflow.access.invalidate({ id: workflowId }),
      utils.workflow.page.invalidate(),
      utils.workflow.get.invalidate({ id: workflowId }),
      utils.iam.userAuthorizationDetails.invalidate(),
      utils.iam.roleAuthorizationDetails.invalidate(),
    ]);
  }
  async function assign() {
    setError("");
    if (busy || !validUser || !validRole) {
      setError("请选择有效账号和自定义流程角色。");
      return;
    }
    const validity = roleExpiryInput(hours);
    if (validity.error) {
      setError(validity.error);
      return;
    }
    setBusy(true);
    try {
      await grant.mutateAsync({
        workflowId,
        userId: Number(userIds[0]),
        roleCode,
        expiresAt: validity.expiresAt,
      });
      await refresh();
      setUserIds([]);
      setUserQuery("");
      setPage(0);
    } catch (error) {
      setError(error instanceof Error ? error.message : "绑定失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function confirmRevoke() {
    if (!pendingRevoke) return;
    setBusy(true);
    setError("");
    try {
      await revoke.mutateAsync({ workflowId, assignmentId: pendingRevoke.id });
      await refresh();
      setPendingRevoke(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "撤销失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>自定义流程角色绑定</DialogTitle>
          <DialogDescription>
            授权仅作用于“{workflowName}
            ”，与内置协作角色同时生效。撤销一项绑定不会移除其他授权来源。
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="workflow-custom-role">流程角色</Label>
              <Button
                variant="outline"
                disabled={busy || roles.isFetching}
                onClick={() => void roles.refetch()}
              >
                刷新角色
              </Button>
            </div>
            <select
              id="workflow-custom-role"
              className="aiflow-type-control min-h-11 w-full rounded-md border border-border bg-background px-3"
              value={roleCode}
              disabled={busy || roles.isLoading || roles.isError}
              onChange={event => setRoleCode(event.target.value)}
            >
              <option value="">请选择自定义流程角色</option>
              {roles.data?.map(role => (
                <option
                  key={role.code}
                  value={role.code}
                  disabled={!role.permissionLabels.length}
                >
                  {role.name}（{role.code}）
                </option>
              ))}
            </select>
          </div>
          {roleCode && (
            <p className="aiflow-type-body rounded-md border border-border p-3">
              所选角色权限：
              {roles.data
                ?.find(role => role.code === roleCode)
                ?.permissionLabels.join("、") ||
                "当前没有可用于本流程的权限，请在角色中心维护。"}
            </p>
          )}
          {roles.isSuccess && !roles.data.length && (
            <p className="aiflow-type-body text-muted-foreground">
              暂无自定义流程角色，请由身份与权限管理员在角色中心创建。
            </p>
          )}
          {roles.isError && (
            <div role="alert">
              <p>角色读取失败。</p>
              <Button variant="outline" onClick={() => void roles.refetch()}>
                重试读取角色
              </Button>
            </div>
          )}
          <SearchableMultiSelect
            ariaLabel="绑定自定义流程角色的账号"
            value={userIds}
            options={(users.data ?? []).map(user => ({
              value: String(user.id),
              label: `${user.name || user.username}（${user.username}）`,
            }))}
            query={userQuery}
            onQueryChange={setUserQuery}
            onChange={setUserIds}
            placeholder="搜索并选择账号"
            searchPlaceholder="姓名或用户名"
            emptyMessage="没有可选账号"
            noResultsMessage="没有匹配的启用账号"
            startSearchMessage="输入姓名或用户名搜索"
            requireSearch
            maxSelected={1}
            maxResults={50}
            hasMore={(users.data?.length ?? 0) > 50}
            loading={users.isFetching}
            error={users.isError}
            disabled={busy}
          />
          <div className="space-y-2">
            <Label htmlFor="workflow-custom-role-hours">有效期（小时）</Label>
            <Input
              id="workflow-custom-role-hours"
              inputMode="numeric"
              aria-invalid={Boolean(expiryError)}
              aria-describedby={expiryError ? "workflow-custom-role-expiry-error" : undefined}
              value={hours}
              disabled={busy}
              onChange={event => setHours(event.target.value)}
              placeholder="留空表示长期有效"
            />
            {expiryError && <p id="workflow-custom-role-expiry-error" role="alert" className="text-sm text-destructive">{expiryError}</p>}
          </div>
          <Button
            disabled={
              busy ||
              !validUser ||
              !validRole ||
              Boolean(expiryError) ||
              roles.isLoading ||
              roles.isError
            }
            onClick={() => void assign()}
          >
            {busy ? "正在处理…" : "绑定到当前流程"}
          </Button>
        </section>
        {error && (
          <p role="alert" className="aiflow-type-body text-destructive">
            {error}
          </p>
        )}
        {pendingRevoke && (
          <div
            role="alert"
            className="space-y-3 rounded-md border border-border p-3"
          >
            <p className="aiflow-type-body">
              确认撤销 {pendingRevoke.name} 在当前流程的这项绑定？
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void confirmRevoke()}
              >
                确认撤销绑定
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setPendingRevoke(null)}
              >
                保留绑定
              </Button>
            </div>
          </div>
        )}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="aiflow-type-section-title font-semibold">
              绑定记录（{assignments.data?.total ?? 0}）
            </h3>
            <Button
              variant="outline"
              disabled={assignments.isFetching}
              onClick={() => void assignments.refetch()}
            >
              刷新绑定记录
            </Button>
          </div>
          <Input
            aria-label="搜索流程角色绑定"
            maxLength={100}
            placeholder="搜索姓名、用户名或角色"
            value={search}
            onChange={event => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
          {assignments.isLoading && <p>正在读取绑定记录…</p>}
          {assignments.isError && (
            <p role="alert">绑定记录读取失败，请刷新重试。</p>
          )}
          {assignments.data?.items.map(item => (
            <div
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <p className="aiflow-type-body break-words font-medium">
                  {item.name || item.username} · {item.roleName}
                </p>
                <p className="aiflow-type-meta break-all text-muted-foreground">
                  {item.username} · {item.roleCode}
                </p>
                <p className="aiflow-type-body text-muted-foreground">
                  {statusLabel[item.authorizationStatus] ??
                    item.authorizationStatus}{" "}
                  ·{" "}
                  {item.expiresAt
                    ? `有效至 ${time(item.expiresAt)}`
                    : "长期有效"}
                </p>
                {item.revokedAt && (
                  <p className="aiflow-type-meta text-muted-foreground">
                    撤销于 {time(item.revokedAt)}
                  </p>
                )}
              </div>
              {!item.revokedAt && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setPendingRevoke({
                      id: item.id,
                      name: `${item.name || item.username} · ${item.roleName}`,
                    })
                  }
                >
                  撤销绑定
                </Button>
              )}
            </div>
          ))}
          {assignments.isSuccess && !assignments.data.items.length && (
            <p className="aiflow-type-body text-muted-foreground">
              没有匹配的绑定记录。
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              disabled={page === 0 || assignments.isFetching}
              onClick={() => setPage(current => current - 1)}
            >
              上一页
            </Button>
            <span className="aiflow-type-meta">
              第 {page + 1} 页 · 每页 10 条
            </span>
            <Button
              variant="outline"
              disabled={
                (page + 1) * 10 >= (assignments.data?.total ?? 0) ||
                assignments.isFetching
              }
              onClick={() => setPage(current => current + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
