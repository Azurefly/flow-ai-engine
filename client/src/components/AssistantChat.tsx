import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ArrowUp, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { parseConsoleRoute } from "@shared/console-route";
import { newOperationUuid, newResourceRequestKey } from "@shared/resource-creation";
import { assistantJobActive, assistantJobErrors, assistantJobLabels } from "@shared/assistant-job";
import { assistantScopeRoute, assistantStorageKey, sameAssistantScope } from "@shared/assistant-scope";
import type { AssistantMessage } from "../../../server/assistant-store";
import type {
  AssistantContext,
  AssistantNavigation,
} from "./AssistantLauncher";
import "./assistant.css";

const WorkflowPreview = lazy(() => import("./WorkflowCanvas"));

type Props = {
  userId: number;
  context: AssistantContext;
  onNavigate: AssistantNavigation;
  trial?: { id: string; name: string; greeting: string; version: number };
};
type Attempt = {
  sessionId: string;
  revision: number;
  action: string;
  key: string;
  text: string;
  until: number;
  timeZone?: string;
  start?: {
    agentId: string;
    context: AssistantContext;
    expectedConfigVersion?: number;
  };
};



function stored(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function store(key: string, value: string | null) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* Server history remains available when browser storage is full or disabled. */ }
}

function readAttempt(key: string): Attempt | null {
  try {
    const value = JSON.parse(
      stored(key) ?? "null"
    ) as Attempt | null;
    return value &&
      typeof value.key === "string" &&
      typeof value.sessionId === "string" &&
      typeof value.text === "string" &&
      Number.isSafeInteger(value.revision)
      ? value
      : null;
  } catch {
    return null;
  }
}

export default function AssistantChat(props: Props) {
  const storageKey = assistantStorageKey(props.userId, props.context, props.trial);
  return <ScopedAssistantChat key={storageKey} {...props} storageKey={storageKey} />;
}

