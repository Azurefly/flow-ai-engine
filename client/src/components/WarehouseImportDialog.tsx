import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  newResourceRequestKey,
  resourceRequestKeyPattern,
} from "@shared/resource-creation";
import { CreationDialog } from "./CreationDialog";
import { Button } from "./ui/button";
import { consoleNavigationEvent } from "@/lib/console-navigation-guard";
import type { WarehouseImportItem } from "../../../server/warehouse-import";

type Plan = {
  version: 1;
  filename: string;
  payload: unknown;
  preserveCodes: boolean;
  folderId: string | null;
  folderName: string;
  items: WarehouseImportItem[] | null;
  keys: string[];
  results: Record<number, { id?: string; message: string }>;
};
const labels = { state: "状态", control: "控制", data: "数据" };
export default function WarehouseImportDialog({
  open,
  projectId,
  projectName,
  folderId,
  folderName,
  userId,
  onClose,
  onImported,
}: {
  open: boolean;
  projectId: string;
  projectName: string;
  folderId: string | null;
  folderName: string;
  userId: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const storageKey = `flow-warehouse-import:${userId}:${projectId}`;
  const [plan, setPlan] = useState<Plan | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return saved?.version === 1 &&
        typeof saved.filename === "string" &&
        typeof saved.folderName === "string" &&
        typeof saved.preserveCodes === "boolean" &&
        (saved.folderId === null || typeof saved.folderId === "string") &&
        Array.isArray(saved.keys) &&
        saved.keys.length <= 100 &&
        saved.keys.every(
          (key: unknown) =>
            typeof key === "string" && resourceRequestKeyPattern.test(key)
        ) &&
        saved.results &&
        typeof saved.results === "object" &&
        !Array.isArray(saved.results) &&
        Object.values(saved.results).every(
          (result: any) =>
            result &&
            typeof result.message === "string" &&
            (result.id === undefined || typeof result.id === "string")
        ) &&
        (saved.items === null ||
          (Array.isArray(saved.items) &&
            saved.items.length === saved.keys.length &&
            saved.items.every(
              (item: any, index: number) =>
                item?.index === index &&
                typeof item.name === "string" &&
                (item.flowType === null ||
                  ["state", "control", "data"].includes(item.flowType)) &&
                Array.isArray(item.errors) &&
                item.errors.every(
                  (message: unknown) => typeof message === "string"
                ) &&
                Array.isArray(item.warnings) &&
                item.warnings.every(
                  (message: unknown) => typeof message === "string"
                )
            )))
        ? saved
        : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preview = trpc.project.previewWorkflowImport.useMutation({
    retry: false,
  });
  const create = trpc.project.createWorkflow.useMutation({ retry: false });
  const persist = (next: Plan) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setPlan(next);
      return true;
    } catch {
      setError(
        "浏览器无法保存导入记录，请释放当前站点存储空间后重试；本次不会提交创建。"
      );
      return false;
    }
  };
  useEffect(() => {
    if (!busy) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: Event) => {
      event.preventDefault();
      setError("正在处理本批次，请等待当前请求返回后离开。");
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(consoleNavigationEvent, navigate);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener(consoleNavigationEvent, navigate);
    };
  }, [busy]);
  const submit = async () => {
    if (!plan || busy) return;
    setBusy(true);
    setError("");
    let current = plan;
    try {
      if (!current.items) {
        const checked = await preview.mutateAsync({
          projectId,
          payload: current.payload,
          preserveCodes: current.preserveCodes,
        });
        persist({
          ...current,
          items: checked.items,
          keys: checked.items.map(() => newResourceRequestKey()),
        });
        return;
      }
      if (current.items.some(item => item.errors.length)) return;
      for (const item of current.items) {
        if (current.results[item.index]?.id) continue;
        // Persist the exact request identity before sending. Explicit resume reuses it.
        current = {
          ...current,
          results: {
            ...current.results,
            [item.index]: { message: "结果待核对" },
          },
        };
        if (!persist(current)) return;
        try {
          const created = await create.mutateAsync({
            projectId,
            folderId: current.folderId,
            requestKey: current.keys[item.index],
            name: item.name,
            description: item.description,
            processCode: item.processCode,
            flowType: item.flowType!,
            creationSource: "warehouse",
            definition: item.definition,
          });
          current = {
            ...current,
            results: {
              ...current.results,
              [item.index]: { id: String(created.id), message: "已创建草稿" },
            },
          };
          if (!persist(current)) return;
          onImported();
        } catch (failure) {
          const message =
            failure instanceof Error
              ? failure.message
              : "创建结果未确认，请核对后继续。";
          current = {
            ...current,
            results: { ...current.results, [item.index]: { message } },
          };
          persist(current);
          setError(
            "当前项未确认成功，后续项尚未执行。可核对并继续；已成功项不会再次创建。"
          );
          return;
        }
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "预检失败，请重试。"
      );
    } finally {
      setBusy(false);
    }
  };
  const items = plan?.items ?? [],
    succeeded = Object.values(plan?.results ?? {}).filter(
      result => result.id
    ).length;
  const complete = items.length > 0 && succeeded === items.length;
  return (
    <CreationDialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) onClose();
      }}
      title="导入流程"
      cancelLabel="关闭并保留记录"
      description={`目标业务：${projectName}。先预检全部条目，再创建未审核草稿；不导入运行、授权或外部资源，发布前须核对处理人与资源。`}
      pending={busy}
      className="max-w-3xl"
      submitLabel={
        !plan?.items
          ? "开始预检"
          : complete
            ? "本批次已完成"
            : succeeded || Object.keys(plan.results).length
              ? "核对并继续导入"
              : `确认导入 ${items.length} 项`
      }
      submitDisabled={
        !plan ||
        complete ||
        Boolean(plan.items?.some(item => item.errors.length))
      }
      errorMessage={error || undefined}
      errorHint="导入记录保留在当前浏览器会话，重新打开可继续核对。"
      onSubmit={submit}
    >
      {!plan ? (
        <label className="grid gap-2 aiflow-type-body">
          选择流程 JSON（最多100项、1 MiB）
          <input
            aria-label="选择流程导入文件"
            type="file"
            accept=".json,application/json"
            onChange={async event => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError("");
              try {
                if (file.size > 1024 * 1024)
                  throw Error("导入文件不得超过1 MiB。");
                const payload = JSON.parse(
                  (await file.text()).replace(/^\uFEFF/, "")
                );
                persist({
                  version: 1,
                  filename: file.name,
                  payload,
                  preserveCodes: false,
                  folderId,
                  folderName,
                  items: null,
                  keys: [],
                  results: {},
                });
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "文件格式无效。"
                );
              }
              event.target.value = "";
            }}
          />
        </label>
      ) : (
        <>
          <p className="aiflow-type-body break-words">
            {plan.filename} · 目录：{plan.folderName} · 已成功 {succeeded}/
            {items.length || "待预检"}
          </p>
          {!Object.keys(plan.results).length && (
            <label className="flex items-center gap-2 aiflow-type-body">
              <input
                type="checkbox"
                checked={plan.preserveCodes}
                onChange={event =>
                  persist({
                    ...plan,
                    preserveCodes: event.target.checked,
                    items: null,
                    keys: [],
                  })
                }
              />
              保留文件中的流程代号（默认生成新代号）
            </label>
          )}
          {plan.items && (
            <div className="grid gap-3">
              {items.map(item => (
                <section
                  key={item.index}
                  className="rounded-lg border border-border p-3 aiflow-type-body"
                >
                  <div className="flex justify-between gap-3">
                    <h3 className="min-w-0 break-words font-semibold">
                      {item.index + 1}. {item.name}
                    </h3>
                    <span className="shrink-0">
                      {item.flowType ? labels[item.flowType] : "类型无效"}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    代号：{item.processCode || "自动生成"} ·{" "}
                    {plan.results[item.index]?.message ||
                      (item.errors.length ? "预检不通过" : "可创建草稿")}
                  </p>
                  {plan.results[item.index]?.id && (
                    <p className="mt-1 break-all">
                      流程编号：{plan.results[item.index].id}
                    </p>
                  )}
                  {item.errors.map((message, index) => (
                    <p
                      role="alert"
                      key={index}
                      className="mt-1 text-aiflow-danger"
                    >
                      {message}
                    </p>
                  ))}
                  {item.warnings.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-aiflow-warning">
                        需重新绑定的数据资源（{item.warnings.length}）
                      </summary>
                      {item.warnings.map((message, index) => (
                        <p key={index} className="mt-1">
                          {message}
                        </p>
                      ))}
                    </details>
                  )}
                </section>
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              try {
                sessionStorage.removeItem(storageKey);
                setPlan(null);
                setError("");
              } catch {
                setError("无法清除本地导入记录。");
              }
            }}
          >
            结束本批次并重新选文件
          </Button>
          <p className="aiflow-type-meta text-muted-foreground">
            结束或关闭不会撤销已创建流程。结果未确认时，请优先核对并继续，避免换批次重复导入。
          </p>
        </>
      )}
    </CreationDialog>
  );
}
