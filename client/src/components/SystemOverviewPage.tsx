import type { ProjectRecord } from "@/components/ProjectWorkspace";
import type { ConsoleRoute } from "@shared/console-route";
import { formatConsoleRoute } from "@shared/console-route";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  ArchiveRestore,
  CheckCircle2,
  Database,
  FolderKanban,
  GitBranch,
  Gauge,
  LayoutDashboard,
  Loader2,
  Network,
  Settings2,
  ShieldCheck,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";

type WorkflowSummary = {
  id: string;
  flowType?: "state" | "control" | "data" | string | null;
  status?: "draft" | "published" | string | null;
};

type OverviewAction = {
  label: string;
  route?: ConsoleRoute;
  disabledReason?: string;
};

type OverviewModule = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  count?: string;
  actions: OverviewAction[];
};

type RoleJourney = {
  title: string;
  description: string;
  icon: LucideIcon;
  route?: ConsoleRoute;
  actionLabel: string;
  disabledReason?: string;
};

export type SystemOverviewPageProps = {
  platformName: string;
  role: "user" | "admin";
  projects: readonly ProjectRecord[];
  workflows: readonly WorkflowSummary[];
  projectsLoading: boolean;
  workflowsLoading: boolean;
  projectsError: boolean;
  workflowsError: boolean;
  onNavigate: (route: ConsoleRoute) => void;
};

function OverviewLink({
  action,
  onNavigate,
}: {
  action: OverviewAction;
  onNavigate: (route: ConsoleRoute) => void;
}) {
  if (!action.route)
    return (
      <span
        aria-disabled="true"
        className="inline-flex min-h-8 items-center gap-1 rounded-md border border-dashed border-slate-200 px-2.5 text-xs text-slate-400"
        title={action.disabledReason}
      >
        {action.label}
      </span>
    );

  const href = formatConsoleRoute(action.route);
  return (
    <a
      href={href}
      className="group inline-flex min-h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#b6caf2] hover:bg-[#f5f8ff] hover:text-[#245fc8] focus-visible:ring-2 focus-visible:ring-[#2d6bea]"
      onClick={event => {
        event.preventDefault();
        onNavigate(action.route!);
      }}
    >
      {action.label}
      <ArrowUpRight
        size={13}
        aria-hidden="true"
        className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      />
    </a>
  );
}

function DataValue({
  value,
  loading,
  error,
}: {
  value: number;
  loading: boolean;
  error: boolean;
}) {
  if (loading)
    return <Loader2 aria-label="加载中" className="animate-spin" size={18} />;
  if (error) return <span aria-label="读取失败">—</span>;
  return <>{value}</>;
}

function JourneyAction({
  journey,
  onNavigate,
}: {
  journey: RoleJourney;
  onNavigate: (route: ConsoleRoute) => void;
}) {
  if (!journey.route)
    return (
      <span
        aria-disabled="true"
        className="inline-flex items-center gap-1 text-xs text-slate-400"
        title={journey.disabledReason}
      >
        {journey.actionLabel}
      </span>
    );

  const href = formatConsoleRoute(journey.route);
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-xs font-medium text-[#2d6bea] hover:text-[#174fb5] focus-visible:rounded focus-visible:ring-2 focus-visible:ring-[#2d6bea]"
      onClick={event => {
        event.preventDefault();
        onNavigate(journey.route!);
      }}
    >
      {journey.actionLabel}
      <ArrowRight size={13} aria-hidden="true" />
    </a>
  );
}

