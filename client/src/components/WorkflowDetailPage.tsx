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
};

export function WorkflowDetailPage({
  workflow,
  definition,
  canEdit,
  canPublish,
  onClose,
  onOpen,
}: WorkflowDetailPageProps) {
  if (!workflow || !definition) {
    return (
      <div
        data-aiflow-process-detail-page=""
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-[#f5f7fb] p-6"
      >
        <div className="border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
          正在读取受权流程详情…
        </div>
      </div>
    );
  }

  return (
    <div
      data-aiflow-process-detail-page=""
      className="min-h-[calc(100vh-48px)] bg-[#fcfcfd] p-4 sm:p-5"
    >
      <div>
        <div data-aiflow-context-header className="mb-3.5 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[.18em] text-[#5b72a8]">
              PROCESS DETAIL
            </p>
            <h1 className="mt-0.5 text-base font-semibold text-slate-900">
              {workflow.name}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              当前详情仅承载已授权流程数据；关闭后返回当前业务的流程设计中心。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-slate-200 hover:bg-slate-50" onClick={onClose}>
              ← 返回流程设计中心
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs bg-slate-900 hover:bg-slate-800 text-white shadow-2xs font-medium"
              onClick={onOpen}
            >
              进入设计器
            </Button>
          </div>
        </div>
        <WorkflowGovernance
          workflowId={workflow.id}
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
