import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { ArrowUp, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { parseConsoleRoute } from "@shared/console-route";
import { newResourceRequestKey } from "@shared/resource-creation";
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
  start?: {
    agentId: string;
    context: AssistantContext;
    expectedConfigVersion?: number;
  };
};

function sessionUuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function readAttempt(key: string): Attempt | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(key) ?? "null"
    ) as Attempt | null;
    return value &&
      typeof value.key === "string" &&
      typeof value.text === "string" &&
      Number.isSafeInteger(value.revision)
      ? value
      : null;
  } catch {
    return null;
  }
}

export default function AssistantChat({
  userId,
  context,
  onNavigate,
  trial,
}: Props) {
  const preview = Boolean(trial);
  const storageKey = [
    "flow.assistant",
    userId,
    trial?.id ?? "customer",
    trial?.version ?? "",
    trial ? (context.projectId ?? "") : "",
  ].join(".");
  const [sessionId, setSessionId] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [attempt, setAttempt] = useState(() =>
    readAttempt(storageKey + ".request")
  );
  const [selectedAgent, setSelectedAgent] = useState(
    attempt?.start?.agentId ?? ""
  );
  const [text, setText] = useState(
    attempt &&
      (attempt.sessionId === sessionId || (!sessionId && attempt.start))
      ? attempt.text
      : ""
  );
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const tail = useRef<HTMLDivElement>(null);
  const list = trpc.assistant.available.useQuery(context, {
    enabled: !trial,
    retry: false,
  });
  const history = trpc.assistant.sessions.useQuery(
    { preview, agentId: trial?.id },
    { retry: false }
  );
  const current = trpc.assistant.get.useQuery(
    { sessionId },
    {
      enabled: Boolean(sessionId),
      retry: false,
    }
  );
  const start = trpc.assistant.start.useMutation();
  const send = trpc.assistant.message.useMutation();
  const decide = trpc.assistant.decide.useMutation();
  const recovering = Boolean(
    attempt && sessionId === attempt.sessionId && !locked.current
  );
  const receipt = trpc.assistant.get.useQuery(
    { sessionId, requestId: attempt?.key },
    {
      enabled: recovering,
      retry: false,
      refetchInterval: () =>
        recovering && attempt && Date.now() < attempt.until ? 3500 : false,
    }
  );
  const utils = trpc.useUtils();
  const session = current.isError ? undefined : current.data;
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
  const sessions = (history.data ?? []).filter(
    item =>
      !trial ||
      (item.agentId === trial.id &&
        item.configVersion === trial.version &&
        item.projectId === (context.projectId ?? null))
  );
  const waiting =
    Boolean(recovering && session && attempt && session.revision > attempt.revision) ||
    start.isPending ||
    send.isPending ||
    decide.isPending ||
    Boolean(sessionId && current.isLoading);
  const pending = session?.pending;

  function remember(value: Attempt | null) {
    setAttempt(value);
    try {
      if (value)
        sessionStorage.setItem(storageKey + ".request", JSON.stringify(value));
      else sessionStorage.removeItem(storageKey + ".request");
    } catch {
      /* Reload recovery also works through the server history. */
    }
  }
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
    utils.assistant.get.setData({ sessionId }, result);
    remember(null);
    if (result.requestCommitted) {
      setText(existing => (existing === attempt.text ? "" : existing));
      setError("");
    } else {
      setError("对话已在别处更新。请核对最新消息后重新提交。");
    }
  }, [recovering, receipt.data, receipt.isError, attempt, sessionId, utils]);

  useEffect(() => {
    const log = tail.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [sessionId, session?.revision, sending, error]);

  function selectSession(id: string) {
    setSessionId(id);
    setError("");
    setText("");
    remember(null);
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage is optional. */
    }
  }

  async function respond(approve?: boolean, retryText?: string) {
    const message = (retryText ?? text).trim();
    if (
      locked.current ||
      waiting ||
      (approve === undefined ? !message : !pending)
    )
      return;
    if (!session && (sessionId || (!activeAgent && !attempt?.start))) return;
    locked.current = true;
    setError("");
    let target = session;
    try {
      const id =
        target?.id ?? (attempt?.start ? attempt.sessionId : sessionUuid());
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
              until: Date.now() + 180_000,
            };
      remember(request);
      if (!target && creation) {
        target = await start.mutateAsync({
          ...creation,
          preview,
          sessionId: id,
        });
        utils.assistant.get.setData({ sessionId: id }, target);
        setSessionId(id);
        try {
          sessionStorage.setItem(storageKey, id);
        } catch {
          /* History is available on the server. */
        }
      }
      if (!target) return;
      const payload = {
        sessionId: target.id,
        revision: request.revision,
        requestId: request.key,
      };
      if (approve === undefined) setSending(message);
      const next =
        approve === undefined
          ? await send.mutateAsync({
              ...payload,
              text: message,
              proposalId: target.pending?.id,
            })
          : await decide.mutateAsync({
              ...payload,
              approve,
              proposalId: pending!.id,
            });
      utils.assistant.get.setData({ sessionId: next.id }, next);
      remember(null);
      setText("");
      if (!preview && target.pending && next.status === "completed") {
        void Promise.allSettled([
          utils.workflow.page.invalidate(),
          utils.project.invalidate(),
          utils.config.publicGeneral.invalidate(),
          utils.config.settings.invalidate(),
        ]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请重试。");
      if (target)
        await utils.assistant.get.invalidate({ sessionId: target.id });
    } finally {
      setSending("");
      locked.current = false;
      void utils.assistant.sessions.invalidate();
    }
  }

  return (
    <div className="assistant-chat">
      <div className="assistant-chat-toolbar">
        <select
          aria-label="对话记录"
          value={sessionId}
          disabled={waiting}
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
        <button
          type="button"
          className="assistant-link"
          aria-label="新建对话"
          disabled={waiting}
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
        aria-live="polite"
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
        {(session?.messages ?? []).map((item, index) => (
          <div
            key={index}
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
          <section className="assistant-proposal" aria-label="操作预览">
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
            <div className="assistant-actions">
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
            </div>
          </section>
        )}
        {waiting && (
          <p role="status" className="assistant-note">
            正在处理…
          </p>
        )}
        {!waiting && attempt?.sessionId === sessionId && (
          <p className="assistant-note">
            上一条请求的结果尚待同步，可以重新提交同一请求。
          </p>
        )}
        {!waiting && session?.retryText && !pending && (
          <button
            type="button"
            className="assistant-link"
            onClick={() => void respond(undefined, session.retryText!)}
          >
            重试上一条消息
          </button>
        )}
        {(error || current.isError || history.isError || (recovering && receipt.isError)) && (
          <p className="assistant-error" role="alert">
            {error || current.error?.message || history.error?.message || receipt.error?.message}
            {(current.isError || history.isError || receipt.isError) && <button type="button" className="assistant-link" onClick={() => {
              if (current.isError && sessionId) void current.refetch();
              if (history.isError) void history.refetch();
              if (recovering && receipt.isError) void receipt.refetch();
            }}>重新读取</button>}
          </p>
        )}
        <div ref={tail} />
      </div>
      <form
        className="assistant-composer"
        onSubmit={event => {
          event.preventDefault();
          void respond();
        }}
      >
        <textarea
          aria-label={preview ? "试聊消息" : "发给助手的消息"}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={pending ? "补充或修改条件…" : "输入任务或问题…"}
          disabled={waiting}
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
            waiting ||
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
