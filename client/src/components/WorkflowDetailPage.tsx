import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Definition } from "../../../server/workflow-service";
import { ChevronLeft } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import WorkflowCanvas from "./WorkflowCanvas";
import WorkflowGovernance, {
  type WorkflowGovernanceSection,
} from "./WorkflowGovernance";

type WorkflowDetailRecord = {
  id: string;
  name: string;
  flowType?: "state" | "control" | "data" | null;
  status?: string | null;
  auditStatus?: string | null;
  definitionVersion?: number | null;
};

type WorkflowDetailPageProps = {
  workflow: WorkflowDetailRecord | null;
  definition: Definition | null;
  canEdit: boolean;
  canPublish: boolean;
  onClose: () => void;
  onOpen: () => void;
};

const sections: Array<{ value: WorkflowGovernanceSection; label: string }> = [
  { value: "overview", label: "流程图与信息" },
  { value: "runs", label: "运行记录" },
  { value: "versions", label: "版本历史" },
];

function workflowTypeLabel(flowType?: WorkflowDetailRecord["flowType"]) {
  if (flowType === "data") return "数据流程";
  if (flowType === "control") return "控制流程";
  return "状态流程";
}

function workflowNameWithBreakpoints(name: string) {
  return name.split(/([_-])/g).map((part, index) => (
    <Fragment key={index}>
      {part}
      {part === "_" || part === "-" ? <wbr /> : null}
    </Fragment>
  ));
}

function auditLabel(status?: string | null) {
  if (status === "approved") return "审核通过";
  if (status === "rejected") return "审核驳回";
  return "待审核";
}

export function WorkflowDetailPage({
  workflow,
  definition,
  canEdit,
  canPublish,
  onClose,
  onOpen,
}: WorkflowDetailPageProps) {
  const [activeSection, setActiveSection] =
    useState<WorkflowGovernanceSection>("overview");

  useEffect(() => {
    setActiveSection("overview");
  }, [workflow?.id]);

  if (!workflow || !definition) {
    return (
      <div
        data-aiflow-process-detail-page=""
        className="grid min-h-[calc(100vh-56px)] place-items-center bg-background p-6"
      >
        <div className="border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
          正在读取授权流程详情…
        </div>
      </div>
    );
  }

  return (
    <div
      data-aiflow-process-detail-page=""
      className="min-h-[calc(100vh-48px)] bg-muted p-3 sm:p-5"
    >
      <header
        data-aiflow-context-header
        className="rounded-lg border border-border bg-card shadow-sm"
      >
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1 h-11 min-h-11 w-full justify-start px-2 text-xs text-muted-foreground sm:h-9 sm:w-auto"
              onClick={onClose}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              返回流程中心
            </Button>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h1
                title={workflow.name}
                className="aiflow-type-page-title min-w-0 max-w-full line-clamp-2 [overflow-wrap:anywhere] font-semibold text-foreground"
              >
                {workflowNameWithBreakpoints(workflow.name)}
              </h1>
              <span className="rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {workflowTypeLabel(workflow.flowType)}
              </span>
              <span className="rounded bg-aiflow-info-surface px-2 py-1 text-[11px] text-aiflow-info">
                {`v${workflow.definitionVersion ?? "—"}`}
              </span>
            </div>
            <div
              aria-label="流程状态摘要"
              className="mt-2 flex flex-wrap gap-2 text-xs"
            >
              <span className="rounded-full border border-border px-2.5 py-1 text-muted-foreground">
                审核：{auditLabel(workflow.auditStatus)}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 ${workflow.status === "published" ? "border-aiflow-success-border bg-aiflow-success-surface text-aiflow-success" : "border-border bg-muted text-muted-foreground"}`}
              >
                发布：{workflow.status === "published" ? "已发布" : "未发布"}
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="h-11 min-h-11 shrink-0 sm:h-9"
            onClick={onOpen}
          >
            进入设计器
          </Button>
        </div>
      </header>

      <Tabs
        value={activeSection}
        onValueChange={value =>
          setActiveSection(value as WorkflowGovernanceSection)
        }
        className="mt-4"
      >
        <TabsList
          aria-label="流程详情分区"
          className="grid h-auto w-full min-w-0 grid-cols-3 gap-1 rounded-none border-b border-border bg-transparent p-0 sm:flex sm:flex-wrap"
        >
          {sections.map(section => (
            <TabsTrigger
              key={section.value}
              value={section.value}
              className="aiflow-type-control h-10 min-w-0 whitespace-normal rounded-none border-b-2 border-transparent px-2 text-muted-foreground shadow-none data-[state=active]:border-blue-600 data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-aiflow-info data-[state=active]:shadow-none sm:px-4"
            >
              {section.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {sections.map(section => (
          <TabsContent
            key={section.value}
            value={section.value}
            className="mt-4 min-w-0"
            forceMount
            hidden={activeSection !== section.value}
          >
            <WorkflowGovernance
              workflowId={workflow.id}
              canEdit={canEdit}
              canPublish={canPublish}
              activeSection={section.value}
              canvas={
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        流程图
                      </h2>
                      <p className="aiflow-type-body mt-0.5 text-muted-foreground">
                        只读预览；流程定义不会在此页面修改。
                      </p>
                    </div>
                    <div
                      data-aiflow-detail-canvas-actions=""
                      className="flex items-center gap-2"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() =>
                          window.dispatchEvent(
                            new Event("flow:save-canvas-image")
                          )
                        }
                      >
                        导出图片
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() =>
                          window.dispatchEvent(
                            new Event("flow:fullscreen-canvas")
                          )
                        }
                      >
                        全屏查看
                      </Button>
                    </div>
                  </div>
                  <WorkflowCanvas
                    workflowId={workflow.id}
                    flowType={workflow.flowType ?? "state"}
                    definition={definition}
                    readOnly
                    compactReadOnlyPreview
                    showCanvasActions={false}
                  />
                </div>
              }
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
