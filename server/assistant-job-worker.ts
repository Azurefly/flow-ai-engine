import { TRPCError } from "@trpc/server";
import type { AssistantChange, AssistantUser } from "./assistant-store";
import { getAssistantSession } from "./assistant-store";
import {
  decideAssistantProposal,
  modelForTurn,
  runAssistantTurn,
} from "./assistant-runtime";
import { commitAssistantTool, prepareAssistantTool } from "./assistant-tools";
import {
  assistantJobActive,
  assistantJobErrors,
  type AssistantJobPayload,
} from "../shared/assistant-job";
import {
  assistantJobContext,
  claimAssistantJob,
  enqueueAssistantJob,
  failAssistantJob,
  finishAssistantJob,
  getAssistantJob,
  renewAssistantLease,
  type AssistantLease,
} from "./assistant-jobs";
import { withRequestId } from "./_core/http-security";

type ModelFactory = typeof modelForTurn;

export async function processAssistantLease(
  lease: AssistantLease,
  modelFactory: ModelFactory = modelForTurn
) {
  const controller = new AbortController();
  const renew = setInterval(() => {
    void renewAssistantLease(lease).then(
      owned => {
        if (!owned) controller.abort();
      },
      () => controller.abort()
    );
  }, 7500);
  renew.unref();
  try {
    const { actor, session } = await assistantJobContext(lease);
    const usedTools = new Set<string>();
    const commit: typeof commitAssistantTool = async (_, proposal, key) => {
      const action =
        proposal.tool === "workspaceWrite"
          ? proposal.payload.input.action
          : proposal.tool;
      const args: Record<string, unknown> = proposal.tool === "workspaceWrite"
        ? { ...proposal.payload.scope, ...proposal.payload.input.arguments }
        : proposal.tool === "createWorkflowDraft" ? { projectId: proposal.payload.projectId } : {};
      const target = ["projectId", "workflowId", "taskId", "assetId", "folderId", "parentId", "id"]
        .filter(field => typeof args[field] === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(String(args[field])))
        .map(field => field + "=" + args[field]).join(" · ");
      const fresh = await assistantJobContext(lease, proposal.tool, {
        key,
        action,
        target: target || (proposal.tool === "updateWatermark" ? "system.general" : "工作台"),
      });
      usedTools.add(proposal.tool);
      return withRequestId(key, () =>
        commitAssistantTool(fresh.actor, proposal, key, {
          user: fresh.actor,
          requestId: key,
        })
      );
    };
    const prepare: typeof prepareAssistantTool = async (
      _,
      name,
      args,
      scope
    ) => {
      const fresh = await assistantJobContext(lease, name);
      usedTools.add(name);
      return prepareAssistantTool(fresh.actor, name, args, scope, {
        user: fresh.actor,
        requestId: lease.requestId,
      });
    };
    const payload = lease.payload;
    const modelReceipts: {
      model: string | null;
      completionId: string | null;
    }[] = [];
    const measuredModel: ModelFactory = async configured => {
      const invoke = await modelFactory(configured);
      return async input => {
        const reply = await invoke(input);
        const identifier = (value: unknown) =>
          typeof value === "string" && /^[\w.\-:/]{1,200}$/.test(value)
            ? value
            : null;
        modelReceipts.push({
          model: identifier(reply.model),
          completionId: identifier(reply.id),
        });
        return reply;
      };
    };
    const change: AssistantChange =
      payload.kind === "decide"
        ? await decideAssistantProposal(
            actor,
            session,
            payload.proposalId,
            payload.approve,
            commit
          )
        : await runAssistantTurn(
            actor,
            session,
            payload.text,
            { modelForTurn: measuredModel, prepare },
            payload.proposalId,
            { user: actor, requestId: lease.requestId },
            payload.timeZone,
            { signal: controller.signal, commit, focus: payload.focus }
          );
    if (modelReceipts.length) change.task = { ...change.task, modelReceipts };
    await finishAssistantJob(lease, change, usedTools);
  } catch (error) {
    await failAssistantJob(lease, error);
  } finally {
    clearInterval(renew);
  }
}

let timer: NodeJS.Timeout | undefined;
const running = new Set<Promise<void>>();
let dispatching = false;
const requestedConcurrency = Number(
  process.env.ASSISTANT_WORKER_CONCURRENCY ?? 2
);
const workerConcurrency =
  Number.isInteger(requestedConcurrency) &&
  requestedConcurrency >= 1 &&
  requestedConcurrency <= 6
    ? requestedConcurrency
    : 2;

export async function runAssistantJobOnce(
  id?: string,
  modelFactory: ModelFactory = modelForTurn
) {
  const lease = await claimAssistantJob(id);
  if (!lease) return false;
  await processAssistantLease(lease, modelFactory);
  return true;
}

export function wakeAssistantWorker() {
  if (!timer || dispatching) return;
  dispatching = true;
  void (async () => {
    while (timer && running.size < workerConcurrency) {
      const lease = await claimAssistantJob();
      if (!lease) break;
      const work = processAssistantLease(lease)
        .catch(() =>
          console.error("[AssistantWorker] Failed to persist a job outcome")
        )
        .finally(() => {
          running.delete(work);
          wakeAssistantWorker();
        });
      running.add(work);
    }
  })()
    .catch(() => console.error("[AssistantWorker] Could not claim queued work"))
    .finally(() => {
      dispatching = false;
    });
}

export function startAssistantWorker(standalone = false) {
  if (
    timer ||
    !process.env.DATABASE_URL ||
    (process.env.ASSISTANT_WORKER_ENABLED ??
      (standalone ? "true" : process.env.WORKFLOW_WORKER_ENABLED)) === "false"
  )
    return;
  timer = setInterval(wakeAssistantWorker, 1500);
  if (!standalone) timer.unref();
  wakeAssistantWorker();
}

export async function stopAssistantWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
  while (dispatching) await new Promise(resolve => setTimeout(resolve, 20));
  await Promise.allSettled(Array.from(running));
}

export async function submitAssistantJob(
  user: AssistantUser,
  sessionId: string,
  revision: number,
  requestId: string,
  payload: AssistantJobPayload
) {
  const job = await enqueueAssistantJob(
    user,
    sessionId,
    revision,
    requestId,
    payload
  );
  wakeAssistantWorker();
  return job;
}

// Old clients expect a session response. Both APIs share the same persisted request and fence.
export async function waitForAssistantTurn(
  user: AssistantUser,
  sessionId: string,
  revision: number,
  requestId: string,
  payload: AssistantJobPayload,
  pageSize?: number
) {
  let job = await submitAssistantJob(
    user,
    sessionId,
    revision,
    requestId,
    payload
  );
  const deadline = Date.now() + 120_000;
  while (assistantJobActive(job.status) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 400));
    job = (await getAssistantJob(user, sessionId, requestId)) ?? job;
  }
  const session = await getAssistantSession(
    user,
    sessionId,
    requestId,
    pageSize ? { size: pageSize } : undefined
  );
  if (session.requestCommitted) return session;
  if (assistantJobActive(job.status))
    throw new TRPCError({
      code: "TIMEOUT",
      message: "本轮在后台继续处理，请按原请求号核对。",
    });
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: assistantJobErrors[job.failureCode ?? ""] ?? "此次请求已经停止。",
  });
}
