import { workflowNodeTypeLabel } from "@shared/workflow-node-label";
import {
  builtinDataFunctions,
  dataFunctionTypeLabel,
} from "@shared/builtin-data-functions";
import {
  dataflowResultColumns,
  dataflowTerminalResults,
  dataflowResultPage,
} from "@shared/dataflow-result-preview";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StructuredResourceForm } from "@/components/StructuredResourceForm";
import { CreationDialog } from "@/components/CreationDialog";
import { ResourceDetails } from "@/components/ResourceDetails";
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
  ArrowLeftRight,
  Braces,
  CalendarClock,
  Database,
  FileCode2,
  FileText,
  Loader2,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Table2,
  Tags,
  Trash2,
} from "lucide-react";
import { Children, isValidElement, useMemo, useState } from "react";
import { toast } from "sonner";

type Tab = "sources" | "assets" | "udfs" | "tags" | "plugins" | "flows";

function formatDataflowTime(value?: string | Date | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

export default function DataResourceCenter({
  projectId,
  onOpenWorkflow,
}: {
  projectId: string;
  onOpenWorkflow: (workflowId: string) => void;
}) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const projectName =
    projects.data?.find(project => project.id === projectId)?.name ??
    "当前业务";
  const [tab, setTab] = useState<Tab>("sources");
  const [dataflowSection, setDataflowSection] = useState<
    "overview" | "runs" | "schedules"
  >("overview");
  const [activeFlowId, setActiveFlowId] = useState("");
  const resources = trpc.data.resources.useQuery({ projectId });
  const flows = trpc.data.flows.useQuery({ projectId });
  const schedules = trpc.data.schedules.useQuery(
    { projectId },
    { enabled: tab === "flows" }
  );
  const hasActiveSchedule =
    schedules.data?.some(schedule => schedule.status === "active") ?? false;
  const runs = trpc.data.runs.useQuery(
    { projectId, limit: 30, summaryOnly: true },
    {
      enabled: tab === "flows",
      refetchInterval: query => {
        if (tab !== "flows") return false;
        const hasActiveRun = query.state.data?.some(
          run => run.status === "queued" || run.status === "running"
        );
        return hasActiveRun ? 3_000 : hasActiveSchedule ? 15_000 : false;
      },
      refetchIntervalInBackground: false,
    }
  );
  const hasActiveRun =
    runs.data?.some(
      run => run.status === "queued" || run.status === "running"
    ) ?? false;
  const [udfForm, setUdfForm] = useState({
    name: "",
    udfType: "javascript" as "sql" | "javascript" | "python" | "jar",
    description: "",
    returnType: "unknown",
    artifactRef: "builtin:trim",
  });
  const [tagName, setTagName] = useState("");
  const [pluginForm, setPluginForm] = useState({
    name: "",
    pluginType: "transform" as "transform" | "connector" | "visualization",
    version: "1.0.0",
  });
  const [scheduleForm, setScheduleForm] = useState({
    workflowId: "",
    cronExpression: "0 0 9 * * *",
  });

  const invalidate = () => {
    void utils.data.resources.invalidate({ projectId });
    void utils.data.flows.invalidate({ projectId });
    void utils.data.runs.invalidate({ projectId });
  };
  const createSource = trpc.data.createSource.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("数据源草稿已创建；请按类型校验登记或测试连接。");
    },
    onError: error => toast.error(error.message),
  });
  const createAsset = trpc.data.createAsset.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("资源探查结果已保存。");
    },
    onError: error => toast.error(error.message),
  });
  const createUdf = trpc.data.createUdf.useMutation({
    onSuccess: () => {
      setUdfForm({
        name: "",
        udfType: "javascript",
        description: "",
        returnType: "unknown",
        artifactRef: "builtin:trim",
      });
      invalidate();
      toast.success("函数已登记；需审核并绑定可执行实现。");
    },
    onError: error => toast.error(error.message),
  });
  const createTag = trpc.data.createTag.useMutation({
    onSuccess: () => {
      setTagName("");
      invalidate();
      toast.success("标签已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const createPlugin = trpc.data.createPlugin.useMutation({
    onSuccess: () => {
      setPluginForm({ name: "", pluginType: "transform", version: "1.0.0" });
      invalidate();
      toast.success("项目插件元数据已登记。");
    },
    onError: error => toast.error(error.message),
  });
  const removeSource = trpc.data.deleteSource.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  const removeAsset = trpc.data.deleteAsset.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  const removeUdf = trpc.data.deleteUdf.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  const removeTag = trpc.data.deleteTag.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  const removePlugin = trpc.data.deletePlugin.useMutation({
    onSuccess: invalidate,
    onError: error => toast.error(error.message),
  });
  const testSource = trpc.data.testSource.useMutation({
    onSuccess: (result: any) => {
      invalidate();
      toast[result.status === "success" ? "success" : "error"](
        result.status === "success"
          ? result.evidence?.probe === "inline_metadata"
            ? "内联数据源登记信息已校验；未连接外部系统。"
            : "数据源连接测试通过。"
          : `连接测试未通过：${result.error?.message || result.errorCategory || "请查看测试证据"}`
      );
    },
    onError: error => toast.error(error.message),
  });
  const run = trpc.data.run.useMutation({
    onSuccess: (result, variables) => {
      invalidate();
      setActiveFlowId(variables.workflowId);
      setDataflowSection("runs");
      toast.success(
        `${result.status === "success" ? "数据流运行完成" : "数据流已进入持久化执行队列"}：${result.runId.slice(0, 8)}`
      );
    },
    onError: error => {
      // Execution errors can arrive after a failed run has already been saved.
      invalidate();
      toast.error(error.message);
    },
  });
  const refreshSchedules = () => {
    void utils.data.schedules.invalidate({ projectId });
    void utils.data.flows.invalidate({ projectId });
  };
  const saveSchedule = trpc.data.saveScheduleDraft.useMutation({
    onSuccess: () => {
      refreshSchedules();
      toast.success("调度草稿已保存；可在本页启用后台触发。 ");
    },
    onError: error => toast.error(error.message),
  });
  const activateSchedule = trpc.data.activateSchedule.useMutation({
    onSuccess: () => {
      refreshSchedules();
      toast.success("托管计划已启用。 ");
    },
    onError: error => toast.error(error.message),
  });
  const pauseSchedule = trpc.data.pauseSchedule.useMutation({
    onSuccess: () => {
      refreshSchedules();
      toast.success("托管计划已暂停。 ");
    },
    onError: error => toast.error(error.message),
  });
  const deleteSchedule = trpc.data.deleteSchedule.useMutation({
    onSuccess: () => {
      refreshSchedules();
      toast.success("托管计划已删除。 ");
    },
    onError: error => toast.error(error.message),
  });
  const scheduleByWorkflow = new Map(
    (schedules.data ?? []).map((schedule: any) => [
      schedule.workflowId,
      schedule,
    ])
  );
  const flowList = (flows.data ?? []) as any[];
  const publishedFlows = flowList.filter(flow => flow.status === "published");
  const selectedQueryLoading =
    tab === "flows"
      ? resources.isLoading ||
        flows.isLoading ||
        runs.isLoading ||
        schedules.isLoading
      : resources.isLoading;
  const selectedQueryError =
    tab === "flows"
      ? resources.error || flows.error || runs.error || schedules.error
      : resources.error;
  const retrySelectedQueries = () => {
    if (tab === "flows") {
      void Promise.all([
        resources.refetch(),
        flows.refetch(),
        runs.refetch(),
        schedules.refetch(),
      ]);
      return;
    }
    void resources.refetch();
  };

  const entries = useMemo(
    () => [
      {
        id: "sources" as const,
        label: "数据源",
        icon: Database,
        count: resources.isLoading
          ? null
          : resources.error
            ? null
            : (resources.data?.sources.length ?? 0),
      },
      {
        id: "assets" as const,
        label: "资源探查",
        icon: Table2,
        count: resources.isLoading
          ? null
          : resources.error
            ? null
            : (resources.data?.assets.length ?? 0),
      },
      {
        id: "udfs" as const,
        label: "函数",
        icon: FileCode2,
        count: resources.isLoading
          ? null
          : resources.error
            ? null
            : (resources.data?.udfs.length ?? 0),
      },
      {
        id: "tags" as const,
        label: "标签",
        icon: Tags,
        count: resources.isLoading
          ? null
          : resources.error
            ? null
            : (resources.data?.tags.length ?? 0),
      },
      {
        id: "plugins" as const,
        label: "项目插件",
        icon: Puzzle,
        count: resources.isLoading
          ? null
          : resources.error
            ? null
            : (resources.data?.plugins.length ?? 0),
      },
      {
        id: "flows" as const,
        label: "数据流",
        icon: Braces,
        count:
          flows.isLoading || flows.error ? null : (flows.data?.length ?? 0),
      },
    ],
    [
      flows.data,
      flows.error,
      flows.isLoading,
      resources.data,
      resources.error,
      resources.isLoading,
    ]
  );

  return (
    <div data-resource-center="">
      <div className="mb-5 border-b border-border pb-4">
        <p className="aiflow-type-meta font-bold tracking-[.16em] text-muted-foreground">
          PROJECT RESOURCE CENTER
        </p>
        <h1 className="aiflow-type-page-title mt-1 font-semibold text-foreground">
          资源配置中心
        </h1>
        <p className="aiflow-type-body mt-1 max-w-3xl text-muted-foreground">
          管理当前业务的数据源、资源目录、函数、标签和插件。凭据只保存环境密钥引用；登记成功不代表连接或查询权限已验证。
        </p>
      </div>
      <label
        data-resource-category-mobile=""
        className="mb-4 grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 lg:hidden"
      >
        <span className="aiflow-type-control whitespace-nowrap font-medium text-muted-foreground">
          资源类别
        </span>
        <select
          data-resource-category-select=""
          aria-label="项目资源类别"
          value={tab}
          onChange={event => setTab(event.target.value as Tab)}
          className="aiflow-type-control h-11 min-w-0 rounded-md border border-border bg-card px-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {entries.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
              {`（${item.count ?? "…"}）`}
            </option>
          ))}
        </select>
      </label>
      <nav
        data-resource-category-desktop=""
        aria-label="项目资源类别"
        className="mb-4 hidden min-w-0 gap-2 pb-1 lg:flex lg:flex-wrap"
      >
        {entries.map(item => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
            title={item.label}
            className={`aiflow-type-control flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-2 py-2 transition-colors sm:px-3 ${tab === item.id ? "border-aiflow-info-border bg-accent font-semibold text-aiflow-info" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
          >
            <item.icon className="shrink-0" size={15} />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">
              {item.label}
            </span>
            <span className="aiflow-type-meta min-w-6 shrink-0 rounded bg-card/70 px-1.5 text-center text-muted-foreground">
              {item.count ?? "…"}
            </span>
          </button>
        ))}
      </nav>
      {selectedQueryLoading && (
        <div
          role="status"
          data-resource-loading=""
          className="rounded-lg border border-border bg-card p-8 text-sm text-muted-foreground"
        >
          正在读取当前资源类别…
        </div>
      )}
      {!selectedQueryLoading && selectedQueryError && (
        <div
          role="alert"
          data-resource-error=""
          className="flex flex-col gap-3 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-aiflow-danger">
            当前资源未能加载，列表内容不会按空数据展示。请重试或检查服务状态。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit border-aiflow-danger-border bg-card text-aiflow-danger"
            onClick={retrySelectedQueries}
          >
            重试
          </Button>
        </div>
      )}
      {!selectedQueryLoading && !selectedQueryError && tab === "flows" && (
        <DataflowWorkspace
          projectName={projectName}
          resources={resources.data as any}
          flows={flowList}
          publishedFlows={publishedFlows}
          runs={(runs.data ?? []) as any[]}
          schedules={(schedules.data ?? []) as any[]}
          schedulesByWorkflow={scheduleByWorkflow}
          section={dataflowSection}
          setSection={setDataflowSection}
          activeFlowId={activeFlowId}
          setActiveFlowId={setActiveFlowId}
          scheduleForm={scheduleForm}
          setScheduleForm={setScheduleForm}
          onOpenWorkflow={onOpenWorkflow}
          onOpenResourceTab={setTab}
          onRunFlow={workflowId => run.mutate({ projectId, workflowId })}
          runPending={run.isPending}
          onRefresh={retrySelectedQueries}
          refreshPending={
            runs.isFetching ||
            flows.isFetching ||
            schedules.isFetching ||
            resources.isFetching
          }
          autoRefreshActive={hasActiveRun || hasActiveSchedule}
          onSaveSchedule={() =>
            saveSchedule.mutate({ projectId, ...scheduleForm })
          }
          saveSchedulePending={saveSchedule.isPending}
          onActivateSchedule={workflowId =>
            activateSchedule.mutate({ projectId, workflowId })
          }
          activateSchedulePending={activateSchedule.isPending}
          onPauseSchedule={workflowId =>
            pauseSchedule.mutate({ projectId, workflowId })
          }
          pauseSchedulePending={pauseSchedule.isPending}
          onDeleteSchedule={workflowId =>
            deleteSchedule.mutateAsync({ projectId, workflowId })
          }
          deleteSchedulePending={deleteSchedule.isPending}
        />
      )}
      {!selectedQueryLoading &&
        !selectedQueryError &&
        (tab === "sources" || tab === "assets") && (
          <StructuredResourceForm
            tab={tab}
            projectId={projectId}
            sources={(resources.data?.sources ?? []) as any[]}
            createSource={createSource}
            createAsset={createAsset}
          />
        )}
      {!selectedQueryLoading && !selectedQueryError && tab === "sources" && (
        <ResourceTable
          columns={["名称", "类型", "状态", "最近校验", "操作"]}
          empty="尚未配置数据源。"
          mobileCards={(resources.data?.sources ?? []).map((source: any) => (
            <ResourceTableCard
              key={source.id}
              primary={source.name}
              secondary={source.connection?.description || "连接元数据已隐藏"}
              status={<State value={source.status} />}
              fields={[
                { label: "类型", value: source.sourceType },
                {
                  label: "最近校验",
                  value: source.lastTestedAt
                    ? new Date(source.lastTestedAt).toLocaleString("zh-CN")
                    : "—",
                },
              ]}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="aiflow-type-control min-h-11 flex-1"
                    disabled={testSource.isPending}
                    onClick={() =>
                      testSource.mutate({ projectId, sourceId: source.id })
                    }
                  >
                    {source.sourceType === "inline" ? "校验登记" : "测试连接"}
                  </Button>
                  <DeleteButton
                    actionLabel="删除数据源"
                    resourceName={source.name}
                    visibleLabel="删除数据源"
                    onDelete={() =>
                      removeSource.mutateAsync({
                        projectId,
                        sourceId: source.id,
                      })
                    }
                  />
                </>
              }
            />
          ))}
        >
          {(resources.data?.sources ?? []).map((source: any) => (
            <tr key={source.id}>
              <Cell
                primary={source.name}
                secondary={source.connection?.description || "连接元数据已隐藏"}
              />
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {source.sourceType}
              </td>
              <td className="px-4 py-3">
                <State value={source.status} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {source.lastTestedAt
                  ? new Date(source.lastTestedAt).toLocaleString("zh-CN")
                  : "—"}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="aiflow-type-control mr-2 h-10"
                  disabled={testSource.isPending}
                  onClick={() =>
                    testSource.mutate({ projectId, sourceId: source.id })
                  }
                >
                  {source.sourceType === "inline" ? "校验登记" : "测试连接"}
                </Button>
                <DeleteButton
                  actionLabel="删除数据源"
                  resourceName={source.name}
                  onDelete={() =>
                    removeSource.mutateAsync({ projectId, sourceId: source.id })
                  }
                />
              </td>
            </tr>
          ))}
        </ResourceTable>
      )}
      {!selectedQueryLoading && !selectedQueryError && tab === "assets" && (
        <ResourceTable
          columns={["资源名称", "类型 / 数据源", "结构 / 样本", "状态", "操作"]}
          empty="尚无已探查资源。"
          mobileCards={(resources.data?.assets ?? []).map((asset: any) => (
            <ResourceTableCard
              key={asset.id}
              primary={asset.name}
              secondary={asset.sourceName || "未关联数据源"}
              status={<State value={asset.status} />}
              fields={[
                { label: "资源类型", value: asset.assetType },
                {
                  label: "结构 / 样本",
                  value: `${asset.schema?.length ?? 0} 字段 · ${asset.sample?.length ?? 0} 行样本`,
                },
              ]}
              actions={
                <>
                  <ResourceDetails asset={asset} />
                  <DeleteButton
                    actionLabel="删除资源"
                    resourceName={asset.name}
                    visibleLabel="删除资源"
                    onDelete={() =>
                      removeAsset.mutateAsync({ projectId, assetId: asset.id })
                    }
                  />
                </>
              }
            />
          ))}
        >
          {(resources.data?.assets ?? []).map((asset: any) => (
            <tr key={asset.id}>
              <Cell
                primary={asset.name}
                secondary={asset.sourceName || "未关联数据源"}
              />
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {asset.assetType}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {asset.schema?.length ?? 0} 字段 · {asset.sample?.length ?? 0}{" "}
                行样本
              </td>
              <td className="px-4 py-3">
                <State value={asset.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <ResourceDetails asset={asset} />
                <DeleteButton
                  actionLabel="删除资源"
                  resourceName={asset.name}
                  onDelete={() =>
                    removeAsset.mutateAsync({ projectId, assetId: asset.id })
                  }
                />
              </td>
            </tr>
          ))}
        </ResourceTable>
      )}
      {!selectedQueryLoading && !selectedQueryError && tab === "udfs" && (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
          <ResourceForm
            title="注册函数"
            description="绑定内置实现并审核后可执行数据转换；其他类型目前仅登记元数据，尚不能执行。"
            onSubmit={() =>
              createUdf.mutateAsync({
                projectId,
                name: udfForm.name,
                udfType: udfForm.udfType,
                description: udfForm.description || undefined,
                returnType:
                  udfForm.udfType === "javascript"
                    ? "string"
                    : udfForm.returnType || undefined,
                artifactRef:
                  udfForm.udfType === "javascript"
                    ? udfForm.artifactRef
                    : undefined,
              })
            }
            pending={createUdf.isPending}
          >
            <ResourceField label="函数名称">
              <Input
                placeholder="例如：maskSensitivePhone"
                value={udfForm.name}
                onChange={event =>
                  setUdfForm({ ...udfForm, name: event.target.value })
                }
                required
              />
            </ResourceField>
            <ResourceField label="函数类型">
              <select
                className="h-9 w-full min-w-0 rounded border border-border bg-card px-2 text-sm"
                value={udfForm.udfType}
                onChange={event =>
                  setUdfForm({
                    ...udfForm,
                    udfType: event.target.value as typeof udfForm.udfType,
                  })
                }
              >
                <option value="javascript">内置文本处理</option>
                <option value="sql">SQL（仅登记）</option>
                <option value="python">Python（仅登记）</option>
                <option value="jar">JAR（仅登记）</option>
              </select>
            </ResourceField>
            {udfForm.udfType === "javascript" && (
              <ResourceField label="处理实现">
                <select
                  aria-label="函数处理实现"
                  className="h-9 w-full rounded border border-border bg-card px-2 text-sm"
                  value={udfForm.artifactRef}
                  onChange={event =>
                    setUdfForm({ ...udfForm, artifactRef: event.target.value })
                  }
                >
                  {builtinDataFunctions.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </ResourceField>
            )}
            <ResourceField label="函数说明">
              <Input
                placeholder="说明函数用途和适用范围"
                value={udfForm.description}
                onChange={event =>
                  setUdfForm({ ...udfForm, description: event.target.value })
                }
              />
            </ResourceField>
            <ResourceField label="返回类型">
              <Input
                placeholder="例如：string"
                disabled={udfForm.udfType === "javascript"}
                value={
                  udfForm.udfType === "javascript"
                    ? "string"
                    : udfForm.returnType
                }
                onChange={event =>
                  setUdfForm({ ...udfForm, returnType: event.target.value })
                }
              />
            </ResourceField>
          </ResourceForm>
          <ResourceTable
            columns={["函数", "类型", "描述", "状态", "操作"]}
            empty="尚未注册函数。"
            mobileCards={(resources.data?.udfs ?? []).map((udf: any) => (
              <ResourceTableCard
                key={udf.id}
                primary={udf.name}
                secondary={udf.returnType || "未声明返回类型"}
                status={<State value={udf.status} />}
                fields={[
                  {
                    label: "函数类型",
                    value: dataFunctionTypeLabel(udf.udfType, udf.artifactRef),
                  },
                  { label: "说明", value: udf.description || "—" },
                ]}
                actions={
                  <DeleteButton
                    actionLabel="删除函数"
                    resourceName={udf.name}
                    visibleLabel="删除函数"
                    onDelete={() =>
                      removeUdf.mutateAsync({ projectId, udfId: udf.id })
                    }
                  />
                }
              />
            ))}
          >
            {(resources.data?.udfs ?? []).map((udf: any) => (
              <tr key={udf.id}>
                <Cell
                  primary={udf.name}
                  secondary={udf.returnType || "未声明返回类型"}
                />
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {dataFunctionTypeLabel(udf.udfType, udf.artifactRef)}
                </td>
                <td className="max-w-[300px] px-4 py-3">
                  <p
                    className="aiflow-type-body line-clamp-2 break-words text-muted-foreground"
                    title={udf.description || undefined}
                  >
                    {udf.description || "—"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <State value={udf.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <DeleteButton
                    actionLabel="删除函数"
                    resourceName={udf.name}
                    onDelete={() =>
                      removeUdf.mutateAsync({ projectId, udfId: udf.id })
                    }
                  />
                </td>
              </tr>
            ))}
          </ResourceTable>
        </section>
      )}
      {!selectedQueryLoading && !selectedQueryError && tab === "tags" && (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
          <ResourceForm
            title="新建标签"
            description="项目级数据标签用于资源分类，不会跨越项目可见范围。"
            onSubmit={() => createTag.mutateAsync({ projectId, name: tagName })}
            pending={createTag.isPending}
          >
            <ResourceField label="标签名称">
              <Input
                placeholder="例如：核心业务指标"
                value={tagName}
                onChange={event => setTagName(event.target.value)}
                required
              />
            </ResourceField>
          </ResourceForm>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap gap-2">
              {(resources.data?.tags ?? []).map((tag: any) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
                  style={{
                    backgroundColor: `${tag.color}18`,
                    color: tag.color,
                  }}
                >
                  <i
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                  <DeleteButton
                    actionLabel="删除标签"
                    resourceName={tag.name}
                    onDelete={() =>
                      removeTag.mutateAsync({ projectId, tagId: tag.id })
                    }
                  />
                </span>
              ))}
              {!(resources.data?.tags ?? []).length && (
                <span className="text-sm text-muted-foreground">
                  尚未创建标签。
                </span>
              )}
            </div>
          </div>
        </section>
      )}
      {!selectedQueryLoading && !selectedQueryError && tab === "plugins" && (
        <section className="grid min-w-0 gap-4 xl:grid-cols-[350px_minmax(0,1fr)]">
          <ResourceForm
            title="登记项目插件"
            description="仅保存已批准插件的配置元数据；插件运行仍受服务端安全策略控制。"
            onSubmit={() =>
              createPlugin.mutateAsync({
                projectId,
                name: pluginForm.name,
                pluginType: pluginForm.pluginType,
                version: pluginForm.version,
                config: {},
              })
            }
            pending={createPlugin.isPending}
          >
            <ResourceField label="插件名称">
              <Input
                placeholder="例如：order-transformer"
                value={pluginForm.name}
                onChange={event =>
                  setPluginForm({ ...pluginForm, name: event.target.value })
                }
                required
              />
            </ResourceField>
            <ResourceField label="插件类型">
              <select
                className="h-9 w-full min-w-0 rounded border border-border bg-card px-2 text-sm"
                value={pluginForm.pluginType}
                onChange={event =>
                  setPluginForm({
                    ...pluginForm,
                    pluginType: event.target
                      .value as typeof pluginForm.pluginType,
                  })
                }
              >
                <option value="transform">转换</option>
                <option value="connector">连接器</option>
                <option value="visualization">可视化</option>
              </select>
            </ResourceField>
            <ResourceField label="版本">
              <Input
                placeholder="例如：1.0.0"
                value={pluginForm.version}
                onChange={event =>
                  setPluginForm({ ...pluginForm, version: event.target.value })
                }
                required
              />
            </ResourceField>
          </ResourceForm>
          <ResourceTable
            columns={["插件", "类型", "版本", "状态", "操作"]}
            empty="尚未登记项目插件。"
            mobileCards={(resources.data?.plugins ?? []).map((plugin: any) => (
              <ResourceTableCard
                key={plugin.id}
                primary={plugin.name}
                secondary="项目级插件"
                status={<State value={plugin.status} />}
                fields={[
                  { label: "插件类型", value: plugin.pluginType },
                  { label: "版本", value: plugin.version },
                ]}
                actions={
                  <DeleteButton
                    actionLabel="删除插件"
                    resourceName={plugin.name}
                    visibleLabel="删除插件"
                    onDelete={() =>
                      removePlugin.mutateAsync({
                        projectId,
                        pluginId: plugin.id,
                      })
                    }
                  />
                }
              />
            ))}
          >
            {(resources.data?.plugins ?? []).map((plugin: any) => (
              <tr key={plugin.id}>
                <Cell primary={plugin.name} secondary="项目级插件" />
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {plugin.pluginType}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {plugin.version}
                </td>
                <td className="px-4 py-3">
                  <State value={plugin.status} />
                </td>
                <td className="px-4 py-3 text-right">
                  <DeleteButton
                    actionLabel="删除插件"
                    resourceName={plugin.name}
                    onDelete={() =>
                      removePlugin.mutateAsync({
                        projectId,
                        pluginId: plugin.id,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </ResourceTable>
        </section>
      )}
    </div>
  );
}

function DataflowOperationList({
  runs,
  projectName,
}: {
  runs: any[];
  projectName: string;
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const visibleRuns = runs.filter(run =>
    `${run.id} ${run.workflowName} ${run.triggerName || ""} ${run.triggerType || ""}`
      .toLowerCase()
      .includes(keyword.trim().toLowerCase())
  );
  const expandedRun = runs.find(run => run.id === expandedRunId);
  const detail = trpc.data.runDetail.useQuery(
    {
      projectId: String(expandedRun?.projectId ?? ""),
      runId: expandedRunId ?? "",
    },
    {
      enabled: Boolean(expandedRun),
      refetchInterval: query =>
        runDetailRefreshInterval(
          query.state.data?.status,
          query.state.status === "error"
        ),
      refetchIntervalInBackground: false,
    }
  );
  return (
    <section
      dataflow-run-list=""
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="aiflow-type-section-title font-semibold text-foreground">
            运行记录与审计
          </h2>
          <p className="aiflow-type-body mt-1 max-w-2xl text-muted-foreground">
            {projectName} · 当前接口最多返回最近 30
            条；关键词筛选仅覆盖已加载记录。
          </p>
        </div>
        <div className="grid min-w-0 gap-2 sm:flex sm:items-center">
          <Input
            className="aiflow-type-body h-11 w-full min-w-0 sm:h-9 sm:w-[280px] xl:h-8 xl:min-w-[220px]"
            aria-label="搜索已加载的运行记录"
            placeholder="搜索流程、触发人或运行 ID"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
          <span className="aiflow-type-meta w-fit whitespace-nowrap rounded bg-muted px-2 py-1 text-muted-foreground">
            {visibleRuns.length} / {runs.length} 条匹配
          </span>
        </div>
      </div>
      {visibleRuns.length > 0 ? (
        <>
          <div
            dataflow-run-cards=""
            role="list"
            aria-label="数据流运行记录"
            className="divide-y divide-border xl:hidden"
          >
            {visibleRuns.map(run => (
              <article role="listitem" key={run.id} className="space-y-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="aiflow-type-card-title break-words font-medium text-foreground">
                      {run.workflowName}
                    </h3>
                    <p className="aiflow-type-meta mt-1 break-words text-muted-foreground">
                      {projectName}
                    </p>
                  </div>
                  <State value={run.status} />
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-3">
                  <div className="min-w-0">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      操作 ID
                    </dt>
                    <dd className="aiflow-type-code mt-1 break-all font-mono text-foreground">
                      {String(run.id).slice(0, 8)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      触发方式 / 人员
                    </dt>
                    <dd className="aiflow-type-body mt-1 break-words text-foreground">
                      {run.triggerType === "schedule" ? "托管调度" : "手动运行"}{" "}
                      · {run.triggerName || "系统用户"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      启动时间
                    </dt>
                    <dd className="aiflow-type-meta mt-1 break-words text-foreground">
                      {formatDataflowTime(run.startedAt ?? run.createdAt)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="aiflow-type-meta text-muted-foreground">
                      结束时间
                    </dt>
                    <dd className="aiflow-type-meta mt-1 break-words text-foreground">
                      {formatDataflowTime(run.finishedAt)}
                    </dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  className="aiflow-type-control min-h-11 w-full text-aiflow-info"
                  aria-expanded={expandedRunId === run.id}
                  onClick={() =>
                    setExpandedRunId(current =>
                      current === run.id ? null : run.id
                    )
                  }
                >
                  {expandedRunId === run.id ? "收起详情" : "查看审计详情"}
                </Button>
              </article>
            ))}
          </div>
          <div
            dataflow-run-table=""
            className="hidden overflow-x-auto xl:block"
          >
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-muted text-sm font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">操作 ID</th>
                  <th className="px-4 py-3 whitespace-nowrap">业务名称</th>
                  <th className="px-4 py-3 whitespace-nowrap">流程名称</th>
                  <th className="px-4 py-3 whitespace-nowrap">启动时间</th>
                  <th className="px-4 py-3 whitespace-nowrap">结束时间</th>
                  <th className="px-4 py-3 whitespace-nowrap">状态</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map(run => (
                  <tr
                    key={run.id}
                    className="border-t border-border hover:bg-aiflow-info-surface/40"
                  >
                    <td className="aiflow-type-code px-4 py-3 font-mono text-muted-foreground">
                      {String(run.id).slice(0, 8)}
                    </td>
                    <td className="aiflow-type-body px-4 py-3 text-muted-foreground">
                      {projectName}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {run.workflowName}
                      </p>
                      <p className="aiflow-type-meta mt-0.5 text-muted-foreground">
                        {run.triggerType === "schedule"
                          ? "托管调度"
                          : "手动运行"}{" "}
                        · {run.triggerName || "系统用户"}
                      </p>
                    </td>
                    <td className="aiflow-type-meta px-4 py-3 text-muted-foreground">
                      {formatDataflowTime(run.startedAt ?? run.createdAt)}
                    </td>
                    <td className="aiflow-type-meta px-4 py-3 text-muted-foreground">
                      {formatDataflowTime(run.finishedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <State value={run.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-aiflow-info"
                        onClick={() =>
                          setExpandedRunId(current =>
                            current === run.id ? null : run.id
                          )
                        }
                      >
                        {expandedRunId === run.id ? "收起详情" : "查看审计"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div
          role="status"
          className="px-4 py-10 text-center text-sm text-muted-foreground"
        >
          {keyword ? "未找到匹配的运行记录。" : "当前项目尚无数据流运行记录。"}
        </div>
      )}
      {expandedRun && (
        <div className="border-t border-border bg-muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">
                运行详情 · {String(expandedRun.id).slice(0, 8)}
              </p>
              <p className="aiflow-type-meta mt-1 text-muted-foreground">
                触发人：{expandedRun.triggerName || "系统用户"} · 耗时：
                {expandedRun.durationMs === null ||
                expandedRun.durationMs === undefined
                  ? "—"
                  : `${expandedRun.durationMs} ms`}
              </p>
            </div>
            <State value={expandedRun.status} />
          </div>
          <details className="mt-3 min-w-0 rounded border border-border bg-card p-3">
            <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center font-medium text-foreground">
              查看运行结果或报错信息
            </summary>
            {detail.isError ? (
              <div
                role="alert"
                className="mt-3 space-y-2 text-sm text-destructive"
              >
                <p>读取运行详情失败：{detail.error.message}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  重新读取详情
                </Button>
              </div>
            ) : detail.isLoading ? (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                正在读取运行详情…
              </p>
            ) : detail.data ? (
              <DataflowRunOutput key={expandedRun.id} run={detail.data} />
            ) : (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                运行记录不存在或已无法访问。
              </p>
            )}
          </details>
        </div>
      )}
    </section>
  );
}

function parseDataflowResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatDataflowValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return String(value);
  return text.length > 96 ? `${text.slice(0, 93)}…` : text;
}

function DataflowRunOutput({ run }: { run: any }) {
  const [resultPageIndex, setResultPageIndex] = useState(0);
  const [selectedTerminal, setSelectedTerminal] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const rawResult = run.output ??
    run.error ?? { message: "当前运行未生成额外输出。" };
  const result = parseDataflowResult(rawResult) as any;
  const nodes =
    Array.isArray(run.nodeRuns) && run.nodeRuns.length > 0
      ? run.nodeRuns
      : Array.isArray(result?.nodes)
        ? result.nodes
        : [];
  const dataResults = dataflowTerminalResults(result);
  const terminal = dataResults[selectedTerminal];
  const lastNode = [...(Array.isArray(result?.nodes) ? result.nodes : [])]
    .reverse()
    .find((node: any) => Array.isArray(node?.output?.rows));
  const terminalRows = terminal?.rows ?? lastNode?.output?.rows ?? [];
  const preview = dataflowResultPage(terminalRows, resultPageIndex);
  const previewRows = preview.rows;
  const columns = useMemo(
    () => dataflowResultColumns(terminalRows),
    [terminalRows]
  );
  const rowCount = terminal ? terminalRows.length : (lastNode?.rowCount ?? "—");
  const errorMessage =
    result && typeof result === "object" && "message" in result
      ? String(result.message)
      : typeof result === "string"
        ? result
        : "运行失败，展开原始数据可查看完整错误信息。";
  const visibleErrorMessage =
    errorMessage.length > 240
      ? `${errorMessage.slice(0, 237)}…（完整错误见原始数据）`
      : errorMessage;
  const rawText = useMemo(() => {
    if (!showRaw) return "";
    return typeof rawResult === "string"
      ? rawResult
      : (JSON.stringify(rawResult, null, 2) ?? String(rawResult));
  }, [rawResult, showRaw]);

  return (
    <div dataflow-output-summary="" className="mt-3 space-y-3">
      {dataResults.length > 1 && (
        <label className="aiflow-type-control flex flex-wrap items-center gap-2">
          结果集
          <select
            aria-label="选择运行监控结果集"
            className="h-11 max-w-full rounded-md border border-border bg-background px-3 min-[1024px]:h-9"
            value={selectedTerminal}
            onChange={event => {
              setSelectedTerminal(Number(event.target.value));
              setResultPageIndex(0);
            }}
          >
            {dataResults.map((item, index) => (
              <option key={index} value={index}>
                {item.name} · {item.rows.length} 行
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <p className="aiflow-type-meta text-muted-foreground">执行节点</p>
          <p className="aiflow-type-body mt-1 font-semibold text-foreground">
            {nodes.length || "—"}
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <p className="aiflow-type-meta text-muted-foreground">最终结果行数</p>
          <p className="aiflow-type-body mt-1 font-semibold text-foreground">
            {rowCount}
          </p>
        </div>
        <div className="col-span-2 rounded-md border border-border bg-muted px-3 py-2 sm:col-span-1">
          <p className="aiflow-type-meta text-muted-foreground">运行状态</p>
          <div className="mt-1">
            <State value={run.status} />
          </div>
        </div>
      </div>

      {run.error && (
        <div
          role="alert"
          className="rounded-md border border-aiflow-danger-border bg-aiflow-danger-surface px-3 py-2 text-sm text-aiflow-danger"
        >
          {visibleErrorMessage}
        </div>
      )}

      {columns.length > 0 ? (
        <section className="min-w-0 rounded-md border border-border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="aiflow-type-body font-semibold text-foreground">
              最终结果预览
              {terminal && dataResults.length === 1 && (
                <span className="ml-2 font-normal text-muted-foreground">
                  {terminal.name}
                </span>
              )}
            </h3>
            <span className="aiflow-type-meta text-muted-foreground">
              第 {preview.page + 1} / {preview.pageCount} 页 · 每页 10 行 · 共{" "}
              {terminalRows.length} 行
            </span>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            共 {columns.length} 个字段；可横向滚动查看全部字段。
          </p>
          <div className="max-w-full overflow-x-auto">
            <table className="w-full min-w-[360px] text-left">
              <thead className="bg-muted text-sm text-muted-foreground">
                <tr>
                  {columns.map(column => (
                    <th
                      key={column}
                      className="aiflow-type-meta whitespace-nowrap px-2 py-1.5 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row: any, rowIndex: number) => (
                  <tr key={rowIndex} className="border-t border-border">
                    {columns.map(column => (
                      <td
                        key={column}
                        className="aiflow-type-meta max-w-48 truncate px-2 py-1.5 text-foreground"
                      >
                        {formatDataflowValue(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="结果上一页"
              disabled={preview.page === 0}
              onClick={() => setResultPageIndex(preview.page - 1)}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="结果下一页"
              disabled={preview.page + 1 >= preview.pageCount}
              onClick={() => setResultPageIndex(preview.page + 1)}
            >
              下一页
            </Button>
          </div>
        </section>
      ) : (
        !run.error && (
          <p className="aiflow-type-body rounded-md border border-border bg-card px-3 py-3 text-muted-foreground">
            {nodes.length > 0
              ? "本次运行没有可展示的终端结果行。"
              : "暂无可结构化展示的运行结果。"}
          </p>
        )
      )}

      {nodes.length > 0 && (
        <details
          open={run.status === "failed"}
          className="min-w-0 rounded border border-border bg-card px-3"
        >
          <summary className="aiflow-type-control flex min-h-11 cursor-pointer items-center font-medium text-foreground">
            节点执行摘要（{nodes.length}）
          </summary>
          <div className="mt-1 max-h-60 overflow-auto pb-3">
            <table className="w-full min-w-[360px] text-left">
              <thead className="sticky top-0 bg-muted text-sm text-muted-foreground">
                <tr>
                  <th className="aiflow-type-meta px-2 py-1.5 font-medium">
                    节点
                  </th>
                  <th className="aiflow-type-meta px-2 py-1.5 font-medium">
                    类型
                  </th>
                  <th className="aiflow-type-meta px-2 py-1.5 text-right font-medium">
                    输出行数
                  </th>
                  <th className="aiflow-type-meta px-2 py-1.5 font-medium">
                    状态与错误
                  </th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node: any, index: number) => (
                  <tr
                    key={node.nodeId ?? index}
                    className="border-t border-border"
                  >
                    <td className="aiflow-type-meta px-2 py-1.5 font-mono text-foreground">
                      {node.nodeId ?? `节点 ${index + 1}`}
                    </td>
                    <td className="aiflow-type-meta px-2 py-1.5 text-muted-foreground">
                      {workflowNodeTypeLabel(node.nodeType)}
                    </td>
                    <td className="aiflow-type-meta px-2 py-1.5 text-right tabular-nums text-foreground">
                      {node.rowCount ?? "—"}
                    </td>
                    <td className="aiflow-type-meta px-2 py-1.5">
                      <State value={node.status ?? "success"} />
                      {node.error && (
                        <p className="mt-1 max-w-sm whitespace-pre-wrap break-words text-destructive">
                          {String(node.error.message ?? "节点执行失败")}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="min-w-0 rounded border border-border bg-card px-3">
        <button
          type="button"
          aria-expanded={showRaw}
          className="aiflow-type-control flex min-h-11 w-full items-center text-left font-medium text-foreground"
          onClick={() => setShowRaw(value => !value)}
        >
          {showRaw ? "收起完整原始数据（JSON）" : "查看完整原始数据（JSON）"}
        </button>
        {showRaw && (
          <pre className="aiflow-type-code my-2 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 font-mono text-emerald-200">
            {rawText}
          </pre>
        )}
      </div>
    </div>
  );
}

function ResourceForm({
  title,
  description,
  children,
  onSubmit,
  pending,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  onSubmit: () => Promise<unknown>;
  pending: boolean;
}) {
  if (title === "添加数据源" || title === "资源探查结果") return null;
  const [open, setOpen] = useState(false);
  const submit = async () => {
    try {
      await onSubmit();
      setOpen(false);
    } catch {
      /* mutation keeps the dialog open and reports its own error */
    }
  };
  return (
    <div className="grid h-fit min-w-0 gap-3 rounded-lg border border-aiflow-info-border bg-card p-4 shadow-sm">
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          {description}
        </p>
      </div>
      <Button
        type="button"
        className="h-11 w-fit bg-blue-600 text-white shadow-2xs hover:bg-blue-700 sm:h-9"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} />
        {title}
      </Button>
      <CreationDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        submitLabel="保存"
        pending={pending}
        onSubmit={submit}
      >
        {children}
      </CreationDialog>
    </div>
  );
}

function ResourceField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="aiflow-type-control grid min-w-0 gap-1 font-medium text-muted-foreground [&_input]:h-11 [&_select]:h-11 sm:[&_input]:h-10 sm:[&_select]:h-10">
      <span>{label}</span>
      {children}
    </label>
  );
}
type DataflowSection = "overview" | "runs" | "schedules";
type DataflowScheduleForm = {
  workflowId: string;
  cronExpression: string;
};

function DataflowWorkspace({
  projectName,
  resources,
  flows,
  publishedFlows,
  runs,
  schedules,
  schedulesByWorkflow,
  section,
  setSection,
  activeFlowId,
  setActiveFlowId,
  scheduleForm,
  setScheduleForm,
  onOpenWorkflow,
  onOpenResourceTab,
  onRunFlow,
  runPending,
  onRefresh,
  refreshPending,
  autoRefreshActive,
  onSaveSchedule,
  saveSchedulePending,
  onActivateSchedule,
  activateSchedulePending,
  onPauseSchedule,
  pauseSchedulePending,
  onDeleteSchedule,
  deleteSchedulePending,
}: {
  projectName: string;
  resources: any;
  flows: any[];
  publishedFlows: any[];
  runs: any[];
  schedules: any[];
  schedulesByWorkflow: Map<string, any>;
  section: DataflowSection;
  setSection: (section: DataflowSection) => void;
  activeFlowId: string;
  setActiveFlowId: (flowId: string) => void;
  scheduleForm: DataflowScheduleForm;
  setScheduleForm: (form: DataflowScheduleForm) => void;
  onOpenWorkflow: (workflowId: string) => void;
  onOpenResourceTab: (tab: Tab) => void;
  onRunFlow: (workflowId: string) => void;
  runPending: boolean;
  onRefresh: () => void;
  refreshPending: boolean;
  autoRefreshActive: boolean;
  onSaveSchedule: () => void;
  saveSchedulePending: boolean;
  onActivateSchedule: (workflowId: string) => void;
  activateSchedulePending: boolean;
  onPauseSchedule: (workflowId: string) => void;
  pauseSchedulePending: boolean;
  onDeleteSchedule: (workflowId: string) => Promise<unknown>;
  deleteSchedulePending: boolean;
}) {
  const flow = flows.find(item => item.id === activeFlowId) ?? flows[0];
  const latestRun = flow
    ? runs.find(item => item.workflowId === flow.id)
    : runs[0];
  const schedule = flow ? schedulesByWorkflow.get(flow.id) : undefined;
  const sections = [
    { id: "overview" as const, label: "概览", icon: Database },
    { id: "runs" as const, label: "运行记录", icon: FileText },
    { id: "schedules" as const, label: "调度计划", icon: CalendarClock },
  ];
  const assets = resources?.assets ?? [];
  const udfs = resources?.udfs ?? [];
  const assetPreview = assets.slice(0, 5);
  const udfPreview = udfs.slice(0, 5);

  return (
    <section dataflow-workspace="" className="grid gap-4">
      <div
        role="note"
        dataflow-experimental-notice=""
        className="flex flex-col gap-1 rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface px-3 py-2 text-sm leading-5 text-amber-900 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="font-semibold">实验功能</span>
        <span id="dataflow-execution-warning">
          生产
          Connector、外部存储和真实重启验收尚未完成；当前运行能力不能视为生产就绪。
          执行会创建真实运行，可能读取或写入外部数据。
        </span>
      </div>

      <header className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            {projectName} · 数据流
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            在流程设计中心编辑定义；在此查看运行、资源引用和调度状态。
          </p>
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
            disabled={refreshPending}
            onClick={onRefresh}
          >
            <RefreshCw
              size={14}
              className={refreshPending ? "animate-spin" : undefined}
            />
            {refreshPending ? "刷新中" : "刷新状态"}
          </Button>
          {flows.length > 0 && (
            <select
              aria-label="当前数据流"
              className="col-span-2 h-11 w-full min-w-0 max-w-full rounded-md border border-border bg-card px-2 text-sm sm:col-span-1 sm:h-9 sm:min-w-48 sm:w-auto"
              value={flow?.id ?? ""}
              onChange={event => setActiveFlowId(event.target.value)}
            >
              {flows.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} ·{" "}
                  {item.status === "published" ? "已发布" : "草稿"}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full sm:h-8 sm:min-h-0 sm:w-auto"
            disabled={!flow}
            onClick={() => flow && onOpenWorkflow(flow.id)}
          >
            打开设计器
          </Button>
          <Button
            type="button"
            size="sm"
            className="min-h-11 w-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 sm:h-8 sm:min-h-0 sm:w-auto"
            disabled={!flow || flow.status !== "published" || runPending}
            aria-describedby="dataflow-execution-warning"
            title={
              flow?.status === "published"
                ? "执行真实数据流；可能读取或写入外部数据"
                : "仅已发布数据流可运行"
            }
            onClick={() => flow && onRunFlow(flow.id)}
          >
            {runPending && <Loader2 className="animate-spin" size={14} />}
            <Play size={14} />
            运行数据流
          </Button>
        </div>
      </header>

      <p
        role="status"
        aria-live="polite"
        className="aiflow-type-meta text-muted-foreground"
      >
        {autoRefreshActive
          ? "运行及调度状态自动刷新中；后台页面暂停自动刷新。"
          : "当前没有执行中的运行或已启用计划，可手动刷新状态。"}
      </p>

      <nav
        aria-label="数据流工作区视图"
        className="grid grid-cols-2 gap-1 border-b border-border md:flex md:flex-wrap md:gap-2"
      >
        {sections.map(item => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? "page" : undefined}
            onClick={() => setSection(item.id)}
            className={`aiflow-type-control inline-flex min-h-11 min-w-0 items-center justify-center gap-2 border-b-2 px-2 py-2 transition-colors last:col-span-2 md:min-h-0 md:justify-start md:px-3 ${section === item.id ? "border-blue-600 font-semibold text-aiflow-info" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <item.icon size={15} />
            {item.label}
            {item.id === "runs" && (
              <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                {runs.length}
              </span>
            )}
            {item.id === "schedules" && (
              <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">
                {schedules.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {section === "overview" &&
        (flows.length === 0 ? (
          <div
            role="status"
            className="rounded-lg border border-dashed border-input bg-card px-5 py-8 text-center"
          >
            <p className="text-sm font-medium text-foreground">
              尚未创建数据流程
            </p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              请先在流程设计中心创建并发布数据流；发布前不会显示运行和调度操作。
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="aiflow-type-meta text-muted-foreground">
                  当前数据流
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {flow?.name}
                  </p>
                  {flow && <State value={flow.status} />}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="aiflow-type-meta text-muted-foreground">
                  最近运行
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {latestRun ? (
                    <>
                      <State value={latestRun.status} /> ·{" "}
                      {formatDataflowTime(
                        latestRun.finishedAt ??
                          latestRun.startedAt ??
                          latestRun.createdAt
                      )}
                    </>
                  ) : (
                    "尚无运行记录"
                  )}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="aiflow-type-meta text-muted-foreground">
                  托管计划
                </p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {schedule
                    ? `${schedule.status === "active" ? "已启用" : "草稿 / 已暂停"} · ${schedule.cronExpression} UTC`
                    : "未配置"}
                </p>
              </div>
            </div>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="aiflow-type-section-title font-semibold text-foreground">
                    流程摘要
                  </h3>
                  <p className="mt-1 text-sm text-foreground">{flow?.name}</p>
                </div>
                {flow && <State value={flow.status} />}
              </div>
              <div className="aiflow-type-meta mt-3 flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
                <span>画布节点：{flow?.definition?.nodes?.length ?? 0}</span>
                <span>累计运行：{flow?.dataflowRunCount ?? 0}</span>
                <span>项目数据流：{flows.length}</span>
              </div>
              <p className="aiflow-type-body mt-3 border-t border-border pt-3 text-muted-foreground">
                资源中心不提供模拟算子按钮。节点编排、保存和画布导出均在受权限控制的流程设计器中完成。
              </p>
            </section>

            <details className="rounded-lg border border-border bg-card">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-foreground">
                <span>资源引用</span>
                <span className="aiflow-type-meta font-normal text-muted-foreground">
                  数据资源 {assets.length} · 函数 {udfs.length}
                </span>
              </summary>
              <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
                <div>
                  <h4 className="aiflow-type-section-title font-semibold text-foreground">
                    数据资源
                  </h4>
                  {assets.length > 0 ? (
                    <ul className="mt-2 grid gap-1">
                      {assetPreview.map((asset: any) => (
                        <li
                          key={asset.id}
                          className="aiflow-type-body break-words rounded bg-muted px-2 py-1.5 text-muted-foreground"
                        >
                          {asset.name} · {asset.assetType}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="aiflow-type-body mt-2 text-muted-foreground">
                      尚无可引用的数据资源。
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    {assets.length > assetPreview.length && (
                      <span className="aiflow-type-meta text-muted-foreground">
                        另有 {assets.length - assetPreview.length} 项
                      </span>
                    )}
                    <button
                      type="button"
                      className="aiflow-type-control inline-flex min-h-11 items-center font-medium text-aiflow-info hover:underline md:min-h-0"
                      onClick={() => onOpenResourceTab("assets")}
                    >
                      查看资源目录
                    </button>
                  </div>
                </div>
                <div>
                  <h4 className="aiflow-type-section-title font-semibold text-foreground">
                    函数资源
                  </h4>
                  {udfs.length > 0 ? (
                    <ul className="mt-2 grid gap-1">
                      {udfPreview.map((udf: any) => (
                        <li
                          key={udf.id}
                          className="aiflow-type-body break-words rounded bg-muted px-2 py-1.5 text-muted-foreground"
                        >
                          {udf.name} ·{" "}
                          {dataFunctionTypeLabel(udf.udfType, udf.artifactRef)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="aiflow-type-body mt-2 text-muted-foreground">
                      尚无可引用的函数资源。
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    {udfs.length > udfPreview.length && (
                      <span className="aiflow-type-meta text-muted-foreground">
                        另有 {udfs.length - udfPreview.length} 项
                      </span>
                    )}
                    <button
                      type="button"
                      className="aiflow-type-control inline-flex min-h-11 items-center font-medium text-aiflow-info hover:underline md:min-h-0"
                      onClick={() => onOpenResourceTab("udfs")}
                    >
                      查看函数目录
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        ))}

      {section === "runs" && (
        <DataflowOperationList runs={runs} projectName={projectName} />
      )}

      {section === "schedules" && (
        <div className="grid gap-3">
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="aiflow-type-section-title font-semibold text-foreground">
              新增调度草稿
            </h3>
            <p className="aiflow-type-body mt-1 text-muted-foreground">
              使用六段 UTC 表达式：秒 分 时 日 月
              星期。保存只创建草稿；启用后会按计划真实运行数据流，可能产生外部系统读写副作用。
            </p>
            {publishedFlows.length > 0 ? (
              <form
                className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)_auto] sm:items-end"
                onSubmit={event => {
                  event.preventDefault();
                  onSaveSchedule();
                }}
              >
                <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
                  已发布数据流
                  <select
                    className="h-11 rounded-md border border-border bg-card px-2 text-sm font-normal sm:h-9"
                    value={scheduleForm.workflowId}
                    onChange={event =>
                      setScheduleForm({
                        ...scheduleForm,
                        workflowId: event.target.value,
                      })
                    }
                    required
                  >
                    <option value="">选择数据流</option>
                    {publishedFlows.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="aiflow-type-control grid gap-1 font-medium text-muted-foreground">
                  Cron 表达式（UTC）
                  <Input
                    aria-label="Cron 表达式（UTC）"
                    className="h-11 font-mono text-xs font-normal sm:h-9"
                    value={scheduleForm.cronExpression}
                    onChange={event =>
                      setScheduleForm({
                        ...scheduleForm,
                        cronExpression: event.target.value,
                      })
                    }
                    placeholder="0 0 9 * * *"
                    required
                  />
                </label>
                <Button
                  type="submit"
                  className="min-h-11 bg-blue-600 text-white hover:bg-blue-700 sm:min-h-0"
                  disabled={saveSchedulePending}
                >
                  {saveSchedulePending && (
                    <Loader2 className="animate-spin" size={14} />
                  )}
                  保存调度草稿
                </Button>
              </form>
            ) : (
              <div
                role="status"
                dataflow-schedule-empty=""
                className="aiflow-type-body mt-3 rounded-md border border-dashed border-input bg-muted px-3 py-3 text-muted-foreground"
              >
                当前没有已发布数据流。发布后再创建调度，不显示可保存的 Cron
                输入。
              </div>
            )}
          </section>

          {schedules.length > 0 ? (
            <ResourceTable
              columns={["数据流", "计划状态", "执行时间（UTC）", "操作"]}
              empty="尚未配置托管调度。"
              mobileCards={schedules.map((item: any) => {
                const scheduledFlow = flows.find(
                  flowItem => flowItem.id === item.workflowId
                );
                return (
                  <ResourceTableCard
                    key={item.workflowId}
                    primary={scheduledFlow?.name ?? "数据流不可见"}
                    secondary={
                      scheduledFlow?.status === "published"
                        ? "已发布"
                        : "当前流程尚未发布"
                    }
                    status={<State value={item.status} />}
                    fields={[
                      { label: "执行时间（UTC）", value: item.cronExpression },
                    ]}
                    actions={
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11 flex-1 text-xs"
                          disabled={
                            item.status === "active"
                              ? pauseSchedulePending
                              : activateSchedulePending
                          }
                          onClick={() =>
                            item.status === "active"
                              ? onPauseSchedule(item.workflowId)
                              : onActivateSchedule(item.workflowId)
                          }
                        >
                          {item.status === "active" ? "暂停计划" : "启用计划"}
                        </Button>
                        <DeleteButton
                          resourceName={scheduledFlow?.name ?? item.workflowId}
                          disabled={deleteSchedulePending}
                          visibleLabel="删除计划"
                          onDelete={() => onDeleteSchedule(item.workflowId)}
                        />
                      </>
                    }
                  />
                );
              })}
            >
              {schedules.map((item: any) => {
                const scheduledFlow = flows.find(
                  flowItem => flowItem.id === item.workflowId
                );
                return (
                  <tr key={item.workflowId}>
                    <Cell
                      primary={scheduledFlow?.name ?? "数据流不可见"}
                      secondary={
                        scheduledFlow?.status === "published"
                          ? "已发布"
                          : "当前流程尚未发布"
                      }
                    />
                    <td className="px-4 py-3">
                      <State value={item.status} />
                    </td>
                    <td className="aiflow-type-code px-4 py-3 font-mono text-muted-foreground">
                      {item.cronExpression} UTC
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {item.status === "active" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mr-2 h-8 text-xs"
                          disabled={pauseSchedulePending}
                          onClick={() => onPauseSchedule(item.workflowId)}
                        >
                          暂停
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mr-2 h-8 text-xs"
                          disabled={activateSchedulePending}
                          onClick={() => onActivateSchedule(item.workflowId)}
                        >
                          启用
                        </Button>
                      )}
                      <DeleteButton
                        visibleLabel="删除计划"
                        resourceName={scheduledFlow?.name ?? item.workflowId}
                        disabled={deleteSchedulePending}
                        onDelete={() => onDeleteSchedule(item.workflowId)}
                      />
                    </td>
                  </tr>
                );
              })}
            </ResourceTable>
          ) : (
            <div className="aiflow-type-body rounded-lg border border-dashed border-input bg-card px-4 py-5 text-center text-muted-foreground">
              尚未配置托管调度。
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ResourceTable({
  columns,
  children,
  empty,
  mobileCards,
}: {
  columns: string[];
  children: React.ReactNode;
  empty: string;
  mobileCards?: React.ReactNode;
}) {
  const hasRows = Children.toArray(children).some(isValidElement);
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      {hasRows ? (
        <>
          {mobileCards !== undefined && (
            <div
              data-resource-table-mobile=""
              role="list"
              aria-label={`${columns[0]}列表`}
              className="divide-y divide-border md:hidden"
            >
              {mobileCards}
            </div>
          )}
          {mobileCards === undefined && (
            <div className="aiflow-type-body flex items-center gap-2 border-b border-border px-3 py-2 text-muted-foreground md:hidden">
              <ArrowLeftRight size={14} aria-hidden="true" />
              <span>左右滑动表格可查看其余字段</span>
            </div>
          )}
          <div
            data-resource-table-desktop=""
            role="region"
            aria-label={`${columns[0]}列表，可横向滚动查看其余字段`}
            tabIndex={0}
            className={`${mobileCards === undefined ? "" : "hidden md:block"} overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`}
          >
            <table className="w-full min-w-[620px] text-left text-sm [&_thead_th:first-child]:sticky [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-20 [&_thead_th:first-child]:bg-muted [&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-10 [&_tbody_td:first-child]:bg-card">
              <thead className="bg-muted text-sm font-medium text-muted-foreground">
                <tr>
                  {columns.map(column => (
                    <th key={column} className="whitespace-nowrap px-4 py-3">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      )}
    </section>
  );
}

function ResourceTableCard({
  primary,
  secondary,
  status,
  fields,
  actions,
}: {
  primary: string;
  secondary?: string;
  status?: React.ReactNode;
  fields: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
}) {
  return (
    <article role="listitem" className="space-y-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="aiflow-type-section-title break-words font-medium text-foreground">
            {primary}
          </h3>
          {secondary && (
            <p className="aiflow-type-body mt-1 break-words text-muted-foreground">
              {secondary}
            </p>
          )}
        </div>
        {status}
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-3">
        {fields.map(field => (
          <div key={field.label} className="min-w-0">
            <dt className="aiflow-type-control text-muted-foreground">
              {field.label}
            </dt>
            <dd className="aiflow-type-body mt-1 break-words text-foreground">
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
      {actions && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {actions}
        </div>
      )}
    </article>
  );
}

function Cell({ primary, secondary }: { primary: string; secondary?: string }) {
  return (
    <td className="px-4 py-3">
      <p className="font-medium text-foreground">{primary}</p>
      {secondary && (
        <p
          className="aiflow-type-body mt-0.5 line-clamp-2 max-w-[320px] break-words text-muted-foreground"
          title={secondary}
        >
          {secondary}
        </p>
      )}
    </td>
  );
}
function State({ value }: { value: string }) {
  const tone = [
    "success",
    "verified",
    "active",
    "enabled",
    "published",
    "approved",
  ].includes(value)
    ? "bg-aiflow-success-surface text-aiflow-success"
    : ["failed", "disabled"].includes(value)
      ? "bg-muted text-muted-foreground"
      : "bg-aiflow-warning-surface text-aiflow-warning";
  const labels: Record<string, string> = {
    verified: "已校验",
    active: "启用",
    enabled: "启用",
    published: "已发布",
    draft: "草稿",
    approved: "已审核",
    disabled: "停用",
    success: "成功",
    failed: "失败",
    running: "运行中",
    queued: "排队中",
  };
  return (
    <span
      className={`aiflow-type-meta whitespace-nowrap rounded px-2 py-1 ${tone}`}
    >
      {labels[value] || value}
    </span>
  );
}
function DeleteButton({
  onDelete,
  resourceName,
  visibleLabel,
  actionLabel,
  disabled = false,
}: {
  onDelete: () => Promise<unknown>;
  resourceName: string;
  visibleLabel?: string;
  actionLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const label = actionLabel || visibleLabel || "删除资源";
  const confirmDelete = async () => {
    if (pending || disabled) return;
    setPending(true);
    setError("");
    try {
      await onDelete();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请重试。");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={`${label} ${resourceName}`}
        className={
          visibleLabel
            ? "aiflow-type-control inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border border-border px-3 text-aiflow-danger hover:bg-aiflow-danger-surface"
            : "aiflow-type-control inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-aiflow-danger lg:min-h-10 lg:min-w-10"
        }
        disabled={disabled || pending}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        title={`${label} ${resourceName}`}
      >
        <Trash2 size={15} />
        {visibleLabel}
      </button>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent showCloseButton={!pending} className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认{label}</DialogTitle>
            <DialogDescription className="aiflow-type-body break-words">
              将删除“{resourceName}
              ”的登记记录。此操作无法撤销；引用它的流程或计划可能需要重新配置。取消会保留当前记录。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p
              role="alert"
              className="aiflow-type-body break-words text-aiflow-danger"
            >
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={pending || disabled}
              onClick={() => void confirmDelete()}
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              {pending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DataflowRunMonitor({
  projectId,
  workflowId,
  workflowName,
  selectedRunId,
  onSelect,
  onClearSelection,
}: {
  projectId?: string | null;
  workflowId: string | null;
  workflowName?: string | null;
  selectedRunId: string | null;
  selectedRun?: any;
  selectedRunLoading?: boolean;
  selectedRunError?: boolean;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onRetrySelection?: () => void;
}) {
  const runs = trpc.data.runs.useQuery(
    {
      projectId: projectId ?? "00000000",
      workflowId: workflowId ?? "00000000",
      limit: 10,
      summaryOnly: true,
    },
    {
      enabled: Boolean(projectId && workflowId),
      retry: false,
      refetchInterval: 30000,
      refetchIntervalInBackground: false,
    }
  );
  const detail = trpc.data.runDetail.useQuery(
    { projectId: projectId ?? "00000000", runId: selectedRunId ?? "00000000" },
    {
      enabled: Boolean(projectId && selectedRunId),
      retry: false,
      refetchInterval: query =>
        runDetailRefreshInterval(
          query.state.data?.status,
          Boolean(query.state.error)
        ),
      refetchIntervalInBackground: false,
    }
  );
  const matchingDetail =
    detail.data?.workflowId === workflowId ? detail.data : null;
  return (
    <section className="space-y-4 p-4 sm:p-5" aria-label="数据流程运行监控">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="aiflow-type-page-title font-semibold">
            数据流程运行监控
          </h1>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            {workflowName} · 最近 10 条运行 · 每 30 秒刷新
          </p>
        </div>
        <Button
          variant="outline"
          disabled={runs.isFetching || detail.isFetching}
          onClick={() => {
            void runs.refetch();
            if (selectedRunId) void detail.refetch();
          }}
        >
          刷新运行记录
        </Button>
      </div>
      {runs.isError ? (
        <p role="alert" className="text-destructive">
          读取运行记录失败：{runs.error.message}
        </p>
      ) : runs.isLoading ? (
        <p role="status">正在读取运行记录…</p>
      ) : (
        <div className="grid gap-2" role="list" aria-label="数据流程运行记录">
          {(runs.data ?? []).map((run: any) => (
            <Button
              key={run.id}
              variant={run.id === selectedRunId ? "secondary" : "outline"}
              className="h-auto min-h-11 justify-between gap-3 whitespace-normal text-left"
              onClick={() => onSelect(run.id)}
            >
              <span className="break-all">
                {run.id} · {formatDataflowTime(run.startedAt ?? run.createdAt)}
              </span>
              <State value={run.status} />
            </Button>
          ))}
          {runs.data?.length === 0 && (
            <p role="status">当前流程尚无数据运行记录。</p>
          )}
        </div>
      )}
      {selectedRunId && (
        <section
          className="rounded-lg border border-border bg-card p-4"
          aria-label="数据流程运行详情"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="aiflow-type-section-title font-semibold break-all">
              运行详情 · {selectedRunId}
            </h2>
            <Button variant="ghost" onClick={onClearSelection}>
              关闭运行详情
            </Button>
          </div>
          {detail.isError ? (
            <p role="alert" className="mt-3 text-destructive">
              读取运行详情失败：{detail.error.message}
            </p>
          ) : detail.isLoading ? (
            <p role="status">正在读取运行详情…</p>
          ) : matchingDetail ? (
            <DataflowRunOutput key={selectedRunId} run={matchingDetail} />
          ) : (
            <p role="alert">运行记录不属于当前流程或已无法访问。</p>
          )}
        </section>
      )}
    </section>
  );
}
