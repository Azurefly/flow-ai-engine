import { useLayoutEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  consoleNavigationEvent,
  type ConsoleNavigationEvent,
} from "@/lib/console-navigation-guard";
import {
  createSettingsDraft,
  settingChangeLabel,
  settingsDraftDiff,
  settingsDraftFields,
  settingsDraftPayload,
  SETTINGS_LABELS,
  type SettingsDraft,
  type SettingsForm,
  type SettingsKey,
} from "@shared/system-settings-draft";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

const keys: SettingsKey[] = ["general", "approval"];
type DiscardAction = {
  kind: "discard" | "leave" | "reload";
  key?: SettingsKey;
  proceed?: () => void;
};

/** Remains mounted across configuration categories, retaining both independent drafts. */
export default function SystemSettingsEditor({
  activeKey,
  onSelectKey,
}: {
  activeKey: SettingsKey | null;
  onSelectKey: (key: SettingsKey) => void;
}) {
  const utils = trpc.useUtils();
  const settings = trpc.config.settings.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const mutation = trpc.config.updateSetting.useMutation({ retry: false });
  const [entries, setEntries] = useState<
    Partial<Record<SettingsKey, SettingsDraft>>
  >({});
  const [busyKey, setBusyKey] = useState<SettingsKey | null>(null);
  const [committed, setCommitted] = useState<SettingsKey | null>(null);
  const [error, setError] = useState<{
    key: SettingsKey;
    message: string;
  } | null>(null);
  const [conflicts, setConflicts] = useState<
    Partial<Record<SettingsKey, boolean>>
  >({});
  const [showDiff, setShowDiff] = useState(false);
  const [discard, setDiscard] = useState<DiscardAction | null>(null);
  const working = useRef(false);
  const modalOrigin = useRef<HTMLElement | null>(null);
  const busy = Boolean(busyKey);
  function draftFor(key: SettingsKey) {
    const existing = entries[key];
    const value = settings.data?.[key];
    const token = settings.data?.configTokens?.[key];
    if (existing && (settingsDraftDiff(existing).length || busy || committed))
      return existing;
    return value && token ? createSettingsDraft(key, value, token) : existing;
  }
  const dirtyKeys = keys.filter(key => {
    const entry = draftFor(key);
    return entry && settingsDraftDiff(entry).length;
  });
  const changes = dirtyKeys.flatMap(key =>
    settingsDraftDiff(draftFor(key)!).map(change => ({ ...change, key }))
  );
  const draft = activeKey ? draftFor(activeKey) : undefined;
  const currentToken = activeKey
    ? settings.data?.configTokens?.[activeKey]
    : undefined;
  const conflict = Boolean(
    activeKey &&
      (conflicts[activeKey] ||
        (draft &&
          currentToken &&
          draft.token !== currentToken &&
          settingsDraftDiff(draft).length))
  );
  const changed = Boolean(draft && settingsDraftDiff(draft).length);
  const canSave = Boolean(
    activeKey &&
      changed &&
      settings.isSuccess &&
      !settings.isFetching &&
      !conflict &&
      !busy &&
      !committed
  );
  function rememberFocus() {
    modalOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  function requestDiscard(action: DiscardAction) {
    if (working.current) return;
    rememberFocus();
    setDiscard(action);
  }
  function restoreFormFocus(key: SettingsKey | null) {
    if (!key) return;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        document
          .querySelector<HTMLElement>(
            `#system-settings-${key} input:not(:disabled), #system-settings-${key} select:not(:disabled)`
          )
          ?.focus({ preventScroll: true });
    });
  }
  function restoreModalFocus(event: Event) {
    event.preventDefault();
    const origin = modalOrigin.current;
    if (
      origin &&
      origin !== document.body &&
      origin.isConnected &&
      !origin.matches(":disabled")
    )
      origin.focus({ preventScroll: true });
    else if (!working.current) restoreFormFocus(activeKey);
  }

  useLayoutEffect(() => {
    if (!changes.length && !busy) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: Event) => {
      event.preventDefault();
      if (!working.current)
        requestDiscard({
          kind: "leave",
          proceed: (event as ConsoleNavigationEvent).detail.proceed,
        });
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(consoleNavigationEvent, navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(consoleNavigationEvent, navigate);
    };
  }, [Boolean(changes.length), busy]);

  function edit(patch: Partial<SettingsForm>) {
    if (!activeKey || !draft || working.current || committed) return;
    setEntries(current => ({
      ...current,
      [activeKey]: { ...draft, form: { ...draft.form, ...patch } },
    }));
    if (error?.key === activeKey && !conflicts[activeKey]) setError(null);
  }
  function exportDrafts() {
    const values = dirtyKeys.map(key => {
      const entry = draftFor(key)!;
      return {
        key,
        values: settingsDraftFields(entry),
        changes: settingsDraftDiff(entry),
      };
    });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ drafts: values }, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "flow-settings-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refreshSaved(key: SettingsKey) {
    await Promise.all([
      utils.config.settings.fetch(undefined, { staleTime: 0 }),
      utils.config.publicGeneral.invalidate(),
    ]);
    setCommitted(null);
    setError(null);
    toast.success(`${SETTINGS_LABELS[key]}已保存。`);
  }
  async function save() {
    if (working.current) return;
    const key = committed ?? activeKey;
    if (!key || (!committed && !canSave)) return;
    const current = draftFor(key);
    if (!current) return;
    let acknowledged = Boolean(committed);
    working.current = true;
    setBusyKey(key);
    setError(null);
    try {
      if (!acknowledged) {
        const result = await mutation.mutateAsync({
          key,
          value: settingsDraftPayload(current),
          expectedConfigToken: current.token,
        });
        acknowledged = true;
        setEntries(values => ({
          ...values,
          [key]: createSettingsDraft(key, result.value, result.configToken),
        }));
        setCommitted(key);
      }
      await refreshSaved(key);
    } catch (failure) {
      if (acknowledged)
        setError({
          key,
          message: "配置已保存，但刷新失败。请重试刷新，不会重复提交配置。",
        });
      else {
        setError({
          key,
          message:
            failure instanceof Error
              ? failure.message
              : "配置未保存，当前填写已保留。",
        });
        if (
          (failure as { data?: { code?: string } })?.data?.code === "CONFLICT"
        )
          setConflicts(current => ({ ...current, [key]: true }));
      }
    } finally {
      working.current = false;
      setBusyKey(null);
      restoreFormFocus(key);
    }
  }
  async function reload(key: SettingsKey) {
    if (working.current) return;
    working.current = true;
    setBusyKey(key);
    try {
      const latest = await utils.config.settings.fetch(undefined, {
        staleTime: 0,
      });
      if (!latest[key] || !latest.configTokens[key])
        throw new Error("配置读取不完整，当前填写已保留。");
      setEntries(current => ({
        ...current,
        [key]: createSettingsDraft(key, latest[key], latest.configTokens[key]),
      }));
      setConflicts(current => ({ ...current, [key]: false }));
      setError(null);
    } catch (failure) {
      setError({
        key,
        message:
          failure instanceof Error
            ? failure.message
            : "读取失败，当前填写已保留。",
      });
    } finally {
      working.current = false;
      setBusyKey(null);
      restoreFormFocus(key);
    }
  }
  const visibleBar = changes.length > 0 || busy || committed;
  const otherDirty = dirtyKeys.find(key => key !== activeKey);

  return (
    <>
      {activeKey && (
        <div
          data-system-settings-editor=""
          className={visibleBar ? "pb-80 sm:pb-52" : ""}
        >
          <header className="space-y-2 border-b border-border pb-5">
            <h1
              data-aiflow-page-title=""
              className="aiflow-type-page-title font-semibold"
            >
              {SETTINGS_LABELS[activeKey]}
            </h1>
            <p className="aiflow-type-body max-w-2xl text-muted-foreground">
              {activeKey === "general"
                ? "设置平台名称和系统水印。切换配置分类会保留填写，保存后才对其他页面生效。"
                : "配置项目流程发布前的审核要求与复核规则。改动保存后，由服务端执行发布门禁。"}
            </p>
          </header>
          {settings.isLoading && !draft && (
            <p role="status" className="py-6 text-muted-foreground">
              正在读取配置，读取完成前无法保存。
            </p>
          )}
          {settings.isError && !committed && (
            <div
              role="alert"
              className="mt-4 space-y-2 rounded-xl border border-aiflow-warning-border bg-aiflow-warning-surface p-4 text-aiflow-warning"
            >
              <p>配置读取失败，当前填写已保留。读取成功前无法保存。</p>
              <Button
                variant="outline"
                disabled={busy || settings.isFetching}
                onClick={() => void settings.refetch()}
              >
                重试读取配置
              </Button>
            </div>
          )}
          {settings.isSuccess && !draft && (
            <p role="alert" className="py-6 text-aiflow-danger">
              配置读取不完整，请重新读取后继续。
              <Button variant="outline" onClick={() => void settings.refetch()}>
                重新读取配置
              </Button>
            </p>
          )}
          {!committed && (error?.key === activeKey || conflict) && (
            <div
              role="alert"
              className="mt-4 space-y-3 rounded-xl border border-aiflow-warning-border bg-aiflow-warning-surface p-4 text-aiflow-warning"
            >
              <p>
                {error?.key === activeKey
                  ? error.message
                  : "该配置已有其他管理员的更新，当前填写已保留。请先导出填写内容，再读取最新配置核对。"}
              </p>
              {conflict && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={exportDrafts}
                  >
                    导出填写内容
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      changed
                        ? requestDiscard({ kind: "reload", key: activeKey })
                        : void reload(activeKey)
                    }
                  >
                    读取最新配置
                  </Button>
                </div>
              )}
            </div>
          )}
          {draft && (
            <form
              id={`system-settings-${activeKey}`}
              className="mt-6"
              onSubmit={event => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset
                disabled={busy || Boolean(committed)}
                className="grid min-w-0 gap-5 rounded-2xl border border-border bg-card p-5"
              >
                {activeKey === "general" ? (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="grid content-start gap-2 text-sm font-medium">
                      平台名称
                      <Input
                        className="h-11"
                        required
                        maxLength={120}
                        value={draft.form.platformName}
                        onChange={event =>
                          edit({ platformName: event.target.value })
                        }
                      />
                    </label>
                    <div className="grid content-start gap-4">
                      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={draft.form.watermarkEnabled}
                          onChange={event =>
                            edit({ watermarkEnabled: event.target.checked })
                          }
                        />
                        启用系统水印
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        水印文字
                        <Input
                          className="h-11"
                          maxLength={120}
                          disabled={!draft.form.watermarkEnabled}
                          required={draft.form.watermarkEnabled}
                          value={draft.form.watermarkText}
                          onChange={event =>
                            edit({ watermarkText: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-3 rounded-xl bg-muted/60 p-4">
                      <h2 className="aiflow-type-section-title font-semibold">
                        项目流程发布审批
                      </h2>
                      <p className="aiflow-type-body text-muted-foreground">
                        要求审核时，流程需通过审核才可发布。独立复核要求由其他有权审核的人员处理，设计所有人不能自审。
                      </p>
                    </div>
                    <div className="grid content-start gap-4">
                      <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={draft.form.requireProjectApproval}
                          onChange={event =>
                            edit({
                              requireProjectApproval: event.target.checked,
                            })
                          }
                        />
                        要求审核通过后发布
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        审核人隔离策略
                        <select
                          value={draft.form.reviewerMode}
                          onChange={event =>
                            edit({
                              reviewerMode:
                                event.target.value === "independent_reviewer"
                                  ? "independent_reviewer"
                                  : "project_owner_or_admin",
                            })
                          }
                          className="min-h-11 min-w-0 rounded-xl border border-border bg-card px-3"
                        >
                          <option value="project_owner_or_admin">
                            项目所有者或系统管理员
                          </option>
                          <option value="independent_reviewer">
                            独立复核（设计所有人不可自审）
                          </option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </fieldset>
              <p
                role="status"
                className="aiflow-type-meta mt-4 flex items-center gap-2 text-muted-foreground"
              >
                <CheckCircle2 size={15} />
                {changed
                  ? `有 ${settingsDraftDiff(draft).length} 项未保存修改`
                  : "当前配置已同步"}
              </p>
            </form>
          )}
        </div>
      )}

      {visibleBar && (
        <aside
          data-settings-change-bar=""
          aria-label="系统设置未保存修改"
          className="aiflow-settings-change-bar space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="font-semibold">
              {busyKey
                ? `正在处理${SETTINGS_LABELS[busyKey]}…`
                : committed
                  ? `${SETTINGS_LABELS[committed]}已保存，等待刷新`
                  : `${changes.length} 项未保存修改`}
            </p>
            <div className="flex flex-wrap gap-1">
              {dirtyKeys.map(key => (
                <Button
                  key={key}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onSelectKey(key)}
                  aria-pressed={key === activeKey}
                >
                  {SETTINGS_LABELS[key]} ·{" "}
                  {settingsDraftDiff(draftFor(key)!).length}
                </Button>
              ))}
            </div>
          </div>
          {error && (!activeKey || error.key !== activeKey || committed) && (
            <p role="alert" className="aiflow-type-meta text-aiflow-warning">
              {error.message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !changes.length}
              onClick={() => {
                rememberFocus();
                setShowDiff(true);
              }}
            >
              查看改动
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !changes.length}
              onClick={exportDrafts}
            >
              导出填写
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || !changes.length}
              onClick={() => requestDiscard({ kind: "discard" })}
            >
              放弃未保存修改
            </Button>
            {committed ? (
              <Button disabled={busy} onClick={() => void save()}>
                重试刷新
              </Button>
            ) : activeKey && changed ? (
              <Button
                form={`system-settings-${activeKey}`}
                type="submit"
                disabled={!canSave}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                {activeKey === "general" ? "保存通用设置" : "保存审批规则"}
              </Button>
            ) : otherDirty ? (
              <Button disabled={busy} onClick={() => onSelectKey(otherDirty)}>
                处理{SETTINGS_LABELS[otherDirty]}
              </Button>
            ) : null}
          </div>
        </aside>
      )}

      <Dialog open={showDiff} onOpenChange={setShowDiff}>
        <DialogContent
          onCloseAutoFocus={restoreModalFocus}
          className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl"
        >
          <DialogTitle>查看配置改动</DialogTitle>
          <DialogDescription>
            以下内容尚未保存。两类配置分别保存，切换分类会保留填写。
          </DialogDescription>
          <div className="min-h-0 space-y-3 overflow-y-auto">
            {changes.map(change => (
              <div
                key={`${change.key}-${change.field}`}
                className="space-y-2 rounded-xl border border-border p-4"
              >
                <p className="font-semibold">
                  {SETTINGS_LABELS[change.key]} · {change.label}
                </p>
                <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <div className="min-w-0 rounded-lg bg-muted p-3">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      保存前
                    </dt>
                    <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                      {settingChangeLabel(change.before)}
                    </dd>
                  </div>
                  <div className="min-w-0 rounded-lg bg-aiflow-info-surface p-3">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      本次填写
                    </dt>
                    <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                      {settingChangeLabel(change.after)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => setShowDiff(false)}>
            返回编辑
          </Button>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(discard)}
        onOpenChange={open => {
          if (!open && !working.current) setDiscard(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={restoreModalFocus}>
          <AlertDialogTitle>
            {discard?.kind === "reload"
              ? "读取最新配置前保留修改"
              : discard?.kind === "leave"
                ? "离开前保留配置修改"
                : "放弃未保存的配置修改"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {discard?.kind === "reload"
              ? "读取成功后会替换该分类的填写。可以先继续编辑并导出内容；读取失败时仍保留当前草稿。"
              : "当前配置修改尚未保存。可以继续编辑或导出填写内容，也可以明确放弃未保存修改。"}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = discard;
                setDiscard(null);
                if (action?.kind === "reload" && action.key)
                  void reload(action.key);
                else {
                  if (action?.kind === "discard")
                    setEntries(current => {
                      const next = { ...current };
                      for (const key of dirtyKeys) delete next[key];
                      return next;
                    });
                  else setEntries({});
                  setConflicts({});
                  if (!committed) setError(null);
                  action?.proceed?.();
                }
              }}
            >
              {discard?.kind === "reload"
                ? "替换为最新配置"
                : discard?.kind === "leave"
                  ? "放弃修改并离开"
                  : "放弃全部未保存修改"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
