import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type Batch = inferRouterOutputs<AppRouter>["directoryImport"]["get"];
const operations = { create: "新增", update: "更新", unchanged: "相同" };
const states = {
  ready: "待应用",
  blocked: "预览冲突",
  applied: "已应用",
  conflict: "应用冲突",
  reverted: "已回退",
};
const example = {
  version: 1,
  users: [{ username: "sample_user", name: "示例成员" }],
  units: [{ code: "EXAMPLE", name: "示例部门" }],
  memberships: [
    { username: "sample_user", unitCode: "EXAMPLE", title: "成员" },
  ],
};
function downloadExample() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(example, null, 2)], {
      type: "application/json;charset=utf-8",
    })
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "内部目录导入模板.json";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DirectoryImportDialog({
  onClose,
  canApply,
  opener,
}: {
  onClose: () => void;
  canApply: boolean;
  opener: HTMLElement | null;
}) {
  const [batch, setBatch] = useState<Batch>();
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const history = trpc.directoryImport.list.useQuery();
  const utils = trpc.useUtils();
  const preview = trpc.directoryImport.preview.useMutation();
  const apply = trpc.directoryImport.applyRow.useMutation();
  const revert = trpc.directoryImport.revert.useMutation();
  const visible = history.isSuccess && !history.error ? batch : undefined;
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "目录操作未完成，请重新读取批次核对。"
      );
    } finally {
      setBusy(false);
    }
  }
  function openFile(file?: File) {
    if (!file) return;
    setPasswords({});
    void act(async () => {
      if (file.size > 256 * 1024) throw new Error("文件须小于或等于 256 KiB。");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer()
      );
      let manifest;
      try {
        manifest = JSON.parse(text);
      } catch {
        throw new Error(
          "文件不是有效的 UTF-8 JSON，请对照模板检查括号、引号与逗号。"
        );
      }
      const next = await preview.mutateAsync({ filename: file.name, manifest });
      setBatch(next);
      await history.refetch();
    });
  }
  function change(indices: number[], mode: "apply" | "revert") {
    if (!visible || !canApply) return;
    const id = visible.id;
    void act(async () => {
      for (const index of indices) {
        const record = visible.rows[index];
        const next =
          mode === "apply"
            ? await apply.mutateAsync({
                id,
                index,
                password: record.requiresPassword
                  ? passwords[record.key]
                  : undefined,
              })
            : await revert.mutateAsync({ id, index });
        setBatch(next);
        if (next.rows[index].state === "applied")
          setPasswords(values => {
            const copy = { ...values };
            delete copy[record.key];
            return copy;
          });
      }
      await Promise.all([
        utils.iam.userDirectory.invalidate(),
        utils.config.organizationDirectory.invalidate(),
        history.refetch(),
      ]);
    });
  }
  const ready =
    visible?.rows
      .map((r, i) => (r.state === "ready" ? i : -1))
      .filter(i => i >= 0) ?? [];
  const canApplyAll =
    ready.length > 0 &&
    ready.every(
      i =>
        !visible!.rows[i].requiresPassword || !!passwords[visible!.rows[i].key]
    );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        aria-busy={busy}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={e => {
          e.preventDefault();
          requestAnimationFrame(() => opener?.focus());
        }}
      >
        <DialogTitle>内部目录批量导入</DialogTitle>
        {busy && (
          <p role="status" className="text-sm">
            正在处理目录，请稍候…
          </p>
        )}
        <DialogDescription>
          上传账号、部门和成员关系的 UTF-8 JSON
          文件。先预览差异，再由身份管理员应用。未列出的对象会保留。
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={downloadExample}>
            下载目录模板
          </Button>
          <label className="grid gap-1 text-sm">
            上传目录文件
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={e => {
                openFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {history.isError ? (
          <p role="alert">
            目录权限或读取状态已变化。
            <Button variant="outline" onClick={() => void history.refetch()}>
              重新读取
            </Button>
          </p>
        ) : (
          <label className="grid gap-1 text-sm">
            历史批次
            <select
              className="min-h-10 rounded border bg-background px-2"
              disabled={busy}
              value={visible?.id ?? ""}
              onChange={e => {
                const id = e.target.value;
                setPasswords({});
                setBatch(undefined);
                if (id)
                  void act(async () =>
                    setBatch(
                      await utils.directoryImport.get.fetch(
                        { id },
                        { staleTime: 0 }
                      )
                    )
                  );
              }}
            >
              <option value="">选择批次</option>
              {history.data?.map(b => (
                <option key={b.id} value={b.id}>
                  {b.filename} · {new Date(b.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {visible && (
          <section aria-label="目录差异" className="grid gap-3">
            <p role="status" className="break-all text-sm">
              {visible.filename} · {visible.rows.length} 行 · {ready.length}{" "}
              行待应用
            </p>
            {canApply && (
              <Button
                className="w-fit"
                disabled={busy || !canApplyAll}
                onClick={() => change(ready, "apply")}
              >
                应用全部就绪行
              </Button>
            )}
            <ol className="grid gap-2">
              {visible.rows.map((r, i) => (
                <li key={i} className="grid gap-1 rounded border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-1">
                    <strong className="break-all">{r.key}</strong>
                    <span>
                      {operations[r.action]} · {states[r.state]}
                    </span>
                  </div>
                  <div className="break-words">
                    {r.before
                      ? "原值　" +
                        [
                          r.before.name,
                          r.before.email,
                          r.before.title,
                          r.before.parentCode,
                        ]
                          .filter(Boolean)
                          .join(" / ")
                      : "原目录无此对象"}
                  </div>
                  <div className="break-words">
                    导入值　
                    {r.record.kind === "membership"
                      ? (r.record.title ?? "保留原岗位")
                      : r.record.name}
                    {r.record.kind === "user" &&
                      r.record.email &&
                      " / " + r.record.email}
                    {r.record.kind === "unit" &&
                      r.record.parentCode &&
                      " / 上级 " + r.record.parentCode}
                  </div>
                  {r.message && <p className="text-destructive">{r.message}</p>}
                  {canApply && r.state === "ready" && (
                    <div className="flex flex-wrap items-end gap-2">
                      {r.requiresPassword && (
                        <label className="grid gap-1">
                          初始口令 · {r.key}
                          <input
                            className="min-h-9 rounded border px-2"
                            type="password"
                            autoComplete="new-password"
                            value={passwords[r.key] ?? ""}
                            disabled={busy}
                            onChange={e =>
                              setPasswords(v => ({
                                ...v,
                                [r.key]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                      <Button
                        variant="outline"
                        disabled={
                          busy || (r.requiresPassword && !passwords[r.key])
                        }
                        onClick={() => change([i], "apply")}
                      >
                        应用此行
                      </Button>
                    </div>
                  )}
                  {canApply && r.state === "applied" && (
                    <Button
                      className="w-fit"
                      variant="outline"
                      disabled={busy}
                      onClick={() => change([i], "revert")}
                    >
                      回退此行
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
