import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { formatConsoleRoute, type ConsoleRoute } from "@shared/console-route";
import { requestConsoleNavigation } from "@/lib/console-navigation-guard";

export default function ResourceAccessDiagnosticDialog({
  userId,
  name,
  onClose,
}: {
  userId: number;
  name: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [task, setTask] = useState("");
  const projects = trpc.project.page.useQuery(
    { limit: 20, search },
    { retry: false }
  );
  const flows = trpc.project.workflows.useQuery(
    { projectId: projectId || "00000000" },
    { enabled: !!projectId, retry: false }
  );
  const result = trpc.iam.resourceAccess.useQuery(
    { userId, workflowId: workflowId || "00000000", taskId: task || undefined },
    { enabled: !!workflowId, retry: false }
  );
  const flowItems = (flows.data ?? []) as unknown as Array<{
    id: string;
    name: string;
  }>;
  const selectClass =
    "h-10 min-w-0 rounded border border-border bg-card px-2 aiflow-type-body";
  const go = (route: ConsoleRoute) =>
    requestConsoleNavigation(() => {
      onClose();
      window.location.hash = formatConsoleRoute(route);
    });
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>资源级权限诊断 · {name}</DialogTitle>
          <DialogDescription>
            核对业务、流程授权来源及指定任务的当前办理资格。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <form
            className="flex gap-2"
            onSubmit={event => {
              event.preventDefault();
              if (query === search) void projects.refetch();
              setSearch(query.trim());
            }}
          >
            <Input
              aria-label="查找诊断业务"
              placeholder="按业务名称或编号搜索"
              value={query}
              maxLength={100}
              onChange={event => setQuery(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={projects.isFetching}
            >
              查找业务
            </Button>
          </form>
          {projects.isError && (
            <p role="alert">业务读取失败：{projects.error.message}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1 aiflow-type-body">
              业务
              <select
                className={selectClass}
                aria-label="诊断业务"
                value={projectId}
                onChange={event => {
                  setProjectId(event.target.value);
                  setWorkflowId("");
                  setTask("");
                  setTaskId("");
                }}
              >
                <option value="">请选择业务</option>
                {projects.data?.items.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-1 aiflow-type-body">
              流程
              <select
                className={selectClass}
                aria-label="诊断流程"
                value={workflowId}
                disabled={!projectId || flows.isFetching || flows.isError}
                onChange={event => {
                  setWorkflowId(event.target.value);
                  setTask("");
                  setTaskId("");
                }}
              >
                <option value="">
                  {flows.isFetching ? "正在读取流程…" : "请选择流程"}
                </option>
                {flowItems.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {projects.data?.hasMore && (
            <p className="aiflow-type-meta text-muted-foreground">
              业务超过20项，请细化搜索条件。
            </p>
          )}
          {flows.isError && (
            <p role="alert">
              流程读取失败：{flows.error.message}
              <Button variant="outline" onClick={() => void flows.refetch()}>
                重试
              </Button>
            </p>
          )}
          {workflowId && (
            <>
              <form
                className="flex gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  setTask(taskId.trim());
                  if (taskId.trim() === task) void result.refetch();
                }}
              >
                <Input
                  aria-label="诊断任务编号"
                  placeholder="可选：输入任务编号核对办理资格"
                  value={taskId}
                  maxLength={64}
                  minLength={8}
                  onChange={event => setTaskId(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={result.isFetching}
                >
                  核对任务
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={result.isFetching}
                  onClick={() => void result.refetch()}
                >
                  刷新
                </Button>
              </form>
              {result.isFetching && <p role="status">正在核对当前授权…</p>}
              {result.isError ? (
                <p role="alert" className="text-destructive">
                  诊断失败：{result.error.message}
                </p>
              ) : (
                result.data && (
                  <>
                    {result.data.user.status !== "active" && (
                      <p
                        role="status"
                        className="rounded bg-aiflow-warning-surface p-3"
                      >
                        账号已停用，当前无法登录或办理，保留的授权不生效。
                      </p>
                    )}
                    <p className="aiflow-type-meta text-muted-foreground">
                      {result.data.resource.name} ·{" "}
                      {result.data.resource.archivedAt
                        ? "流程已归档"
                        : result.data.resource.status === "published"
                          ? "已发布"
                          : "草稿"}{" "}
                      · 核对时间{" "}
                      {new Date(result.data.checkedAt).toLocaleString("zh-CN")}
                    </p>
                    <table className="w-full table-fixed text-left aiflow-type-body">
                      <thead className="bg-muted aiflow-type-control">
                        <tr>
                          <th className="w-32 p-2">操作权限</th>
                          <th className="w-24 p-2">当前授权</th>
                          <th className="p-2">有效来源 / 原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.data.checks.map(check => (
                          <tr
                            key={check.code}
                            className="border-b border-border"
                          >
                            <td className="p-2">{check.name}</td>
                            <td
                              className={`p-2 font-medium ${check.allowed ? "text-aiflow-success" : "text-aiflow-danger"}`}
                            >
                              {check.allowed ? "具备权限" : "未授权"}
                            </td>
                            <td className="break-words p-2">
                              {check.sources.join("；") || check.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="aiflow-type-meta text-muted-foreground">
                      发起、发布和办理还会实时校验流程状态、表单、处理人及资源。数据流程运行使用业务运行权限。
                    </p>
                    {result.data.task && (
                      <section className="rounded border border-border p-3">
                        <h3 className="aiflow-type-section-title font-semibold">
                          任务办理资格 ·{" "}
                          {result.data.task.canAct ? "具备" : "不具备"}
                        </h3>
                        <p className="mt-1 aiflow-type-body">
                          {result.data.task.reason}
                        </p>
                      </section>
                    )}
                    <details>
                      <summary className="cursor-pointer aiflow-type-control">
                        授权记录与有效期（{result.data.bindings.length}）
                      </summary>
                      <ul className="mt-2 grid gap-2 aiflow-type-body">
                        {result.data.bindings.map((binding, index) => (
                          <li
                            key={index}
                            className="rounded border border-border p-2"
                          >
                            {binding.kind}
                            {binding.unitName
                              ? ` · ${binding.unitName}`
                              : ""} · {binding.roleName} · {binding.state}
                            {binding.expiresAt
                              ? ` · 到期 ${new Date(binding.expiresAt).toLocaleString("zh-CN")}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          go({ section: "flows", view: "workspace", projectId })
                        }
                      >
                        打开业务工作区
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          go({ section: "flows", view: "detail", workflowId })
                        }
                      >
                        打开流程详情
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          go({ section: "system", view: "organization" })
                        }
                      >
                        查看组织授权
                      </Button>
                    </div>
                  </>
                )
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
