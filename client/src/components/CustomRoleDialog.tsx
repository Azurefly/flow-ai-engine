import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { validateCustomRoleDraft } from "@shared/custom-role-form";
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

type Role = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  scope: "system" | "workflow";
  isSystem: number | boolean;
  permissions: unknown;
};
function readPermissions(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((code): code is string => typeof code === "string")
    : [];
}
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
    role ? readPermissions(role.permissions) : []
  );
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
  async function submit() {
    setError("");
    setSaving(true);
    try {
      if (mode !== "create" && (!role || Boolean(Number(role.isSystem))))
        throw new Error("内置角色不可修改或删除。");
      if (mode === "delete") {
        if (confirmation !== role!.code)
          throw new Error("请输入完整角色编码确认删除。");
        await remove.mutateAsync({ code: role!.code });
        await onSaved();
      } else {
        const draft = validateCustomRoleDraft(
          { code, name, description, scope, permissions },
          options.map(item => item.code)
        );
        const selected = options
          .filter(item => draft.permissions.includes(item.code))
          .map(item => item.code);
        if (mode === "create")
          await create.mutateAsync({ ...draft, permissions: selected });
        else
          await update.mutateAsync({
            code: draft.code,
            name: draft.name,
            description: draft.description || null,
            permissions: selected,
          });
        await onSaved(draft.code);
      }
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "角色保存失败，请重试。"
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "新增自定义角色"
              : mode === "edit"
                ? "编辑自定义角色"
                : "删除自定义角色"}
          </DialogTitle>
          <DialogDescription>
            {mode === "delete"
              ? "删除不可恢复。仍有直接授权或组织绑定的角色会被拒绝删除，请先解除绑定。"
              : "维护角色名称、适用范围和权限。创建角色后，再为用户或流程绑定。"}
          </DialogDescription>
        </DialogHeader>
        {mode === "delete" ? (
          <div className="space-y-3">
            <p className="aiflow-type-body">
              {role?.name} · <code>{role?.code}</code>
            </p>
            <Label htmlFor="role-delete-confirm">输入角色编码确认</Label>
            <Input
              id="role-delete-confirm"
              value={confirmation}
              disabled={saving}
              onChange={event => setConfirmation(event.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="custom-role-code">角色编码</Label>
                <Input
                  id="custom-role-code"
                  value={code}
                  disabled={saving || mode === "edit"}
                  maxLength={68}
                  onChange={event => setCode(event.target.value)}
                />
                <p className="aiflow-type-meta text-muted-foreground">
                  以 custom_ 开头；创建后不可修改。
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-role-name">角色名称</Label>
                <Input
                  id="custom-role-name"
                  value={name}
                  disabled={saving}
                  maxLength={120}
                  onChange={event => setName(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="custom-role-scope">适用范围</Label>
              <select
                id="custom-role-scope"
                className="aiflow-type-control min-h-11 w-full rounded-md border border-border bg-background px-3"
                value={scope}
                disabled={saving || mode === "edit"}
                onChange={event => {
                  const next = event.target.value as "system" | "workflow";
                  setScope(next);
                  if (next === "workflow")
                    setPermissions(current =>
                      current.filter(code =>
                        catalog.data?.some(
                          item => item.code === code && item.workflowAllowed
                        )
                      )
                    );
                }}
              >
                <option value="system">系统角色</option>
                <option value="workflow">流程角色</option>
              </select>
              <p className="aiflow-type-body text-muted-foreground">
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
                disabled={saving}
                maxLength={2000}
                onChange={event => setDescription(event.target.value)}
              />
            </div>
            <fieldset disabled={saving} className="space-y-2">
              <legend className="aiflow-type-body mb-2 font-medium">
                权限（已选 {permissions.length} 项）
              </legend>
              {catalog.isLoading && <p>正在读取权限清单…</p>}
              {catalog.isError && (
                <div role="alert">
                  <p>权限清单读取失败，请重试。</p>
                  <Button
                    variant="outline"
                    onClick={() => void catalog.refetch()}
                  >
                    重试读取权限
                  </Button>
                </div>
              )}
              {permissions.some(
                code => !options.some(item => item.code === code)
              ) &&
                catalog.isSuccess && (
                  <div className="aiflow-type-body rounded-md border border-border p-3">
                    <p>
                      已有权限中存在当前范围不适用的项，请确认后移除：
                      {permissions
                        .filter(
                          code => !options.some(item => item.code === code)
                        )
                        .join("、")}
                    </p>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        setPermissions(current =>
                          current.filter(code =>
                            options.some(item => item.code === code)
                          )
                        )
                      }
                    >
                      移除不适用权限
                    </Button>
                  </div>
                )}
              {!permissions.includes("workflow:view") &&
                permissions.some(code =>
                  [
                    "workflow:edit",
                    "workflow:publish",
                    "workflow:run",
                    "workflow:members:manage",
                  ].includes(code)
                ) && (
                  <div className="aiflow-type-body rounded-md border border-border p-3">
                    <p>
                      此角色未包含查看流程。用户还需从其他授权获得查看权限，才能在流程页面使用这些功能。
                    </p>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        setPermissions(current => [...current, "workflow:view"])
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
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0"
                      checked={permissions.includes(item.code)}
                      onChange={event =>
                        setPermissions(current =>
                          event.target.checked
                            ? Array.from(new Set([...current, item.code]))
                            : current.filter(code => code !== item.code)
                        )
                      }
                    />
                    <span>
                      <span className="aiflow-type-body block font-medium">
                        {item.name}
                      </span>
                      <span className="aiflow-type-meta block text-muted-foreground">
                        {item.description}
                      </span>
                      <code className="aiflow-type-meta block text-muted-foreground">
                        {item.code}
                      </code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {mode === "edit" && (
              <p className="aiflow-type-body text-aiflow-warning">
                权限修改将影响此角色的所有现有绑定，请确认后保存。
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="aiflow-type-body text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={
              saving ||
              (mode === "delete"
                ? confirmation !== role?.code
                : catalog.isLoading || catalog.isError || !permissions.length)
            }
            onClick={() => void submit()}
          >
            {saving ? "正在保存…" : mode === "delete" ? "确认删除" : "保存角色"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
