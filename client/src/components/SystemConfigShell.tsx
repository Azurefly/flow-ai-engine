import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreationDialog } from "@/components/CreationDialog";
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
  Activity,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

type Tab = "general" | "approval" | "domain" | "access" | "runtime";

export default function SystemConfigShell({
  onOpenIdentity,
  onOpenOrganization,
}: {
  onOpenIdentity: () => void;
  onOpenOrganization: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [collapsed, setCollapsed] = useState(false);
  const items = [
    { id: "general" as const, label: "通用设置", icon: SlidersHorizontal },
    { id: "approval" as const, label: "审批配置", icon: ClipboardCheck },
    { id: "domain" as const, label: "工作域配置", icon: Workflow },
    { id: "access" as const, label: "组织与权限", icon: ShieldCheck },
    { id: "runtime" as const, label: "运行诊断", icon: Activity },
  ];
  const active = items.find(item => item.id === tab) ?? items[0];
  return (
    <div
      data-aiflow-system-config=""
      className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6"
    >
      <div
        className={`grid gap-4 ${collapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[240px_minmax(0,1fr)]"}`}
      >
        <aside
          data-system-config-navigation=""
          className="overflow-hidden rounded-lg border border-border bg-card p-2 shadow-sm"
        >
          <div
            data-system-config-nav-header=""
            className={`hidden items-start border-b border-border px-3 py-3 lg:flex ${collapsed ? "justify-center" : "justify-between"}`}
          >
            <div className={collapsed ? "hidden" : "block"}>
              <p className="text-[10px] font-bold tracking-[.16em] text-muted-foreground">
                SYSTEM CONFIGURATION
              </p>
              <h2 className="aiflow-type-section-title mt-1 font-semibold text-foreground">
                系统配置
              </h2>
            </div>
            <button
              type="button"
              aria-label={collapsed ? "展开配置导航" : "收起配置导航"}
              title={collapsed ? "展开配置导航" : "收起配置导航"}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-aiflow-info ${collapsed ? "" : "ml-auto"}`}
              onClick={() => setCollapsed(value => !value)}
            >
              {collapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
          </div>
          <label
            data-system-config-mobile-select=""
            className="grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 lg:hidden"
          >
            <span className="aiflow-type-control whitespace-nowrap font-medium text-muted-foreground">
              配置
            </span>
            <select
              data-system-config-view-select=""
              aria-label="系统配置分类"
              value={tab}
              onChange={event => setTab(event.target.value as Tab)}
              className="aiflow-type-control h-11 min-w-0 rounded-md border border-border bg-card px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {items.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <nav
            data-system-config-tabs=""
            aria-label="系统配置分类"
            className="hidden min-w-0 lg:mt-2 lg:grid lg:grid-cols-1 lg:gap-2 lg:overflow-visible"
          >
            {items.map(item => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => setTab(item.id)}
                className={`flex h-11 min-w-0 items-center gap-2 rounded px-3 text-left text-sm min-[1024px]:h-10 ${collapsed ? "justify-center" : ""} ${tab === item.id ? "bg-accent font-semibold text-aiflow-info" : "text-muted-foreground hover:bg-muted"}`}
              >
                <item.icon size={16} />
                <span className={collapsed ? "lg:hidden" : "truncate"}>
                  {item.label}
                </span>
              </button>
            ))}
          </nav>
        </aside>
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-2xs">
          <div
            data-system-config-breadcrumb=""
            className="border-b border-border bg-muted/60 px-5 py-2.5"
          >
            <nav
              aria-label="系统配置路径"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className="text-muted-foreground">系统配置 /</span>
              <h2
                id="system-config-active-tab"
                className="inline-flex items-center gap-1.5 font-semibold text-foreground"
              >
                <active.icon size={13} className="text-foreground" />
                {active.label}
              </h2>
            </nav>
          </div>
          <div
            id="system-config-card"
            aria-labelledby="system-config-active-tab"
            className="p-5 max-w-4xl"
          >
            {tab === "general" && <GeneralSettings />}
            {tab === "approval" && <ApprovalSettings />}
            {tab === "domain" && <DomainSettings />}
            {tab === "access" && (
              <AccessSettings
                onOpenIdentity={onOpenIdentity}
                onOpenOrganization={onOpenOrganization}
              />
            )}
            {tab === "runtime" && <RuntimeStatus />}
          </div>
        </section>
      </div>
    </div>
  );
}

function RuntimeStatus() {
  const runtime = trpc.config.runtimeInfo.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const readiness = trpc.config.readiness.useQuery(undefined, {
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  if (runtime.isLoading)
    return (
      <p className="text-sm text-muted-foreground">
        正在读取运行身份与能力状态…
      </p>
    );
  if (runtime.error)
    return (
      <p className="text-sm text-aiflow-danger">{runtime.error.message}</p>
    );
  const info = runtime.data;
  if (!info) return null;
  const capabilities = info.capabilities ?? [];
  const maturityGroups = [
    {
      key: "beta",
      title: "生产验证待完成",
      items: capabilities.filter(capability => capability.status === "beta"),
    },
    {
      key: "experimental",
      title: "实验阶段",
      items: capabilities.filter(
        capability => capability.status === "experimental"
      ),
    },
    {
      key: "disabled",
      title: "当前不可用",
      items: capabilities.filter(
        capability => capability.status === "disabled"
      ),
    },
    {
      key: "unknown",
      title: "状态待确认",
      items: capabilities.filter(
        capability =>
          !["beta", "experimental", "disabled"].includes(capability.status)
      ),
    },
  ].filter(group => group.items.length > 0);
  const betaCount = capabilities.filter(
    capability => capability.status === "beta"
  ).length;
  const experimentalCount = capabilities.filter(
    capability => capability.status === "experimental"
  ).length;
  const disabledCount = capabilities.filter(
    capability => capability.status === "disabled"
  ).length;
  const unknownCount =
    capabilities.length - betaCount - experimentalCount - disabledCount;
  const failedChecks = Object.entries(readiness.data?.checks ?? {}).filter(
    ([, check]) => !check.ok
  );
  const readinessLabel = readiness.isLoading
    ? "检查中"
    : readiness.isError
      ? "状态未知"
      : readiness.data?.ready
        ? "就绪"
        : "未就绪";
  const readinessTone =
    readiness.isLoading || readiness.isError
      ? "bg-muted text-muted-foreground"
      : readiness.data?.ready
        ? "bg-aiflow-success-surface text-aiflow-success"
        : "bg-aiflow-danger-surface text-aiflow-danger";
  return (
    <div>
      <Header
        eyebrow="RUNTIME DIAGNOSTICS"
        title="运行诊断"
        description="这里显示服务端真实构建身份、迁移版本、Worker 状态和节点能力边界。"
      />
      <section
        data-runtime-summary=""
        className="mt-5 grid gap-3 sm:grid-cols-3"
      >
        <article className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="aiflow-type-body font-medium text-muted-foreground">
              服务就绪检查
            </p>
            <span
              role="status"
              aria-live="polite"
              data-runtime-readiness=""
              className={`aiflow-type-meta rounded-full px-2 py-1 font-semibold ${readinessTone}`}
            >
              {readinessLabel}
            </span>
          </div>
          {readiness.isError && (
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              暂时无法读取运行诊断，请检查管理员会话或服务端状态。
            </p>
          )}
          {readiness.data?.ready && (
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              服务端 readiness 检查已通过；这不代表所有流程能力均完成生产验收。
            </p>
          )}
          {readiness.data && !readiness.data.ready && (
            <ul className="mt-2 space-y-1 text-sm leading-5 text-aiflow-danger">
              {failedChecks.map(([key]) => (
                <li key={key}>{readinessCheckLabel(key)}：未通过</li>
              ))}
              {!failedChecks.length && <li>服务端未就绪，请查看部署诊断。</li>}
            </ul>
          )}
        </article>
        <article className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="aiflow-type-body font-medium text-muted-foreground">
              持久化 Worker
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {info.worker.started
                ? info.worker.processing
                  ? "正在执行任务"
                  : "已启动，当前空闲"
                : "未启动"}
            </p>
          </div>
          <Activity
            className="shrink-0 text-muted-foreground"
            size={18}
            aria-hidden="true"
          />
        </article>
        <article className="min-w-0 rounded-lg border border-border bg-card p-4">
          <p className="aiflow-type-body font-medium text-muted-foreground">
            能力验收状态
          </p>
          <div className="aiflow-type-meta mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-aiflow-info-surface px-2 py-1 text-aiflow-info">
              待生产验证 {betaCount}
            </span>
            <span className="rounded-full bg-aiflow-warning-surface px-2 py-1 text-aiflow-warning">
              实验阶段 {experimentalCount}
            </span>
            <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">
              不可用 {disabledCount}
            </span>
            {unknownCount > 0 && (
              <span className="rounded-full bg-aiflow-special-surface px-2 py-1 text-aiflow-special">
                状态待确认 {unknownCount}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Worker 状态与能力成熟度不代表整体服务健康检查。
          </p>
        </article>
      </section>
      <section
        data-runtime-capabilities=""
        className="mt-5 overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 className="aiflow-type-section-title font-semibold text-foreground">
            能力与验收边界
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            状态来自服务端能力清单；只有完成对应验收后，才能将能力标记为可生产使用。
          </p>
        </div>
        {maturityGroups.length ? (
          maturityGroups.map(group => (
            <div
              key={group.key}
              className="border-b border-border last:border-b-0"
            >
              <h4 className="bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground">
                {group.title} · {group.items.length}
              </h4>
              <div className="divide-y divide-border">
                {group.items.map(capability => (
                  <article
                    key={capability.id}
                    data-runtime-capability-row=""
                    className="grid min-w-0 gap-1 px-4 py-3 sm:grid-cols-[minmax(150px,0.6fr)_minmax(0,1.4fr)] sm:items-start sm:gap-4"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
                      <h5 className="min-w-0 break-words text-sm font-semibold text-foreground">
                        {capability.label}
                      </h5>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${capability.status === "beta" ? "bg-aiflow-info-surface text-aiflow-info" : capability.status === "experimental" ? "bg-aiflow-warning-surface text-aiflow-warning" : "bg-muted text-muted-foreground"}`}
                      >
                        {capability.status === "beta"
                          ? "待生产验证"
                          : capability.status === "experimental"
                            ? "实验中"
                            : capability.status === "disabled"
                              ? "不可用"
                              : "状态待确认"}
                      </span>
                    </div>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {capability.reason}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            服务端尚未返回能力状态。
          </p>
        )}
      </section>
      <details
        data-runtime-technical-details=""
        className="mt-4 rounded-lg border border-border bg-card"
      >
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground">
          技术详情 · 构建、迁移与环境身份
        </summary>
        <dl className="grid gap-3 border-t border-border p-4 text-xs sm:grid-cols-2">
          <RuntimeDetail label="源码/构建标识" value={info.buildId} />
          <RuntimeDetail label="构建时间" value={info.buildTime} />
          <RuntimeDetail label="镜像 ID（SHA-256）" value={info.imageId} />
          <RuntimeDetail label="数据库迁移版本" value={info.migrationVersion} />
          <RuntimeDetail label="运行环境" value={info.nodeEnv} />
          <RuntimeDetail
            label="已处理 Job"
            value={String(info.worker.processedJobs)}
          />
        </dl>
      </details>
    </div>
  );
}