export default function SystemOverviewPage({
  platformName,
  role,
  projects,
  workflows,
  projectsLoading,
  workflowsLoading,
  projectsError,
  workflowsError,
  onNavigate,
}: SystemOverviewPageProps) {
  const dataLoading = projectsLoading || workflowsLoading;
  const dataError = projectsError || workflowsError;
  const firstProject = projects[0];
  const firstWorkflow = workflows[0];
  const firstWorkflowRoute = firstWorkflow
    ? {
        section: "flows" as const,
        view: "editor" as const,
        workflowId: firstWorkflow.id,
      }
    : undefined;
  const projectRoute = firstProject
    ? {
        section: "flows" as const,
        view: "workspace" as const,
        projectId: firstProject.id,
      }
    : undefined;
  const workflowByType = (flowType: "state" | "control" | "data") =>
    workflows.find(workflow => workflow.flowType === flowType);
  const publishedWorkflowCount = workflows.filter(
    workflow => workflow.status === "published"
  ).length;
  const flowTypeCount = new Set(
    workflows
      .map(workflow => workflow.flowType)
      .filter((flowType): flowType is string => Boolean(flowType))
  ).size;

  const modules: OverviewModule[] = [
    {
      id: "business",
      eyebrow: "BUSINESS CENTER",
      title: "业务中心",
      description: "从授权业务项目进入流程、成员与资源工作区。",
      icon: FolderKanban,
      tone: "bg-[#edf4ff] text-[#2d6bea]",
      count: dataLoading ? undefined : `${projects.length} 个业务`,
      actions: [
        {
          label: "进入业务中心",
          route: { section: "flows", view: "center" },
        },
      ],
    },
    {
      id: "workspace",
      eyebrow: "PROJECT WORKSPACE",
      title: "项目工作区",
      description: "在业务上下文中设计流程、配置成员、资源和服务端点。",
      icon: LayoutDashboard,
      tone: "bg-[#f2efff] text-[#6d50c7]",
      count: firstProject ? firstProject.code : "未选择",
      actions: [
        {
          label: firstProject ? "打开授权业务" : "暂无可访问业务",
          route: projectRoute,
          disabledReason: "当前账号没有可进入的业务项目。",
        },
      ],
    },
    {
      id: "state-canvas",
      eyebrow: "FSM CANVAS",
      title: "状态流画布",
      description: "用状态、事件与守卫条件表达审批和状态迁移。",
      icon: GitBranch,
      tone: "bg-[#eaf8f2] text-[#159570]",
      count: workflowByType("state") ? "可进入" : "暂无流程",
      actions: [
        {
          label: workflowByType("state") ? "打开状态流程" : "暂无可访问状态流程",
          route: workflowByType("state")
            ? {
                section: "flows",
                view: "editor",
                workflowId: workflowByType("state")!.id,
              }
            : undefined,
          disabledReason: "当前授权范围内没有状态流程。",
        },
      ],
    },
    {
      id: "control-canvas",
      eyebrow: "SAGA / DAG CANVAS",
      title: "控制流画布",
      description: "编排服务调用、重试、超时与补偿分支。",
      icon: Network,
      tone: "bg-[#f2efff] text-[#7657d6]",
      count: workflowByType("control") ? "可进入" : "暂无流程",
      actions: [
        {
          label: workflowByType("control")
            ? "打开控制流程"
            : "暂无可访问控制流程",
          route: workflowByType("control")
            ? {
                section: "flows",
                view: "editor",
                workflowId: workflowByType("control")!.id,
              }
            : undefined,
          disabledReason: "当前授权范围内没有控制流程。",
        },
      ],
    },
    {
      id: "data-canvas",
      eyebrow: "ETL / LINEAGE CANVAS",
      title: "数据流画布",
      description: "连接数据源、转换算子、数据血缘与运行调度。",
      icon: Database,
      tone: "bg-[#eaf7fb] text-[#087da6]",
      count: workflowByType("data") ? "可进入" : "暂无流程",
      actions: [
        {
          label: workflowByType("data") ? "打开数据流程" : "暂无可访问数据流程",
          route: workflowByType("data")
            ? {
                section: "flows",
                view: "editor",
                workflowId: workflowByType("data")!.id,
              }
            : undefined,
          disabledReason: "当前授权范围内没有数据流程。",
        },
      ],
    },
    {
      id: "workbench",
      eyebrow: "PROCESS WORKBENCH",
      title: "流程工作台",
      description: "处理待办任务、查看已发起实例与审批工作。",
      icon: CheckCircle2,
      tone: "bg-[#fff7e8] text-[#b77709]",
      actions: [
        {
          label: "进入工作台",
          route: { section: "runs", view: "workbench" },
        },
      ],
    },
    {
      id: "warehouse",
      eyebrow: "WORKFLOW WAREHOUSE",
      title: "流程仓库",
      description: "浏览授权流程资产、版本与只读预览。",
      icon: ArchiveRestore,
      tone: "bg-[#edf4ff] text-[#2d6bea]",
      actions: [
        { label: "打开流程仓库", route: { section: "warehouse" } },
      ],
    },
    {
      id: "runtime",
      eyebrow: "RUNTIME CENTER",
      title: "运行中心",
      description: "监控流程实例、节点耗时、日志与运行状态。",
      icon: Activity,
      tone: "bg-[#eaf8f2] text-[#159570]",
      actions: [
        {
          label: "打开运行中心",
          route: firstWorkflow
            ? {
                section: "runs",
                view: "monitor",
                workflowId: firstWorkflow.id,
              }
            : { section: "runs", view: "workbench" },
        },
      ],
    },
    {
      id: "resources",
      eyebrow: "DATA RESOURCES",
      title: "数据资源中心",
      description: "在项目资源配置中心管理数据源、探查资源与数据流。",
      icon: Database,
      tone: "bg-[#eaf7fb] text-[#087da6]",
      actions: [
        {
          label: projectRoute ? "进入项目资源" : "暂无可访问业务",
          route: projectRoute,
          disabledReason: "数据资源按业务项目隔离，请先获得项目访问权限。",
        },
      ],
    },
    {
      id: "governance",
      eyebrow: "LIFECYCLE GOVERNANCE",
      title: "流程治理",
      description: "查看审核、发布、运行与版本治理状态。",
      icon: ShieldCheck,
      tone: "bg-[#fff7e8] text-[#b77709]",
      actions: [
        {
          label: firstWorkflow ? "查看流程治理" : "暂无可治理流程",
          route: firstWorkflow
            ? {
                section: "flows",
                view: "detail",
                workflowId: firstWorkflow.id,
              }
            : undefined,
          disabledReason: "当前授权范围内没有可查看的流程。",
        },
      ],
    },
    ...(role === "admin"
      ? [
          {
            id: "iam",
            eyebrow: "ORGANIZATION / IAM",
            title: "组织与 IAM",
            description: "维护组织架构、身份角色、权限与访问审计。",
            icon: UsersRound,
            tone: "bg-[#f2efff] text-[#6d50c7]",
            actions: [
              {
                label: "组织架构",
                route: { section: "system", view: "organization" },
              },
              {
                label: "身份权限",
                route: { section: "system", view: "identity" },
              },
            ],
          },
          {
            id: "system",
            eyebrow: "SYSTEM CONFIGURATION",
            title: "系统配置",
            description: "管理平台、审批规则、工作区与组织配置。",
            icon: Settings2,
            tone: "bg-[#edf4ff] text-[#2d6bea]",
            actions: [
              { label: "打开系统配置", route: { section: "system", view: "config" } },
            ],
          },
        ] satisfies OverviewModule[]
      : []),
  ];

  const journeys: RoleJourney[] = [
    ...(role === "admin"
      ? ([
          {
            title: "平台管理员",
            description: "组织、身份、权限和平台规则",
            icon: ShieldCheck,
            route: { section: "system", view: "config" },
            actionLabel: "管理系统",
          },
        ] satisfies RoleJourney[])
      : ([
          {
            title: "业务成员",
            description: "从已授权业务进入项目工作区",
            icon: FolderKanban,
            route: projectRoute ?? { section: "flows", view: "center" },
            actionLabel: projectRoute ? "进入项目" : "查看业务",
          },
        ] satisfies RoleJourney[])),
    {
      title: "流程设计者",
      description: "编辑流程定义并提交生命周期操作",
      icon: Workflow,
      route: firstWorkflowRoute ?? { section: "flows", view: "center" },
      actionLabel: firstWorkflowRoute ? "打开流程设计" : "选择流程",
    },
    {
      title: "运行与审批者",
      description: "处理任务并跟踪实例执行结果",
      icon: Gauge,
      route: { section: "runs", view: "workbench" },
      actionLabel: "进入工作台",
    },
  ];

  return (
    <main
      data-aiflow-system-overview=""
      className="min-h-[calc(100vh-56px)] min-w-0 overflow-x-clip bg-[var(--flow-background)] px-4 py-6 text-[var(--flow-foreground)] sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-[1560px] min-w-0">
        <section className="overflow-hidden rounded-xl border border-[#2d6bea]/20 bg-gradient-to-br from-[#255fc8] via-[#2d6bea] to-[#5b8ff2] px-5 py-7 text-white shadow-[0_18px_45px_-24px_rgba(45,107,234,.85)] sm:px-8 lg:px-10 lg:py-9">
          <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-blue-100">
                <LayoutDashboard size={15} aria-hidden="true" />
                SYSTEM OVERVIEW · {platformName.toUpperCase()}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                整体系统功能点全景看板
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50 sm:text-[15px]">
                以业务项目为入口，串联流程设计、状态/控制/数据三类画布、运行执行与全生命周期治理。
                仅展示当前账号已授权可访问的业务和流程。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <OverviewLink
                action={{
                  label: "进入业务中心",
                  route: { section: "flows", view: "center" },
                }}
                onNavigate={onNavigate}
              />
              <OverviewLink
                action={{
                  label: firstWorkflow ? "打开最近流程" : "查看工作台",
                  route: firstWorkflowRoute ?? {
                    section: "runs",
                    view: "workbench",
                  },
                }}
                onNavigate={onNavigate}
              />
            </div>
          </div>
          {dataError && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2 rounded-lg border border-white/25 bg-white/10 px-3 py-2.5 text-xs text-blue-50"
            >
              <Activity size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              部分系统数据暂时无法读取，模块仍保留入口；请稍后刷新重试。
            </div>
          )}
        </section>

        <section
          aria-label="授权范围统计"
          className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {[
            {
              label: "已授权业务",
              value: projects.length,
              note: "项目工作区",
              icon: FolderKanban,
            },
            {
              label: "可见流程",
              value: workflows.length,
              note: "全部流程类型",
              icon: Workflow,
            },
            {
              label: "已发布流程",
              value: publishedWorkflowCount,
              note: "可进入运行",
              icon: CheckCircle2,
            },
            {
              label: "流程类型",
              value: flowTypeCount,
              note: "状态 / 控制 / 数据",
              icon: GitBranch,
            },
          ].map(stat => (
            <article
              key={stat.label}
              data-overview-stat={stat.label}
              className="min-w-0 rounded-lg border border-[var(--flow-border)] bg-[var(--flow-card)] p-4 shadow-[var(--flow-shadow-1)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--flow-muted-foreground)]">
                  {stat.label}
                </span>
                <stat.icon
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-[#2d6bea]"
                />
              </div>
              <p className="mt-3 flex h-7 items-center text-2xl font-semibold tracking-tight text-[var(--flow-foreground)]">
                <DataValue
                  value={stat.value}
                  loading={dataLoading}
                  error={dataError}
                />
              </p>
              <p className="mt-1 truncate text-[11px] text-[var(--flow-ink-3)]">
                {stat.note}
              </p>
            </article>
          ))}
        </section>

        <section aria-labelledby="overview-modules-heading" className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] text-[#5b72a8]">
                CAPABILITY MATRIX
              </p>
              <h2
                id="overview-modules-heading"
                className="mt-1 text-lg font-semibold text-[var(--flow-foreground)]"
              >
                功能模块矩阵
              </h2>
            </div>
            <p className="text-xs text-[var(--flow-muted-foreground)]">
              {dataLoading
                ? "正在读取当前授权范围…"
                : dataError
                  ? "数据读取异常"
                  : projects.length || workflows.length
                    ? "按当前账号权限展示可进入能力"
                    : "当前授权范围暂无业务或流程"}
            </p>
          </div>
          {!dataLoading && !dataError && !projects.length && !workflows.length && (
            <div
              data-overview-empty=""
              className="mb-3 rounded-lg border border-dashed border-[#cbd5e1] bg-white px-4 py-3 text-sm text-slate-500"
            >
              暂无可访问业务项目。请联系管理员授予项目角色后再开始设计流程。
            </div>
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map(module => (
              <article
                key={module.id}
                data-overview-module={module.id}
                className="flex min-w-0 flex-col rounded-lg border border-[var(--flow-border)] bg-[var(--flow-card)] p-4 shadow-[var(--flow-shadow-1)] transition-shadow hover:shadow-[var(--flow-shadow-popover)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${module.tone}`}>
                    <module.icon size={18} aria-hidden="true" />
                  </div>
                  {module.count && (
                    <span className="max-w-[45%] truncate rounded-full bg-[var(--flow-muted)] px-2 py-1 text-[10px] font-medium text-[var(--flow-muted-foreground)]">
                      {module.count}
                    </span>
                  )}
                </div>
                <p className="mt-4 text-[10px] font-semibold tracking-[0.14em] text-[var(--flow-ink-3)]">
                  {module.eyebrow}
                </p>
                <h3 className="mt-1 text-base font-semibold text-[var(--flow-foreground)]">
                  {module.title}
                </h3>
                <p className="mt-2 min-h-10 text-xs leading-5 text-[var(--flow-muted-foreground)]">
                  {module.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--flow-line)] pt-3">
                  {module.actions.map(action => (
                    <OverviewLink
                      key={action.label}
                      action={action}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="overview-journeys-heading" className="mt-8">
          <div className="mb-3">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-[#5b72a8]">
              ROLE JOURNEYS
            </p>
            <h2
              id="overview-journeys-heading"
              className="mt-1 text-lg font-semibold text-[var(--flow-foreground)]"
            >
              角色工作路径
            </h2>
          </div>
          <div className="grid min-w-0 gap-3 md:grid-cols-3">
            {journeys.map(journey => (
              <article
                key={journey.title}
                className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--flow-border)] bg-[var(--flow-card)] p-4 shadow-[var(--flow-shadow-1)]"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--flow-muted)] text-[#2d6bea]">
                  <journey.icon size={17} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--flow-foreground)]">
                    {journey.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--flow-muted-foreground)]">
                    {journey.description}
                  </p>
                  <div className="mt-3">
                    <JourneyAction journey={journey} onNavigate={onNavigate} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
