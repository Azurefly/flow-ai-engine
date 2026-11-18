import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { consoleNavigationEvent } from "@/lib/console-navigation-guard";
import { newResourceRequestKey } from "@shared/resource-creation";
import { SearchableMultiSelect } from "./SearchableMultiSelect";
import AssistantChat from "./AssistantChat";
import type { AssistantNavigation } from "./AssistantLauncher";
import "./assistant.css";

type Config = inferRouterInputs<AppRouter>["assistant"]["saveDraft"]["config"];
type Entry = inferRouterOutputs<AppRouter>["assistant"]["adminAgents"][number];
const toolLabels = {
  listMyTasks: "查看我的待办",
  listMyCompletedTasks: "查看我的已办",
  searchWorkflows: "查找流程",
  createWorkflowDraft: "创建流程草稿",
  updateWatermark: "修改系统水印",
} as const;
const initialConfig: Config = {
  name: "流程助手",
  greeting: "你希望我帮你处理什么？",
  instructions: "帮助客户查询待办和流程。缺少必要信息时向客户询问。",
  model: "",
  tools: ["listMyTasks", "listMyCompletedTasks", "searchWorkflows"],
  enabled: true,
  roles: ["user", "admin"],
  projectIds: [],
};

export default function AgentSettings({
  userId,
  onNavigate,
}: {
  userId: number;
  onNavigate: AssistantNavigation;
}) {
  const utils = trpc.useUtils();
  const entries = trpc.assistant.adminAgents.useQuery(undefined, {
    retry: false,
  });
  const [selected, setSelected] = useState<string>();
  const [draftId, setDraftId] = useState(newResourceRequestKey);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (selected === undefined && entries.data?.length)
      setSelected(entries.data[0].id);
  }, [selected, entries.data]);
  const editingNew = selected === "";
  const active = editingNew
    ? undefined
    : (entries.data?.find(item => item.id === selected) ?? entries.data?.[0]);
  const select = (value: string) => {
    if (busy || (dirty && !window.confirm("离开并丢弃未保存的 Agent 修改？")))
      return;
    if (value === "") setDraftId(newResourceRequestKey());
    setDirty(false);
    setSelected(value);
  };

  useEffect(() => {
    const guard = (event: Event) => {
      if (busy || (dirty && !window.confirm("离开并丢弃未保存的 Agent 修改？")))
        event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault();
    };
    window.addEventListener(consoleNavigationEvent, guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener(consoleNavigationEvent, guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, busy]);

  function accept(entry: Entry) {
    utils.assistant.adminAgents.setData(undefined, rows =>
      [...(rows ?? []).filter(item => item.id !== entry.id), entry].sort(
        (a, b) => a.draft.name.localeCompare(b.draft.name)
      )
    );
    setSelected(entry.id);
    setDirty(false);
    void utils.assistant.available.invalidate();
  }
  return (
    <section className="agent-workspace" aria-label="Agent 配置">
      <header>
        <h1 className="aiflow-type-page-title">Agent 配置</h1>
        <button
          type="button"
          onClick={() => onNavigate({ section: "system", view: "config" })}
        >
          返回系统配置
        </button>
      </header>
      {entries.isLoading ? (
        <p role="status">正在读取 Agent 配置…</p>
      ) : entries.isError &&
        (!entries.data ||
          entries.error.data?.code === "FORBIDDEN" ||
          entries.error.data?.code === "UNAUTHORIZED") ? (
        <p role="alert">
          {entries.error.message}{" "}
          <button onClick={() => void entries.refetch()}>重新读取</button>
        </p>
      ) : (
        <div className="agent-columns">
          <aside aria-label="Agent 列表">
            <button
              className="assistant-link"
              disabled={busy}
              onClick={() => select("")}
            >
              <Plus size={16} /> 新建 Agent
            </button>
            {(entries.data ?? []).map(entry => (
              <button
                className="agent-list-item"
                key={entry.id}
                aria-current={active?.id === entry.id ? "page" : undefined}
                disabled={busy}
                onClick={() => {
                  if (entry.id !== active?.id) select(entry.id);
                }}
              >
                {entry.draft.name}
                <small>
                  {entry.publishedVersion
                    ? "已发布 · v" + entry.publishedVersion
                    : "未发布"}
                </small>
              </button>
            ))}
          </aside>
          <AgentEditor
            key={active?.id ?? draftId}
            agentId={active?.id ?? draftId}
            entry={active}
            userId={userId}
            onNavigate={onNavigate}
            onDirty={setDirty}
            onBusy={setBusy}
            accept={accept}
          />
        </div>
      )}
    </section>
  );
}

function AgentEditor({
  agentId,
  entry,
  userId,
  onNavigate,
  onDirty,
  onBusy,
  accept,
}: {
  agentId: string;
  entry?: Entry;
  userId: number;
  onNavigate: AssistantNavigation;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  accept: (entry: Entry) => void;
}) {
  const [form, setForm] = useState<Config>(entry?.draft ?? initialConfig);
  const utils = trpc.useUtils();
  const [base, setBase] = useState({
    config: entry?.draft ?? initialConfig,
    version: entry?.draftVersion ?? 0,
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [testProject, setTestProject] = useState("");
  const projects = trpc.project.page.useQuery(
    { limit: 50, search: query },
    { retry: false }
  );
  const settings = trpc.config.settings.useQuery();
  const catalog = trpc.config.checkModelService.useMutation();
  const save = trpc.assistant.saveDraft.useMutation();
  const publish = trpc.assistant.publish.useMutation();
  const lock = save.isPending || publish.isPending;
  const changed = JSON.stringify(form) !== JSON.stringify(base.config);
  const stale = entry && entry.draftVersion !== base.version;
  const valid = Boolean(
    form.name.trim() && form.instructions.trim() && form.roles.length
  );
  const projectOptions = (projects.data?.items ?? []).map(item => ({
    value: String(item.id),
    label: String(item.name),
  }));
  const trialProject =
    form.projectIds.length && !form.projectIds.includes(testProject)
      ? form.projectIds[0]
      : testProject;
  useEffect(() => {
    onDirty(changed);
  }, [changed, onDirty]);
  function edit<K extends keyof Config>(key: K, value: Config[K]) {
    setForm(existing => ({ ...existing, [key]: value }));
    setError("");
    setNotice("");
  }
  function reload(row: Entry) {
    setForm(row.draft);
    setBase({ config: row.draft, version: row.draftVersion });
  }
  async function submit(action: "save" | "publish") {
    if (lock || stale || !valid) return;
    setError("");
    setNotice("");
    onBusy(true);
    try {
      const row =
        action === "save"
          ? await save.mutateAsync({
              agentId,
              expectedVersion: base.version,
              config: form,
            })
          : await publish.mutateAsync({
              agentId: entry!.id,
              expectedVersion: base.version,
            });
      reload(row);
      accept(row);
      setNotice(action === "save" ? "草稿已保存，可以试聊。" : "配置已发布。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败。");
      void utils.assistant.adminAgents.invalidate();
    } finally {
      onBusy(false);
    }
  }
  return (
    <>
      <form
        className="agent-editor"
        onSubmit={event => {
          event.preventDefault();
          void submit("save");
        }}
      >
        <h2>{entry ? "编辑配置" : "新建 Agent"}</h2>
        <fieldset disabled={lock}>
          <label>
            名称
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={e => edit("name", e.target.value)}
            />
          </label>
          <label>
            开场白
            <input
              maxLength={500}
              value={form.greeting}
              onChange={e => edit("greeting", e.target.value)}
            />
          </label>
          <label>
            职责与指令
            <textarea
              required
              rows={4}
              maxLength={6000}
              value={form.instructions}
              onChange={e => edit("instructions", e.target.value)}
            />
          </label>
          <label>
            模型
            <input
              list="assistant-model-list"
              placeholder="使用系统默认模型"
              value={form.model}
              onChange={e => edit("model", e.target.value)}
            />
          </label>
          <datalist id="assistant-model-list">
            {catalog.data?.models.map(model => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <button
            type="button"
            className="assistant-link"
            disabled={!settings.data || catalog.isPending}
            onClick={() =>
              settings.data &&
              catalog.mutate({
                mode: "models",
                expectedConfigToken: settings.data.configTokens.llm,
              })
            }
          >
            {catalog.isPending ? "正在读取…" : "读取模型目录"}
          </button>
          {(catalog.data || catalog.error) && (
            <p role="status" className="assistant-note">
              {catalog.error?.message ?? catalog.data?.message}
            </p>
          )}
          <fieldset>
            <legend>工具权限</legend>
            <div className="assistant-checks">
              {(Object.keys(toolLabels) as (keyof typeof toolLabels)[]).map(
                tool => (
                  <label key={tool}>
                    <input
                      type="checkbox"
                      checked={form.tools.includes(tool)}
                      onChange={e =>
                        edit(
                          "tools",
                          e.target.checked
                            ? [...form.tools, tool]
                            : form.tools.filter(item => item !== tool)
                        )
                      }
                    />
                    {toolLabels[tool]}
                  </label>
                )
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend>可用账号</legend>
            <div className="assistant-checks">
              {(["user", "admin"] as const).map(role => (
                <label key={role}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(role)}
                    onChange={e =>
                      edit(
                        "roles",
                        e.target.checked
                          ? [...form.roles, role]
                          : form.roles.filter(item => item !== role)
                      )
                    }
                  />
                  {role === "admin" ? "管理员" : "普通用户"}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <span className="agent-field-name">适用项目</span>
            <SearchableMultiSelect
              ariaLabel="适用项目"
              value={form.projectIds}
              options={projectOptions}
              query={query}
              onQueryChange={setQuery}
              onChange={ids => edit("projectIds", ids)}
              placeholder="全部可访问项目"
              searchPlaceholder="搜索项目名称或代号"
              emptyMessage="没有可选项目"
              loading={projects.isFetching}
              error={projects.isError}
            />
          </div>
          <label className="assistant-check">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => edit("enabled", e.target.checked)}
            />
            启用客户入口
          </label>
        </fieldset>
        {stale && (
          <p role="alert">
            草稿版本已更新。
            <button
              type="button"
              onClick={() => {
                if (!changed || window.confirm("读取最新版本并替换当前修改？"))
                  reload(entry);
              }}
            >
              读取最新版本
            </button>
          </p>
        )}
        {error && (
          <p role="alert" className="assistant-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="assistant-note">
            {notice}
          </p>
        )}
        <div className="assistant-actions">
          <button
            className="assistant-primary"
            type="submit"
            disabled={
              lock || Boolean(stale) || !valid || Boolean(entry && !changed)
            }
          >
            保存草稿
          </button>
          <button
            type="button"
            disabled={
              lock ||
              Boolean(stale) ||
              !entry ||
              changed ||
              entry.publishedVersion === entry.draftVersion
            }
            onClick={() => void submit("publish")}
          >
            发布配置
          </button>
        </div>
      </form>
      <section className="agent-trial" aria-label="Agent 试聊">
        <header>
          <h2>草稿试聊</h2>
          <p>确认操作仅演示结果。</p>
        </header>
        {entry && !changed && !stale ? (
          <>
            <label className="assistant-agent-select">
              试聊项目
              <select
                value={trialProject}
                onChange={e => setTestProject(e.target.value)}
              >
                {!form.projectIds.length && <option value="">工作台</option>}
                {(form.projectIds.length
                  ? form.projectIds
                  : projectOptions.map(item => item.value)
                ).map(id => (
                  <option key={id} value={id}>
                    {projectOptions.find(item => item.value === id)?.label ??
                      id}
                  </option>
                ))}
              </select>
            </label>
            <AssistantChat
              key={[entry.id, base.version, trialProject].join(".")}
              userId={userId}
              onNavigate={onNavigate}
              trial={{
                id: entry.id,
                version: base.version,
                name: form.name,
                greeting: form.greeting,
              }}
              context={{ projectId: trialProject || undefined }}
            />
          </>
        ) : (
          <p className="assistant-note">保存当前草稿后即可试聊。</p>
        )}
      </section>
    </>
  );
}