function readinessCheckLabel(key: string) {
  const labels: Record<string, string> = {
    database: "数据库连接",
    migrations: "数据库迁移",
    worker: "持久化 Worker",
    llm: "LLM 服务",
  };
  return labels[key] ?? `检查项 ${key}`;
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      toast.success(`${label}已复制。`);
    } catch {
      toast.error("浏览器无法访问剪贴板；可选择文本后手动复制。");
    }
  };
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 items-start gap-2">
        <code className="aiflow-type-code min-w-0 flex-1 select-all break-all text-foreground">
          {value || "—"}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`复制${label}`}
          className="h-7 shrink-0 px-2 text-[10px]"
          onClick={() => void copy()}
        >
          <Copy size={12} />
          复制
        </Button>
      </dd>
    </div>
  );
}

function GeneralSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.config.settings.useQuery();
  const persistedGeneral = settings.data?.general;
  const settingsReady = settings.isSuccess && Boolean(persistedGeneral);
  const settingsSnapshot = persistedGeneral
    ? JSON.stringify(persistedGeneral)
    : "";
  const savedForm = {
    platformName: String(
      persistedGeneral?.platformName ?? "Flow AI Engine"
    ).trim(),
    watermarkEnabled: Boolean(persistedGeneral?.watermarkEnabled),
    watermarkText: String(persistedGeneral?.watermarkText ?? "").trim(),
  };
  const [draft, setDraft] = useState<{
    snapshot: string;
    value: typeof savedForm;
  } | null>(null);
  const form = draft?.snapshot === settingsSnapshot ? draft.value : savedForm;
  const canEditSettings = settingsReady && !settings.isFetching;
  const hasChanges =
    settingsReady &&
    (form.platformName !== savedForm.platformName ||
      form.watermarkEnabled !== savedForm.watermarkEnabled ||
      form.watermarkText !== savedForm.watermarkText);
  const update = trpc.config.updateSetting.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.config.settings.invalidate(),
        utils.config.publicGeneral.invalidate(),
      ]);
      setDraft(null);
      toast.success("通用设置已保存。 ");
    },
    onError: error => toast.error(error.message),
  });
  return (
    <div>
      <Header
        eyebrow="GENERAL SETTINGS"
        title="通用设置"
        description="系统级显示配置由管理员持久化管理；设置不会跨越项目与流程数据隔离边界。"
      />
      <div
        className="mt-6 grid gap-4 rounded-lg border border-border p-5"
        aria-busy={
          settings.isLoading || settings.isFetching || update.isPending
        }
      >
        {settings.isLoading && !settings.data && (
          <p
            role="status"
            aria-live="polite"
            className="aiflow-type-body text-muted-foreground"
          >
            正在读取通用设置；读取完成前无法保存。
          </p>
        )}
        {(settings.isError || (settings.isSuccess && !persistedGeneral)) && (
          <div
            role="alert"
            className="grid gap-3 rounded-md border border-aiflow-danger-border bg-aiflow-danger-surface p-3"
          >
            <p className="aiflow-type-body text-aiflow-danger">
              {settings.isError
                ? "暂时无法读取通用设置，默认值不会提交。请检查管理员会话或服务状态后重试。"
                : "服务端未返回通用设置，当前无法修改或保存。"}
            </p>
            <Button
              type="button"
              variant="outline"
              className="aiflow-type-control h-11 w-fit min-[1024px]:h-10"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              重试读取
            </Button>
          </div>
        )}
        {settingsReady && settings.isFetching && (
          <p
            role="status"
            aria-live="polite"
            className="aiflow-type-body text-muted-foreground"
          >
            正在确认最新设置，暂时不能编辑。
          </p>
        )}
        {settingsReady && (
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={event => {
              event.preventDefault();
              if (!canEditSettings || update.isPending || !hasChanges) return;
              const value = {
                ...form,
                platformName: form.platformName.trim(),
                watermarkText: form.watermarkText.trim(),
              };
              if (!value.platformName) {
                toast.error("平台名称不可为空。");
                return;
              }
              if (value.watermarkEnabled && !value.watermarkText) {
                toast.error("开启水印时必须配置水印文本。");
                return;
              }
              update.mutate({ key: "general", value });
            }}
          >
            <label className="grid gap-2 text-sm font-medium text-foreground">
              平台名称
              <Input
                className="h-11 min-[1024px]:h-10"
                value={form.platformName}
                disabled={!canEditSettings || update.isPending}
                required
                onChange={event =>
                  setDraft({
                    snapshot: settingsSnapshot,
                    value: { ...form, platformName: event.target.value },
                  })
                }
                maxLength={120}
              />
            </label>
            <div className="grid content-start gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground min-[1024px]:min-h-10">
                <input
                  type="checkbox"
                  checked={form.watermarkEnabled}
                  disabled={!canEditSettings || update.isPending}
                  onChange={event =>
                    setDraft({
                      snapshot: settingsSnapshot,
                      value: {
                        ...form,
                        watermarkEnabled: event.target.checked,
                      },
                    })
                  }
                />
                启用系统水印
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                水印文字
                <Input
                  className="h-11 min-[1024px]:h-10"
                  value={form.watermarkText}
                  disabled={
                    !form.watermarkEnabled ||
                    !canEditSettings ||
                    update.isPending
                  }
                  required={form.watermarkEnabled}
                  onChange={event =>
                    setDraft({
                      snapshot: settingsSnapshot,
                      value: { ...form, watermarkText: event.target.value },
                    })
                  }
                  maxLength={120}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
              <Button
                type="submit"
                className="h-11 w-fit bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
                disabled={!canEditSettings || update.isPending || !hasChanges}
              >
                {update.isPending && (
                  <Loader2 className="animate-spin" size={15} />
                )}
                {update.isPending ? "保存中…" : "保存通用设置"}
              </Button>
              <span
                role="status"
                aria-live="polite"
                className={`aiflow-type-body flex items-center gap-1 ${hasChanges ? "text-aiflow-warning" : "text-aiflow-success"}`}
              >
                {hasChanges ? (
                  "有未保存的通用设置更改"
                ) : (
                  <>
                    <CheckCircle2 size={14} />
                    当前通用设置已同步
                  </>
                )}
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ApprovalSettings() {
  const utils = trpc.useUtils();
  const settings = trpc.config.settings.useQuery();
  const approvalSettings = settings.data?.approval;
  const settingsReady = settings.isSuccess && Boolean(approvalSettings);
  const settingsSnapshot = approvalSettings
    ? JSON.stringify(approvalSettings)
    : "";
  const savedForm = {
    required: Boolean(approvalSettings?.requireProjectApproval),
    reviewerMode:
      approvalSettings?.reviewerMode === "independent_reviewer"
        ? ("independent_reviewer" as const)
        : ("project_owner_or_admin" as const),
  };
  const [draft, setDraft] = useState<{
    snapshot: string;
    value: typeof savedForm;
  } | null>(null);
  const form = draft?.snapshot === settingsSnapshot ? draft.value : savedForm;
  const canEditSettings = settingsReady && !settings.isFetching;
  const hasChanges =
    settingsReady &&
    (form.required !== savedForm.required ||
      form.reviewerMode !== savedForm.reviewerMode);
  const update = trpc.config.updateSetting.useMutation({
    onSuccess: async () => {
      await utils.config.settings.invalidate();
      setDraft(null);
      toast.success("审批规则已保存。");
    },
    onError: error => toast.error(error.message),
  });
  return (
    <div>
      <Header
        eyebrow="APPROVAL CONFIGURATION"
        title="审批配置"
        description="项目流程保持待审核、审核通过和审核驳回生命周期；发布门禁在服务端执行。"
      />
      <div className="mt-6 grid gap-5 rounded-lg border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
        <div className="flex min-w-0 gap-3">
          <ClipboardCheck className="mt-0.5 text-aiflow-info" size={20} />
          <div className="min-w-0">
            <h3 className="aiflow-type-card-title font-semibold text-foreground">
              项目流程发布审批
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              仅项目所有者或系统管理员可完成审核；设计者不能绕过审批发布项目流程。
            </p>
          </div>
        </div>
        <div
          className="grid content-start gap-4"
          aria-busy={settings.isLoading || settings.isFetching}
        >
          {settings.isLoading && !settings.data && (
            <p
              role="status"
              aria-live="polite"
              className="aiflow-type-body text-muted-foreground"
            >
              正在读取审批规则；读取完成前无法保存。
            </p>
          )}
          {(settings.isError || (settings.isSuccess && !approvalSettings)) && (
            <div
              role="alert"
              className="grid gap-3 rounded-md border border-aiflow-danger-border bg-aiflow-danger-surface p-3"
            >
              <p className="aiflow-type-body text-aiflow-danger">
                {settings.isError
                  ? "暂时无法读取审批规则，默认值不会提交。请检查管理员会话或服务状态后重试。"
                  : "服务端未返回审批规则，当前无法修改或保存。"}
              </p>
              <Button
                type="button"
                variant="outline"
                className="aiflow-type-control h-11 w-fit min-[1024px]:h-10"
                disabled={settings.isFetching}
                onClick={() => void settings.refetch()}
              >
                重试读取
              </Button>
            </div>
          )}
          {settingsReady && settings.isFetching && (
            <p
              role="status"
              aria-live="polite"
              className="aiflow-type-body text-muted-foreground"
            >
              正在确认最新规则，暂时不能编辑。
            </p>
          )}
          {settingsReady && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-foreground min-[1024px]:min-h-10">
                <input
                  type="checkbox"
                  checked={form.required}
                  disabled={!canEditSettings || update.isPending}
                  onChange={event =>
                    setDraft({
                      snapshot: settingsSnapshot,
                      value: { ...form, required: event.target.checked },
                    })
                  }
                />
                要求审核通过后发布
              </label>
              <label className="grid gap-2 text-sm font-medium text-foreground">
                审核人隔离策略
                <select
                  className="h-11 rounded-md border border-border bg-card px-3 text-sm min-[1024px]:h-10"
                  value={form.reviewerMode}
                  disabled={!canEditSettings || update.isPending}
                  onChange={event =>
                    setDraft({
                      snapshot: settingsSnapshot,
                      value: {
                        ...form,
                        reviewerMode:
                          event.target.value === "independent_reviewer"
                            ? "independent_reviewer"
                            : "project_owner_or_admin",
                      },
                    })
                  }
                >
                  <option value="project_owner_or_admin">
                    项目所有者或系统管理员
                  </option>
                  <option value="independent_reviewer">
                    独立复核（设计所有人不可自审）
                  </option>
                </select>
              </label>
            </>
          )}
        </div>
        {settingsReady && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 md:col-span-2">
            <Button
              className="h-11 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
              size="sm"
              disabled={!canEditSettings || update.isPending || !hasChanges}
              onClick={() => {
                if (!canEditSettings || update.isPending || !hasChanges) return;
                update.mutate({
                  key: "approval",
                  value: {
                    requireProjectApproval: form.required,
                    reviewerMode: form.reviewerMode,
                  },
                });
              }}
            >
              {update.isPending && (
                <Loader2 className="animate-spin" size={14} />
              )}
              {update.isPending ? "保存中…" : "保存审批规则"}
            </Button>
            <span
              role="status"
              aria-live="polite"
              className={`aiflow-type-body flex items-center gap-1 ${hasChanges ? "text-aiflow-warning" : "text-aiflow-success"}`}
            >
              {hasChanges ? (
                "有未保存的审批规则更改"
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  当前发布门禁由服务端强制执行
                </>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function DomainSettings() {
  const utils = trpc.useUtils();
  const domains = trpc.config.workDomains.useQuery();
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [domainToDisable, setDomainToDisable] = useState<any | null>(null);
  const create = trpc.config.createWorkDomain.useMutation({
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ code: "", name: "", description: "" });
      void utils.config.workDomains.invalidate();
      toast.success("工作域已创建。 ");
    },
    onError: error => toast.error(error.message),
  });
  const update = trpc.config.updateWorkDomain.useMutation({
    onSuccess: () => {
      void utils.config.workDomains.invalidate();
      setDomainToDisable(null);
      toast.success("工作域已更新。 ");
    },
    onError: error => toast.error(error.message),
  });
  const toggleDomain = (domain: any) => {
    if (domain.status === "active") {
      setDomainToDisable(domain);
      return;
    }
    update.mutate({ id: domain.id, status: "active" });
  };
  return (
    <div>
      <Header
        eyebrow="WORK DOMAIN"
        title="工作域配置"
        description="工作域用于管理员组织业务项目；项目自身仍是成员、流程与运行记录的数据隔离边界。"
        action={
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={15} />
            新建工作域
          </Button>
        }
      />
      {domains.isLoading && (
        <div
          role="status"
          className="mt-5 rounded-lg border border-border p-6 text-sm text-muted-foreground"
        >
          正在读取工作域列表…
        </div>
      )}
      {domains.isError && (
        <div
          role="alert"
          className="mt-5 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 text-sm text-aiflow-danger"
        >
          <p>工作域列表读取失败：{domains.error.message}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => void domains.refetch()}
          >
            重试
          </Button>
        </div>
      )}
      {domains.isSuccess && !(domains.data ?? []).length && (
        <div
          data-work-domain-empty=""
          className="mt-5 rounded-lg border border-dashed border-input bg-muted/70 px-4 py-8 text-center"
        >
          <Workflow className="mx-auto text-muted-foreground" size={24} />
          <h3 className="aiflow-type-card-title mt-3 font-semibold text-foreground">
            尚未配置工作域
          </h3>
          <p className="aiflow-type-body mx-auto mt-1 max-w-sm leading-5 text-muted-foreground">
            创建工作域后，可按业务归属组织项目；当前尚无关联项目数据。
          </p>
        </div>
      )}
      {domains.isSuccess && (domains.data ?? []).length > 0 && (
        <>
          <div className="mt-5 space-y-3 min-[1024px]:hidden">
            {(domains.data ?? []).map((domain: any) => (
              <article
                key={domain.id}
                data-work-domain-card=""
                className="min-w-0 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="aiflow-type-card-title break-words font-semibold text-foreground">
                      {domain.name}
                    </h3>
                    <code className="mt-1 block break-all font-mono text-xs text-aiflow-info">
                      {domain.code}
                    </code>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-1 text-xs ${domain.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
                  >
                    {domain.status === "active" ? "启用" : "停用"}
                  </span>
                </div>
                <p className="mt-3 break-words text-sm text-muted-foreground">
                  {domain.description || "未填写说明"}
                </p>
                <dl className="aiflow-type-body mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">创建人</dt>
                    <dd className="mt-1 break-words text-foreground">
                      {domain.creatorName || domain.creatorUsername || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">关联项目</dt>
                    <dd className="mt-1 text-foreground">
                      {Number(domain.projectCount || 0)} 个
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-11 w-full"
                  aria-label={`${domain.status === "active" ? "停用" : "启用"}工作域 ${domain.name}`}
                  disabled={update.isPending}
                  onClick={() => toggleDomain(domain)}
                >
                  {domain.status === "active" ? "停用工作域" : "启用工作域"}
                </Button>
              </article>
            ))}
          </div>
          <div className="mt-5 hidden overflow-x-auto min-[1024px]:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted text-sm text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">代号</th>
                  <th className="px-4 py-3 whitespace-nowrap">名称 / 说明</th>
                  <th className="px-4 py-3 whitespace-nowrap">创建人</th>
                  <th className="px-4 py-3 whitespace-nowrap">关联项目</th>
                  <th className="px-4 py-3 whitespace-nowrap">状态</th>
                  <th className="px-4 py-3 whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {(domains.data ?? []).map((domain: any) => (
                  <tr key={domain.id} className="border-t border-border">
                    <td className="px-4 py-3 font-mono text-xs text-aiflow-info whitespace-nowrap">
                      {domain.code}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {domain.name}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {domain.description || "未填写说明"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {domain.creatorName || domain.creatorUsername || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {Number(domain.projectCount || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-1 text-xs ${domain.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-muted text-muted-foreground"}`}
                      >
                        {domain.status === "active" ? "启用" : "停用"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="aiflow-type-control h-10"
                        disabled={update.isPending}
                        onClick={() => toggleDomain(domain)}
                      >
                        {domain.status === "active" ? "停用" : "启用"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Dialog
        open={domainToDisable !== null}
        onOpenChange={open => {
          if (!open && !update.isPending) setDomainToDisable(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>停用工作域</DialogTitle>
            <DialogDescription>
              停用后，“{domainToDisable?.name}
              ”不会出现在新建项目的工作域选项中。已关联的{" "}
              {Number(domainToDisable?.projectCount || 0)}{" "}
              个项目及其流程、运行记录会保留；重新启用后可再次选择。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              disabled={update.isPending}
              onClick={() => setDomainToDisable(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11 w-full sm:w-auto"
              disabled={!domainToDisable || update.isPending}
              onClick={() =>
                domainToDisable &&
                update.mutate({ id: domainToDisable.id, status: "disabled" })
              }
            >
              {update.isPending ? "正在停用…" : "确认停用工作域"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建工作域"
        description="创建工作域后，可按业务归属组织项目。取消不会保存。"
        pending={create.isPending}
        onSubmit={() => create.mutate(form)}
      >
        <label
          htmlFor="new-domain-code"
          className="aiflow-type-control grid gap-1 font-medium text-foreground"
        >
          工作域代号
          <Input
            id="new-domain-code"
            className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-10 min-[1024px]:min-h-0"
            placeholder="请输入工作域代号"
            value={form.code}
            onChange={event =>
              setForm({ ...form, code: event.target.value.toUpperCase() })
            }
            required
          />
        </label>
        <label
          htmlFor="new-domain-name"
          className="aiflow-type-control grid gap-1 font-medium text-foreground"
        >
          工作域名称
          <Input
            id="new-domain-name"
            className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-10 min-[1024px]:min-h-0"
            placeholder="请输入工作域名称"
            value={form.name}
            onChange={event => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label
          htmlFor="new-domain-description"
          className="aiflow-type-control grid gap-1 font-medium text-foreground"
        >
          说明（可选）
          <Input
            id="new-domain-description"
            className="aiflow-type-control h-11 min-h-11 min-[1024px]:h-10 min-[1024px]:min-h-0"
            placeholder="简要说明该工作域的业务范围"
            value={form.description}
            onChange={event =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
      </CreationDialog>
    </div>
  );
}

function AccessSettings({
  onOpenIdentity,
  onOpenOrganization,
}: {
  onOpenIdentity: () => void;
  onOpenOrganization: () => void;
}) {
  const accessCardClassName =
    "flex min-w-0 flex-col rounded-lg border border-border bg-card p-5";
  const accessCardActionClassName =
    "mt-5 h-11 w-fit border-border text-foreground hover:bg-muted min-[1024px]:h-10";

  return (
    <div>
      <Header
        eyebrow="ORGANIZATION & AUTHORIZATION"
        title="组织与权限"
        description="组织、账号、角色和权限统一从一个入口管理，避免系统配置中出现功能重叠的并列菜单。"
      />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className={accessCardClassName}>
          <Building2 className="text-aiflow-info" size={22} />
          <h3 className="aiflow-type-card-title mt-4 font-semibold text-foreground">
            组织架构
          </h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
            维护部门树、负责人、成员岗位和组织权限组，并驱动直属上级与角色处理人解析。
          </p>
          <Button
            type="button"
            variant="outline"
            className={accessCardActionClassName}
            onClick={onOpenOrganization}
          >
            <Building2 size={16} />
            打开组织架构管理
          </Button>
        </section>
        <section className={accessCardClassName}>
          <ShieldCheck className="text-aiflow-info" size={22} />
          <h3 className="aiflow-type-card-title mt-4 font-semibold text-foreground">
            账号与角色
          </h3>
          <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
            维护内部账号、系统角色、直接与临时授权，查看用户权限和角色绑定用户。
          </p>
          <Button
            type="button"
            variant="outline"
            className={accessCardActionClassName}
            onClick={onOpenIdentity}
          >
            <ShieldCheck size={16} />
            打开身份与权限中心
          </Button>
        </section>
      </div>
    </div>
  );
}
function Header({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-bold tracking-[.16em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1
          data-aiflow-page-title=""
          className="aiflow-type-page-title mt-1 font-semibold text-foreground"
        >
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