function ScopedAssistantChat({
  userId,
  context,
  onNavigate,
  trial,
  storageKey,
}: Props & { storageKey: string }) {
  const preview = Boolean(trial);
  const [sessionId, setSessionId] = useState(() => stored(storageKey) ?? "");
  const draftKey = (id: string) => storageKey + ".draft." + id;
  const [attempt, setAttempt] = useState(() =>
    readAttempt(storageKey + ".request")
  );
  const [selectedAgent, setSelectedAgent] = useState(
    attempt?.start?.agentId ?? ""
  );
  const [text, setText] = useState(
    () => stored(draftKey(sessionId)) ?? (attempt &&
      (attempt.sessionId === sessionId || (!sessionId && attempt.start))
      ? attempt.text
      : "")
  );
  useEffect(() => { store(draftKey(sessionId), text); }, [storageKey, sessionId, text]);
  const activeView = useRef(true);
  useLayoutEffect(() => {
    activeView.current = true;
    return () => { activeView.current = false; };
  }, []);
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const tail = useRef<HTMLDivElement>(null);
  const list = trpc.assistant.available.useQuery(context, {
    enabled: !trial,
    retry: false,
  });
  const [historyAgent, setHistoryAgent] = useState("");
  const [historyScope, setHistoryScope] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const history = trpc.assistant.sessionsPage.useInfiniteQuery(
    { preview, agentId: trial?.id ?? (historyAgent || undefined), configVersion: trial?.version,
      projectId: trial || historyScope === "current" ? context.projectId ?? null : undefined,
      search: historySearch.trim() || undefined, limit: 20 },
    { retry: false, getNextPageParam: page => page.nextCursor ?? undefined }
  );
  const pageSize = 12;
  const [older, setOlder] = useState<{ id: string; messages: AssistantMessage[]; before: number | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;
  const keepBottom = useRef(true);
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const [unread, setUnread] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const proposalHeading = useRef<HTMLElement>(null);
  const shouldFocus = useRef(false);
  const current = trpc.assistant.get.useQuery(
    { sessionId, pageSize },
    {
      enabled: Boolean(sessionId),
      retry: false,
    }
  );
  const session = current.isError ? undefined : current.data;
  const foreignScope = Boolean(session && !sameAssistantScope(session.context, context));
  const start = trpc.assistant.start.useMutation();
  const enqueue = trpc.assistant.enqueue.useMutation();
  const cancelJob = trpc.assistant.cancelJob.useMutation();
  const requestId = attempt?.sessionId === sessionId ? attempt.key : undefined;
  const job = trpc.assistant.job.useQuery({ sessionId, requestId }, {
    enabled: Boolean(sessionId && session && !foreignScope), retry: false,
    refetchInterval: query => assistantJobActive(query.state.data?.status) ? 1500 :
      query.state.data?.status === "needs_review" ? 10_000 :
      (!query.state.data && requestId && attempt && Date.now() < attempt.until ? 3500 : false),
  });
  const background = foreignScope ? undefined : job.data;
  const recovering = Boolean(
    !foreignScope && attempt && sessionId === attempt.sessionId && !locked.current
  );
  const receipt = trpc.assistant.get.useQuery(
    { sessionId, pageSize, requestId: attempt?.key },
    {
      enabled: recovering,
      retry: false,
      refetchInterval: () =>
        recovering && attempt && Date.now() < attempt.until ? 3500 : false,
    }
  );
  const utils = trpc.useUtils();
  const projectId = sessionId
    ? session?.context.projectId
    : (attempt?.start?.context ?? context).projectId;
  const project = trpc.project.get.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId), retry: false }
  );
  const agents = trial ? [trial] : (list.data ?? []);
  const activeAgent =
    agents.find(item => item.id === selectedAgent) ?? agents[0];
  const sessions = Array.from(new Map(history.data?.pages.flatMap(page => page.items.map(item => [item.id, item] as const))).values());
  const before = older?.id === sessionId ? older.before : session?.olderBefore;
  const messages = !session ? [] : Array.from(new Map([...(older?.id === sessionId ? older.messages : []), ...session.messages]
    .map((message, index) => [message.turnRevision === undefined ? "legacy" + index : message.turnRevision + "/" + message.turnIndex, message] as const)).values());
  async function loadOlder() {
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await utils.client.assistant.get.query({ sessionId, pageSize, beforeRevision: before });
      if (currentSessionId.current !== sessionId) return;
      const log = tail.current?.parentElement;
      if (log) scrollAnchor.current = { height: log.scrollHeight, top: log.scrollTop };
      keepBottom.current = false;
      setOlder(prior => ({ id: sessionId, messages: [...page.messages, ...(prior?.id === sessionId ? prior.messages : [])], before: page.olderBefore ?? null }));
    } catch (cause) {
      if (currentSessionId.current === sessionId) setError(cause instanceof Error ? cause.message : "读取早期消息失败。");
    } finally { setLoadingOlder(false); }
  }
  const waiting =
    Boolean(recovering && session && attempt && session.revision > attempt.revision) ||
    start.isPending ||
    enqueue.isPending || assistantJobActive(background?.status) || background?.status === "needs_review" ||
    Boolean(sessionId && current.isLoading);
  const pending = session?.pending;

  function remember(value: Attempt | null) {
    setAttempt(value);
    store(storageKey + ".request", value && JSON.stringify(value));
  }
  const legacyKey = "flow.assistant." + userId + ".customer..";
  const [legacy, setLegacy] = useState(() => {
    if (trial || sessionId || attempt || text) return null;
    const old = readAttempt(legacyKey + ".request");
    const id = stored(legacyKey) || old?.sessionId;
    return id ? { id, old } : null;
  });
  const legacyDetail = trpc.assistant.get.useQuery({ sessionId: legacy?.id ?? "", pageSize: 1 }, {
    enabled: Boolean(legacy), retry: false,
  });
  useEffect(() => {
    if (!legacy || (!legacyDetail.isSuccess && !legacyDetail.isError)) return;
    setLegacy(null);
    if (sessionId || attempt || text || locked.current) return;
    const old = legacy.old?.sessionId === legacy.id ? legacy.old : null;
    const existing = legacyDetail.data;
    const source = existing?.context ?? (legacyDetail.error?.data?.code === "NOT_FOUND" ? old?.start?.context : undefined);
    if (!source || existing?.preview || !sameAssistantScope(source, context)) return;
    if (existing) { setSessionId(existing.id); store(storageKey, existing.id); }
    if (old) { remember(old); setText(old.text); if (old.start) setSelectedAgent(old.start.agentId); }
    if (stored(legacyKey) === legacy.id) store(legacyKey, null);
    if (old && readAttempt(legacyKey + ".request")?.key === old.key) store(legacyKey + ".request", null);
  }, [legacy, legacyDetail.data, legacyDetail.error, legacyDetail.isSuccess, legacyDetail.isError, sessionId, attempt, text, storageKey, context, legacyKey]);
  const lastOutcome = useRef("");
  useEffect(() => {
    if (!background || background.sessionId !== sessionId || assistantJobActive(background.status)) return;
    const identity = [background.id, background.status, background.reviewedAt].join("/");
    if (lastOutcome.current === identity) return;
    lastOutcome.current = identity;
    void utils.assistant.get.invalidate({ sessionId });
    void utils.assistant.sessionsPage.invalidate();
    if (background.status === "completed" && background.actionKey && !preview) {
      void Promise.allSettled([utils.project.invalidate(), utils.workflow.page.invalidate(), utils.config.publicGeneral.invalidate(), utils.config.settings.invalidate()]);
    }
    if (attempt?.key === background.requestId && ["cancelled", "failed"].includes(background.status)) {
      remember(null);
      setError(assistantJobErrors[background.failureCode ?? ""] ?? "");
    }
  }, [background, sessionId, attempt, utils, preview]);
  useEffect(() => {
    const result = receipt.data;
    if (
      !recovering ||
      receipt.isError ||
      !result ||
      !attempt ||
      result.revision <= attempt.revision
    )
      return;
    utils.assistant.get.setData({ sessionId, pageSize }, result);
    remember(null);
    if (result.requestCommitted) {
      setText(existing => (existing === attempt.text ? "" : existing));
      setError("");
    } else {
      setError("对话已在别处更新。请核对最新消息后重新提交。");
    }
  }, [recovering, receipt.data, receipt.isError, attempt, sessionId, utils]);

  useLayoutEffect(() => {
    const log = tail.current?.parentElement;
    if (!log) return;
    if (scrollAnchor.current) {
      log.scrollTop = scrollAnchor.current.top + log.scrollHeight - scrollAnchor.current.height;
      scrollAnchor.current = null;
    } else if (keepBottom.current) log.scrollTop = log.scrollHeight;
  }, [older, sessionId, session?.revision, sending]);
  useEffect(() => {
    if (!keepBottom.current && session?.revision) setUnread(true);
  }, [session?.revision]);
  useEffect(() => {
    if (waiting || !shouldFocus.current) return;
    shouldFocus.current = false;
    (pending ? proposalHeading.current : composer.current)?.focus({ preventScroll: true });
  }, [waiting, pending, sending, error]);

  function selectSession(id: string) {
    setOlder(null); setUnread(false); keepBottom.current = true; scrollAnchor.current = null;
    setSessionId(id);
    setError("");
    setText(stored(draftKey(id)) ?? "");
    remember(null);
    store(storageKey, id);
  }

  async function respond(approve?: boolean, retryText?: string) {
    const message = (retryText ?? text).trim();
    if (
      foreignScope || locked.current ||
      waiting ||
      (approve === undefined ? !message : !pending)
    )
      return;
    if (!session && (sessionId || (!activeAgent && !attempt?.start))) return;
    locked.current = true;
    shouldFocus.current = true;
    setError("");
    let target = session;
    try {
      const id =
        target?.id ?? (attempt?.start ? attempt.sessionId : newOperationUuid());
      const revision = target?.revision ?? 0;
      const action = JSON.stringify([id, approve, pending?.id, message]);
      const creation = target
        ? undefined
        : (attempt?.start ?? {
            agentId: activeAgent!.id,
            context,
            expectedConfigVersion: trial?.version,
          });
      const request =
        attempt?.action === action && attempt.revision === revision
          ? attempt
          : {
              action,
              sessionId: id,
              start: creation,
              revision,
              key: newResourceRequestKey(),
              text: message,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              until: Date.now() + 180_000,
            };
      remember(request);
      if (!target && creation) {
        target = await start.mutateAsync({
          ...creation,
          preview,
          sessionId: id,
        });
        utils.assistant.get.setData({ sessionId: id, pageSize }, target);
        if (!activeView.current) return;
        store(draftKey(""), null);
        setSessionId(id);
        store(storageKey, id);
      }
      if (!target) return;
      const payload = {
        sessionId: target.id,
        revision: request.revision,
        requestId: request.key, pageSize,
      };
      if (approve === undefined) setSending(message);
      const next = await enqueue.mutateAsync({ ...payload, payload: approve === undefined
        ? { kind: "message", text: message, proposalId: target.pending?.id, timeZone: request.timeZone }
        : { kind: "decide", approve, proposalId: pending!.id } });
      utils.assistant.job.setData({ sessionId: target.id, requestId: request.key }, next);
      utils.assistant.job.setData({ sessionId: target.id }, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请重试。");
      if (target)
        await utils.assistant.get.invalidate({ sessionId: target.id });
    } finally {
      setSending("");
      locked.current = false;
      void utils.assistant.sessionsPage.invalidate();
    }
  }

  return (
    <div className="assistant-chat">
      <div className="assistant-chat-toolbar">
        <details>
          <summary>筛选对话</summary>
          <label>标题<input aria-label="历史对话标题" maxLength={160} value={historySearch} onChange={e => setHistorySearch(e.target.value)} /></label>
          {!trial && <>
            <label>助手<select aria-label="历史助手" value={historyAgent} onChange={e => setHistoryAgent(e.target.value)}>
              <option value="">全部助手</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>范围<select aria-label="历史项目范围" value={historyScope} onChange={e => setHistoryScope(e.target.value)}>
              <option value="all">全部可见项目</option><option value="current">{context.projectId ? "本项目" : "工作台"}</option>
            </select></label>
          </>}
        </details>
        <select
          aria-label="对话记录"
          value={sessionId}
          disabled={start.isPending || enqueue.isPending}
          onChange={e => selectSession(e.target.value)}
        >
          <option value="">新对话</option>
          {sessionId && !sessions.some(item => item.id === sessionId) && (
            <option value={sessionId}>
              {session?.agentName ?? "当前对话"}
            </option>
          )}
          {sessions.map(item => (
            <option key={item.id} value={item.id}>
              {item.title || "新对话"}
            </option>
          ))}
        </select>
        {history.hasNextPage && <button type="button" className="assistant-link" disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}>更多对话</button>}
        <button
          type="button"
          className="assistant-link"
          aria-label="新建对话"
          disabled={start.isPending || enqueue.isPending}
          onClick={() => selectSession("")}
        >
          <Plus size={16} /> 新对话
        </button>
      </div>
      {!sessionId && agents.length > 1 && (
        <label className="assistant-agent-select">
          选择助手
          <select
            value={activeAgent?.id}
            onChange={e => {
              remember(null);
              setSelectedAgent(e.target.value);
            }}
          >
            {agents.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div
        className="assistant-log"
        role="log"
        aria-label={trial ? "试聊记录" : "对话内容"}
        aria-live={unread ? "off" : "polite"}
        onScroll={e => { const log = e.currentTarget; keepBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 36;
          if (keepBottom.current) setUnread(false); }}
      >
        {(!sessionId || session) && (
          <p className="assistant-session-title">
            {session ? session.agentName + " · " : ""}
            {projectId
              ? "项目 · " + String(project.data?.name ?? projectId)
              : "工作台"}
          </p>
        )}
        {!sessionId && (
          <div className="assistant-intro">
            <h3>{activeAgent?.name || "流程助手"}</h3>
            <p>
              {activeAgent
                ? activeAgent.greeting || "你希望我帮你处理什么？"
                : list.isLoading
                  ? "正在读取可用助手…"
                  : list.isError
                    ? list.error.message
                    : "当前页面暂无可用助手。请联系管理员配置并发布。"}
            </p>
            {!trial && list.isError && (
              <button type="button" className="assistant-link" disabled={list.isFetching}
                onClick={() => void list.refetch()}>重新加载助手</button>
            )}
          </div>
        )}
        {session && before && <button type="button" className="assistant-link" disabled={loadingOlder}
          onClick={() => void loadOlder()}>读取更早的消息</button>}
        {messages.map((item, index) => (
          <div
            key={item.turnRevision === undefined ? index : item.turnRevision + "/" + item.turnIndex}
            className="assistant-message"
            data-speaker={item.role}
          >
            <span>{item.role === "user" ? "你" : session?.agentName}</span>
            <p>{item.content}</p>
            {item.links?.map(link => (
              <button
                key={link.href + link.label}
                type="button"
                className="assistant-link"
                onClick={() => onNavigate(parseConsoleRoute(link.href))}
              >
                {link.label}
              </button>
            ))}
          </div>
        ))}
        {sending && session?.messages.at(-1)?.content !== sending && (
          <div className="assistant-message" data-speaker="user">
            <span>你</span>
            <p>{sending}</p>
          </div>
        )}
        {pending && (
          <section className="assistant-proposal" aria-label="操作预览" ref={proposalHeading} tabIndex={-1}>
            <p>会话修订 {session?.revision} · {project.data?.name ?? (projectId || "工作台")}</p>
            <strong>{pending.title}</strong>
            <p>{pending.detail}</p>
            {pending.canvas && <Dialog key={pending.id}>
              <DialogTrigger asChild><button type="button" className="assistant-link">预览流程画布</button></DialogTrigger>
              <DialogContent className="w-[94vw] max-w-5xl sm:max-w-5xl">
                <DialogHeader><DialogTitle>{pending.title}</DialogTitle></DialogHeader>
                <div className="h-[65dvh] min-w-0 overflow-hidden">
                  <Suspense fallback={<p role="status">正在加载流程画布…</p>}>
                    <WorkflowPreview definition={pending.canvas.definition} flowType={pending.canvas.flowType}
                      compactReadOnlyPreview readOnly showCanvasActions={false}/>
                  </Suspense>
                </div>
              </DialogContent>
            </Dialog>}
            {pending.details.length > 0 && (
              <ul>
                {pending.details.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
            {!foreignScope && <div className="assistant-actions">
              <button
                type="button"
                className="assistant-primary"
                disabled={waiting}
                onClick={() => void respond(true)}
              >
                {preview ? "模拟确认" : "确认执行"}
              </button>
              <button
                type="button"
                disabled={waiting}
                onClick={() => void respond(false)}
              >
                取消操作
              </button>
            </div>}
          </section>
        )}
        {background && (assistantJobActive(background.status) || background.status === "needs_review" || background.reviewedAt ||
          (background.status === "failed" && background.baseRevision === session?.revision)) && (
          <section className="assistant-note" aria-label="后台回合">
            <p role="status">{assistantJobLabels[background.status]} {assistantJobErrors[background.failureCode ?? ""]}</p>
            <small>请求号 {background.requestId}{background.evidence ? " · 核对记录 " + background.evidence : ""}</small>
            {!foreignScope && background.status === "queued" && <button type="button" className="assistant-link" disabled={cancelJob.isPending}
              onClick={() => void cancelJob.mutateAsync({ sessionId, requestId: background.requestId })
                .catch(cause => setError(cause.message)).finally(() => void utils.assistant.job.invalidate({ sessionId }))}>取消排队</button>}
          </section>
        )}
        {waiting && !background && (
          <p role="status" className="assistant-note">
            正在处理…
          </p>
        )}
        {!waiting && attempt?.sessionId === sessionId && (
          <p className="assistant-note">
            上一条请求的结果尚待同步，可以重新提交同一请求。
          </p>
        )}
        {!foreignScope && !waiting && session?.retryText && !pending && (
          <button
            type="button"
            className="assistant-link"
            onClick={() => void respond(undefined, session.retryText!)}
          >
            重试上一条消息
          </button>
        )}
        {(error || current.isError || history.isError || job.isError || (recovering && receipt.isError)) && (
          <p className="assistant-error" role="alert">
            {error || current.error?.message || history.error?.message || job.error?.message || receipt.error?.message}
            {(current.isError || history.isError || job.isError || receipt.isError) && <button type="button" className="assistant-link" onClick={() => {
              if (current.isError && sessionId) void current.refetch();
              if (history.isError) void history.refetch();
              if (job.isError) void job.refetch();
              if (recovering && receipt.isError) void receipt.refetch();
            }}>重新读取</button>}
          </p>
        )}
        <div ref={tail} />
      </div>
      {unread && <button type="button" className="assistant-link" onClick={() => {
        const log = tail.current?.parentElement; if (log) log.scrollTop = log.scrollHeight;
        keepBottom.current = true; setUnread(false);
      }}>查看新消息</button>}
      {foreignScope && session && <button type="button" className="assistant-link" onClick={() => {
        store(assistantStorageKey(userId, session.context, trial), session.id);
        onNavigate(assistantScopeRoute(session.context));
      }}>打开会话所属页面继续</button>}
      <form
        className="assistant-composer"
        onSubmit={event => {
          event.preventDefault();
          void respond();
        }}
      >
        <textarea ref={composer}
          aria-label={preview ? "试聊消息" : "发给助手的消息"}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={pending ? "补充或修改条件…" : "输入任务或问题…"}
          disabled={waiting || foreignScope}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              void respond();
            }
          }}
        />
        <button
          className="assistant-primary"
          type="submit"
          aria-label="发送消息"
          disabled={
            waiting || foreignScope ||
            !text.trim() ||
            (!session && (!activeAgent || Boolean(sessionId)))
          }
        >
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  );
}
