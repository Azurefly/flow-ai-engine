import type { Definition } from "../../../server/workflow-service";
import { Button } from "@/components/ui/button";
import WorkflowCanvas from "./WorkflowCanvas";
import WorkflowGovernance from "./WorkflowGovernance";

type WorkflowDetailRecord = {
  id: string;
  name: string;
  flowType?: "state" | "control" | "data" | null;
};

type WorkflowDetailPageProps = {
  workflow: WorkflowDetailRecord | null;
  definition: Definition | null;
  canEdit: boolean;
  canPublish: boolean;
  onClose: () => void;
  onOpen: () => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export function WorkflowDetailPage({
  workflow,
  definition,
  canEdit,
  canPublish,
  onClose,
  onOpen,
  loading = false,
  error = null,
  onRetry,
}: WorkflowDetailPageProps) {
  const retry = onRetry ?? (() => {
    if (typeof window !== "undefined") window.location.reload();
  });

  if (loading) {
    return (
      <div
        data-aiflow-process-detail-page=""
        data-aiflow-detail-state="loading"
        role="status"
        aria-live="polite"
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f5f7fb] p-6"
      >
        <div className="border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
          正在读取受权流程详情…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-aiflow-process-detail-page=""
        data-aiflow-detail-state="error"
        role="alert"
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f5f7fb] p-6"
      >
        <div className="w-full max-w-lg border border-rose-200 bg-white px-5 py-5 text-sm shadow-sm">
          <p className="font-semibold text-rose-800">流程详情加载失败</p>
          <p className="mt-2 leading-6 text-slate-600">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              返回流程设计中心
            </Button>
            <Button type="button" onClick={retry}>
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div
        data-aiflow-process-detail-page=""
        data-aiflow-detail-state="empty"
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f5f7fb] p-6"
      >
        <div className="w-full max-w-lg border border-slate-200 bg-white px-5 py-5 text-sm shadow-sm">
          <p className="font-semibold text-slate-800">暂无可访问的流程详情</p>
          <p className="mt-2 leading-6 text-slate-500">
            流程可能已被归档、删除，或当前账号没有查看权限。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              返回流程设计中心
            </Button>
            <Button type="button" onClick={retry}>
              重新读取
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!definition) {
    return (
      <div
        data-aiflow-process-detail-page=""
        data-aiflow-detail-state="definition-error"
        role="alert"
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f5f7fb] p-6"
      >
        <div className="w-full max-w-lg border border-rose-200 bg-white px-5 py-5 text-sm shadow-sm">
          <p className="font-semibold text-rose-800">流程定义暂不可用</p>
          <p className="mt-2 leading-6 text-slate-600">
            已读取“{workflow.name}”，但服务端没有返回可预览的流程定义。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              返回流程设计中心
            </Button>
            <Button type="button" onClick={retry}>
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-aiflow-process-detail-page=""
      className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-7xl">
        <div data-aiflow-context-header className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[.18em] text-[#5b72a8]">
              PROCESS DETAIL
            </p>
            <h1 className="mt-1 text-lg font-semibold text-slate-800">
              {workflow.name}
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              当前详情仅承载已授权流程数据；关闭后返回当前业务的流程设计中心。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              ← 返回流程设计中心
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-[#2d6bea] hover:bg-[#245fc8]"
              onClick={onOpen}
            >
              进入设计器
            </Button>
          </div>
        </div>
        <WorkflowGovernance
          workflowId={workflow.id}
          definition={definition}
          canEdit={canEdit}
          canPublish={canPublish}
          canvas={
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3">
                <div>
                  <p className="text-[10px] font-bold tracking-[.18em] text-[#5b72a8]">
                    READ-ONLY CANVAS
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-800">
                    流程图只读预览
                  </h2>
                </div>
                <span className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                  详情页不会写入流程定义
                </span>
              </div>
              <WorkflowCanvas
                workflowId={workflow.id}
                flowType={workflow.flowType ?? "state"}
                definition={definition}
                readOnly
                showCanvasActions={false}
              />
            </>
          }
        />
      </div>
    </div>
  );
}
