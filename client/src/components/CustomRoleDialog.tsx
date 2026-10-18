import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  validateCustomRoleDraft,
  type CustomRoleDraft,
} from "@shared/custom-role-form";
import {
  customRoleDraftKey,
  CUSTOM_ROLE_PRESETS,
} from "@shared/custom-role-editor";
import { readRolePermissionCodes } from "@shared/role-permission-codes";
import {
  consoleNavigationEvent,
  type ConsoleNavigationEvent,
} from "@/lib/console-navigation-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

type Role = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  scope: "system" | "workflow";
  isSystem: number | boolean;
  permissions: unknown;
};
type DiscardAction = {
  kind: "close" | "reload" | "navigate";
  proceed?: () => void;
};

export default function CustomRoleDialog({
  mode,
  role,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit" | "delete";
  role?: Role;
  onClose: () => void;
  onSaved: (code?: string) => Promise<void>;
}) {
  const utils = trpc.useUtils();
  const [code, setCode] = useState(
    () =>
      role?.code ??
      `custom_role_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  );
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [scope, setScope] = useState<"system" | "workflow">(
    role?.scope ?? "system"
  );
  const [permissions, setPermissions] = useState(() =>
    readRolePermissionCodes(role?.permissions)
  );
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [initialized, setInitialized] = useState(mode === "create");
  const [baseToken, setBaseToken] = useState("");
  const [showCodes, setShowCodes] = useState(false);
  const [discard, setDiscard] = useState<DiscardAction | null>(null);
  const [committed, setCommitted] = useState<{ code?: string } | null>(null);
  const workingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const draft: CustomRoleDraft = {
    code,
    name,
    description,
    scope,
    permissions,
  };
  const initial = useRef(customRoleDraftKey(draft));
  const dirty =
    mode !== "delete" &&
    !committed &&
    customRoleDraftKey(draft) !== initial.current;
  const busy = saving || refreshing;
  const configuration = trpc.iam.customRoleConfiguration.useQuery(
    { code: role?.code ?? "" },
    {
      enabled: mode !== "create" && !initialized,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    }
  );
  const catalog = trpc.iam.permissionCatalog.useQuery(undefined, {
    enabled: mode !== "delete",
    retry: false,
  });
  const create = trpc.iam.createCustomRole.useMutation({ retry: false });
  const update = trpc.iam.updateCustomRole.useMutation({ retry: false });
  const remove = trpc.iam.deleteCustomRole.useMutation({ retry: false });
  const options = (catalog.data ?? []).filter(
    item => scope === "system" || item.workflowAllowed
  );
  const allowed: string[] = options.map(item => item.code);

  function applyLatest(latest: NonNullable<typeof configuration.data>) {
    if (!role || latest.id !== Number(role.id))
      throw new Error(
        "原角色已被删除或重新创建。当前填写已保留，请关闭窗口后重新选择角色。"
      );
    const next: CustomRoleDraft = {
      code: latest.code,
      name: latest.name,
      description: latest.description ?? "",
      scope: latest.scope,
      permissions: latest.permissions,
    };
    setCode(next.code);
    setName(next.name);
    setDescription(next.description);
    setScope(next.scope);
    setPermissions(next.permissions);
    setBaseToken(latest.configToken);
    initial.current = customRoleDraftKey(next);
    setInitialized(true);
    setConfirmation("");
    setConflict(false);
    setError("");
  }
  useEffect(() => {
    if (!initialized && configuration.isSuccess && !configuration.isFetching) {
      try {
        applyLatest(configuration.data);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "读取角色失败。");
      }
    }
  }, [
    initialized,
    configuration.isSuccess,
    configuration.isFetching,
    configuration.data,
  ]);
  useEffect(() => {
    if (initialized)
      (mode === "delete" ? confirmationRef : nameRef).current?.focus();
  }, [initialized, mode]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const preventNavigation = (event: Event) => {
      event.preventDefault();
      if (!busy)
        setDiscard({
          kind: "navigate",
          proceed: (event as ConsoleNavigationEvent).detail.proceed,
        });
    };
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener(consoleNavigationEvent, preventNavigation);
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener(consoleNavigationEvent, preventNavigation);
    };
  }, [dirty, busy]);

  function requestClose() {
    if (workingRef.current || busy) return;
    if (dirty) setDiscard({ kind: "close" });
    else onClose();
  }
  async function readLatest() {
    if (!role || workingRef.current) return;
    workingRef.current = true;
    setRefreshing(true);
    try {
      applyLatest(
        await utils.iam.customRoleConfiguration.fetch(
          { code: role.code },
          { staleTime: 0 }
        )
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "读取最新配置失败，当前填写已保留。"
      );
    } finally {
      workingRef.current = false;
      setRefreshing(false);
    }
  }
  function requestLatest() {
    if (dirty) setDiscard({ kind: "reload" });
    else void readLatest();
  }
  function exportDraft() {
    const blob = new Blob([JSON.stringify(draft, null, 2) + "\n"], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${code}-draft.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function submit() {
    if (workingRef.current || !initialized || (mode !== "create" && !baseToken))
      return;
    workingRef.current = true;
    setError("");
    setSaving(true);
    let result = committed;
    try {
      if (!result) {
        if (mode !== "create" && (!role || Boolean(Number(role.isSystem))))
          throw new Error("内置角色不可修改或删除。");
        if (conflict) throw new Error("请先读取最新配置，当前填写内容已保留。");
        if (mode === "delete") {
          if (confirmation !== role!.code)
            throw new Error("请输入完整角色编码确认删除。");
          await remove.mutateAsync({
            code: role!.code,
            expectedConfigToken: baseToken,
          });
          result = {};
        } else {
          const validated = validateCustomRoleDraft(draft, allowed);
          const selected = options
            .filter(item => validated.permissions.includes(item.code))
            .map(item => item.code);
          if (mode === "create")
            await create.mutateAsync({ ...validated, permissions: selected });
          else
            await update.mutateAsync({
              code: validated.code,
              name: validated.name,
              description: validated.description || null,
              permissions: selected,
              expectedConfigToken: baseToken,
            });
          result = { code: validated.code };
        }
        setCommitted(result);
      }
      await onSaved(result.code);
      onClose();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "角色保存失败，请重试。";
      if (result)
        setError(
          "角色操作已完成，但列表刷新失败。请重试刷新列表，不会重复提交角色操作。"
        );
      else {
        setError(message);
        if (
          (failure as { data?: { code?: string } })?.data?.code === "CONFLICT"
        )
          setConflict(true);
      }
    } finally {
      workingRef.current = false;
      setSaving(false);
    }
  }
  const title =
    mode === "create"
      ? "新增自定义角色"
      : mode === "edit"
        ? "编辑自定义角色"
        : "删除自定义角色";
  const disabled = busy || !initialized || Boolean(committed);
  const saveDisabled =
    busy ||
    !initialized ||
    (!committed &&
      (conflict ||
        (mode !== "create" && !baseToken) ||
        (mode === "delete"
          ? confirmation !== role?.code
          : !catalog.isSuccess || !permissions.length)));

  return (
    <>
      <Dialog
        open
        onOpenChange={open => {
          if (!open) requestClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-1rem)] min-h-0 max-w-2xl flex-col overflow-hidden p-4 sm:p-5"
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={event => {
              event.preventDefault();
              if (!saveDisabled) void submit();
            }}
          >
            <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-3 text-left">
              <div className="min-w-0">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription className="mt-2">
                  {mode === "delete"
                    ? "删除不可恢复。仍有直接授权或组织绑定的角色会被拒绝删除，请先解除绑定。"
                    : "选择角色范围和权限，保存后再绑定人员。修改已有角色会影响它的所有绑定。"}
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭"
                disabled={busy}
                className="h-11 w-11 shrink-0"
                onClick={requestClose}
              >
                ×
              </Button>
            </DialogHeader>
            <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
              {mode !== "create" && !initialized && (
                <div
                  className="rounded-lg border border-border bg-muted p-3"
                  role={configuration.isError ? "alert" : "status"}
                >
                  <p>
                    {configuration.isError
                      ? configuration.error.message
                      : "正在读取最新角色配置…"}
                  </p>
                  {configuration.isError && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void readLatest()}
                    >
                      重新读取角色
                    </Button>
                  )}
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="space-y-2 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-3 text-aiflow-warning"
                >
                  <p className="break-words">{error}</p>
                  {!committed && (
                    <p className="aiflow-type-body">当前填写内容已保留。</p>
                  )}
                  {conflict && (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={exportDraft}
                      >
                        导出当前填写
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={requestLatest}
                      >
                        读取最新配置
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <fieldset disabled={disabled} className="min-w-0 space-y-4">
                {mode === "delete" ? (
                  <div className="space-y-3">
                    <p className="aiflow-type-body break-words">
                      {name} · <code>{code}</code>
                    </p>
                    <Label htmlFor="role-delete-confirm">
                      输入角色编码确认
                    </Label>
                    <Input
                      ref={confirmationRef}
                      id="role-delete-confirm"
                      value={confirmation}
                      onChange={event => setConfirmation(event.target.value)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="custom-role-name">角色名称</Label>
                        <Input
                          ref={nameRef}
                          id="custom-role-name"
                          value={name}
                          maxLength={120}
                          required
                          onChange={event => setName(event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="custom-role-code">角色编码</Label>
                        <Input
                          id="custom-role-code"
                          value={code}
                          disabled={mode === "edit"}
                          maxLength={64}
                          required
                          onChange={event => setCode(event.target.value)}
                        />
                        <p className="aiflow-type-meta text-muted-foreground">
                          以 custom_ 开头，最多 64 位；创建后不可修改。
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-role-scope">适用范围</Label>
                      <select
                        id="custom-role-scope"
                        className="aiflow-type-control min-h-11 w-full rounded-md border border-border bg-background px-3"
                        value={scope}
                        disabled={mode === "edit"}
                        onChange={event => {
                          const next = event.target.value as
                            | "system"
                            | "workflow";
                          setScope(next);
                          if (next === "workflow")
                            setPermissions(current =>
                              current.filter(value =>
                                catalog.data?.some(
                                  item =>
                                    item.code === value && item.workflowAllowed
                                )
                              )
                            );
                        }}
                      >
                        <option value="system">系统角色</option>
                        <option value="workflow">流程角色</option>
                      </select>
                      <p className="aiflow-type-body rounded-lg border border-border bg-muted p-3 text-muted-foreground">
                        {scope === "system"
                          ? "可直接绑定用户或通过组织继承。选择的流程权限对所有流程生效；仅授权一个流程请选流程角色。"
                          : "需在具体流程的成员权限中绑定，权限仅作用于指定流程。"}{" "}
                        范围创建后不可修改。
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-role-description">角色说明</Label>
                      <textarea
                        id="custom-role-description"
                        className="aiflow-type-body min-h-20 w-full rounded-md border border-border bg-background p-3"
                        value={description}
                        maxLength={2000}
                        onChange={event => setDescription(event.target.value)}
                      />
                    </div>
                    <fieldset className="min-w-0 space-y-3">
                      <legend className="aiflow-type-body mb-2 font-semibold">
                        权限（已选 {permissions.length} 项）
                      </legend>
                      {catalog.isLoading && <p>正在读取权限清单…</p>}
                      {catalog.isError && (
                        <div role="alert">
                          <p>权限清单读取失败，请重试。</p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void catalog.refetch()}
                          >
                            重试读取权限
                          </Button>
                        </div>
                      )}
                      <div className="space-y-2 rounded-lg border border-border bg-muted/60 p-3">
                        <p className="aiflow-type-control font-medium">
                          常用权限组合
                        </p>
                        <p className="aiflow-type-meta text-muted-foreground">
                          点击后替换当前勾选，保存前可继续调整。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {CUSTOM_ROLE_PRESETS.filter(preset =>
                            preset.permissions.every(value =>
                              allowed.includes(value)
                            )
                          ).map(preset => (
                            <Button
                              key={preset.label}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setPermissions([...preset.permissions])
                              }
                            >
                              {preset.label}
                            </Button>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPermissions([])}
                          >
                            清空勾选
                          </Button>
                        </div>
                      </div>
                      {permissions.some(
                        value => !options.some(item => item.code === value)
                      ) &&
                        catalog.isSuccess && (
                          <div className="rounded-md border border-border p-3">
                            <p>
                              已有权限中存在当前范围不适用的项，请确认后移除：
                              {permissions
                                .filter(value => !allowed.includes(value))
                                .join("、")}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                setPermissions(current =>
                                  current.filter(value =>
                                    allowed.includes(value)
                                  )
                                )
                              }
                            >
                              移除不适用权限
                            </Button>
                          </div>
                        )}
                      {!permissions.includes("workflow:view") &&
                        permissions.some(value =>
                          [
                            "workflow:edit",
                            "workflow:publish",
                            "workflow:run",
                            "workflow:members:manage",
                          ].includes(value)
                        ) && (
                          <div className="rounded-md border border-border p-3">
                            <p>
                              此角色未包含查看流程。用户还需从其他授权获得查看权限，才能在流程页面使用这些功能。
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                setPermissions(current => [
                                  ...current,
                                  "workflow:view",
                                ])
                              }
                            >
                              同时加入查看流程
                            </Button>
                          </div>
                        )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {options.map(item => (
                          <label
                            key={item.code}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${permissions.includes(item.code) ? "border-aiflow-info-border bg-aiflow-info-surface" : "border-border bg-card"}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 size-4 shrink-0"
                              checked={permissions.includes(item.code)}
                              onChange={event =>
                                setPermissions(current =>
                                  event.target.checked
                                    ? Array.from(
                                        new Set([...current, item.code])
                                      )
                                    : current.filter(
                                        value => value !== item.code
                                      )
                                )
                              }
                            />
                            <span className="min-w-0">
                              <span className="aiflow-type-body block font-medium">
                                {item.name}
                              </span>
                              <span className="aiflow-type-meta block text-muted-foreground">
                                {item.description}
                              </span>
                              {showCodes && (
                                <code className="aiflow-type-meta block break-all text-muted-foreground">
                                  {item.code}
                                </code>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                      <label className="aiflow-type-control flex min-h-11 items-center gap-2 text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={showCodes}
                          onChange={event => setShowCodes(event.target.checked)}
                        />
                        显示权限标识
                      </label>
                    </fieldset>
                  </>
                )}
              </fieldset>
            </div>
            <DialogFooter className="mt-4 shrink-0 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={requestClose}
              >
                {committed ? "关闭" : "取消"}
              </Button>
              <Button
                type="submit"
                variant={
                  mode === "delete" && !committed ? "destructive" : "default"
                }
                disabled={saveDisabled}
              >
                {saving
                  ? "正在保存…"
                  : refreshing
                    ? "正在读取…"
                    : committed
                      ? "重试刷新列表"
                      : mode === "delete"
                        ? "确认删除"
                        : "保存角色"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(discard)}
        onOpenChange={open => {
          if (!open) setDiscard(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {discard?.kind === "reload"
              ? "读取最新配置前保留修改"
              : "关闭前保留角色修改"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {discard?.kind === "reload"
              ? "读取最新配置会替换当前填写。可以先导出草稿，再重新核对权限。"
              : "当前角色有未保存的修改。继续编辑，或明确丢弃后离开。"}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = discard;
                setDiscard(null);
                if (action?.kind === "reload") void readLatest();
                else {
                  onClose();
                  action?.proceed?.();
                }
              }}
            >
              {discard?.kind === "reload"
                ? "丢弃当前修改并读取最新角色"
                : "丢弃修改并关闭"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
