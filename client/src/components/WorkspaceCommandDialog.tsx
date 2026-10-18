import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { ConsoleRoute } from "@shared/console-route";
import {
  filterWorkspaceCommands,
  workspaceCommands,
} from "@shared/workspace-commands";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Button } from "./ui/button";
import {
  ArrowUpRight,
  FolderKanban,
  Workflow,
  Compass,
  Loader2,
} from "lucide-react";

export default function WorkspaceCommandDialog({
  canManageIdentity,
  isAdmin,
  onClose,
  onNavigate,
}: {
  canManageIdentity: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onNavigate: (route: ConsoleRoute) => void;
}) {
  const [search, setSearch] = useState("");
  const [settled, setSettled] = useState("");
  const navigating = useRef(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setSettled(search.trim().slice(0, 100)),
      250
    );
    return () => clearTimeout(timer);
  }, [search]);
  const enabled = Boolean(settled);
  const projects = trpc.project.page.useQuery(
    { search: settled, limit: 5 },
    { enabled, retry: false, staleTime: 0, refetchOnWindowFocus: false }
  );
  const workflows = trpc.workflow.search.useQuery(
    { search: settled },
    { enabled, retry: false, staleTime: 0, refetchOnWindowFocus: false }
  );
  const commands = filterWorkspaceCommands(
    workspaceCommands(canManageIdentity, isAdmin),
    search
  );
  const waiting = search.trim().slice(0, 100) !== settled;
  const pending =
    waiting || (enabled && (projects.isFetching || workflows.isFetching));
  function go(route: ConsoleRoute) {
    navigating.current = true;
    onClose();
    onNavigate(route);
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-workspace-command=""
        className="flex max-h-[min(680px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={event => {
          if (navigating.current) event.preventDefault();
        }}
      >
        <div className="px-5 pb-3 pt-5 pr-16">
          <DialogTitle>快捷查找</DialogTitle>
          <DialogDescription className="mt-1">
            搜索业务、流程或页面，只显示当前账号有权访问的结果。
          </DialogDescription>
        </div>
        <Command shouldFilter={false} className="min-h-0">
          <CommandInput
            aria-label="搜索业务、流程或页面"
            placeholder="输入名称或关键词…"
            value={search}
            onValueChange={setSearch}
            maxLength={100}
          />
          <CommandList className="max-h-[min(440px,60dvh)] p-2">
            {commands.length > 0 && (
              <CommandGroup heading="前往页面">
                {commands.map(item => (
                  <CommandItem
                    key={item.label}
                    value={item.label}
                    onSelect={() => go(item.route)}
                    className="min-h-14 gap-3 rounded-xl"
                  >
                    <Compass className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.label}</span>
                      <span className="aiflow-type-meta block text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {pending && (
              <p
                role="status"
                className="flex items-center gap-2 p-3 text-muted-foreground"
              >
                <Loader2 size={16} className="animate-spin" />
                正在查找…
              </p>
            )}
            {!waiting && enabled && (
              <>
                {projects.isError && (
                  <div role="alert" className="p-3 text-aiflow-danger">
                    业务查找失败。
                    <Button
                      variant="ghost"
                      onClick={() => void projects.refetch()}
                    >
                      重试业务查找
                    </Button>
                  </div>
                )}
                {workflows.isError && (
                  <div role="alert" className="p-3 text-aiflow-danger">
                    流程查找失败。
                    <Button
                      variant="ghost"
                      onClick={() => void workflows.refetch()}
                    >
                      重试流程查找
                    </Button>
                  </div>
                )}
                {!projects.isError &&
                  !projects.isFetching &&
                  Boolean(projects.data?.items.length) && (
                    <CommandGroup heading="业务项目">
                      {projects.data!.items.map(item => (
                        <CommandItem
                          key={item.id}
                          value={`project-${item.id}`}
                          onSelect={() =>
                            go({
                              section: "flows",
                              view: "workspace",
                              projectId: item.id,
                            })
                          }
                          className="min-h-14 gap-3 rounded-xl"
                        >
                          <FolderKanban className="size-4 shrink-0 text-aiflow-success" />
                          <span className="min-w-0">
                            <span className="block break-words font-medium">
                              {item.name}
                            </span>
                            <span className="aiflow-type-meta text-muted-foreground">
                              {item.code}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                {!workflows.isError &&
                  !workflows.isFetching &&
                  Boolean(workflows.data?.length) && (
                    <CommandGroup heading="流程">
                      {workflows.data!.map(item => (
                        <CommandItem
                          key={item.id}
                          value={`workflow-${item.id}`}
                          onSelect={() =>
                            go({
                              section: "flows",
                              view: "detail",
                              workflowId: item.id,
                            })
                          }
                          className="min-h-14 gap-3 rounded-xl"
                        >
                          <Workflow className="size-4 shrink-0 text-aiflow-info" />
                          <span className="min-w-0">
                            <span className="block break-words font-medium">
                              {item.name}
                            </span>
                            <span className="aiflow-type-meta text-muted-foreground">
                              {item.flowType === "data"
                                ? "数据流程"
                                : item.flowType === "control"
                                  ? "控制流程"
                                  : "状态流程"}{" "}
                              ·{" "}
                              {item.status === "published" ? "已发布" : "草稿"}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                {!pending &&
                  !projects.isError &&
                  !workflows.isError &&
                  !commands.length &&
                  !projects.data?.items.length &&
                  !workflows.data?.length && (
                    <p
                      role="status"
                      className="p-8 text-center text-muted-foreground"
                    >
                      没有找到可访问的结果，请换个关键词。
                    </p>
                  )}
              </>
            )}
          </CommandList>
        </Command>
        <div className="aiflow-type-meta flex flex-wrap justify-between gap-2 border-t border-border bg-muted/50 px-5 py-3 text-muted-foreground">
          <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>每类最多 5 项，输入更多文字缩小范围</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
