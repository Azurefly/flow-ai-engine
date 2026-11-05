import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const notice = readFileSync(
  new URL("../client/src/components/WorkflowAccessNotice.tsx", import.meta.url),
  "utf8"
);
it("编辑器、详情和运行监控共用已确认查看权限的边界", () => {
  expect(home).toContain('workflowContentState === "granted"');
  expect(
    home.match(/workflowContentState !== "granted"/g)?.length
  ).toBeGreaterThanOrEqual(2);
  const globalHeader = readFileSync(new URL("../client/src/components/WorkspaceHeader.tsx", import.meta.url), "utf8");
  expect(home).toContain("<WorkspaceHeader");
  expect(globalHeader).not.toContain("selectedWorkflow");
  expect(home).toContain('flowView === "editor" && canViewWorkflow &&');
  expect(home).toContain(
    "workflows.isSuccess && !workflows.isFetching && workspaceWorkflows.map"
  );
});
it("复核使用当前路由身份和前台定时策略，读取失败可明确重试", () => {
  expect(home).toContain('id: effectiveWorkflowId ?? "00000000"');
  expect(home).toContain(
    "authorizationQueryPolicy(Boolean(effectiveWorkflowId"
  );
  expect(notice).toContain("重新检查流程权限");
  expect(notice).toContain("当前账号无权查看此流程");
  expect(notice).toContain("暂时无法读取流程内容");
  expect(notice).toContain("本次会话中的未保存修改已保留");
  expect(home).toContain("errorCode: access.error?.data?.code");
  expect(home).toContain("workflowReadFailureState(selectedWorkflowQuery.error.data?.code)");
  expect(notice).toContain("登录失效、权限变更或流程不存在");
});
it("详情、设计器及监控读取失败保留请求身份，复制权限拒绝与临时错误使用相同分类", () => {
  const failures = [...home.matchAll(/if \(!workflow \|\| workflow.id !== route.workflowId\) \{([\s\S]*?)\n\s*\}/g)];
  expect(failures).toHaveLength(2);
  for (const [, branch] of failures) {
    expect(branch).not.toContain("replaceWith");
    expect(branch).toContain("setSelectedWorkflowId(route.workflowId)");
    expect(branch).toContain("setSelectedProject(null)");
    expect(branch).toContain("canonicalize()");
  }
  const creation = readFileSync(new URL("../client/src/components/WorkflowCreateDialog.tsx", import.meta.url), "utf8");
  expect(creation).toContain("copying && creation.uncertain ? recoveryAccess : access");
  expect(creation).toContain("!permitted && (permissionRead.isSuccess");
  expect(creation).toContain('workflowReadFailureState(permissionRead.error?.data?.code) === "denied"');
  expect(creation).toContain("无权创建此流程或来源不可用");
  expect(creation).toContain("暂时无法确认创建权限");
});
it("已知失权时不提供缓存导出，原草稿由根状态保留", () => {
  const exported = home.slice(
    home.indexOf("  const exportCurrent ="),
    home.indexOf("  const reloadLatestDraft =")
  );
  expect(exported).toContain("if (!canViewWorkflow)");
  expect(notice).not.toContain("导出");
  expect(notice).not.toContain("setDraftDefinition");
  expect(home).toContain("retainedDraft={Boolean(isDraftDirty");
  expect(home).toContain("open={Boolean(draftConflict) && canViewWorkflow}");
});
it("运行监控失权时隐藏内容并暂停读取，同一实例的操作原因保留在组件状态", () => {
  const monitor = readFileSync(
    new URL("../client/src/components/RunCenter.tsx", import.meta.url),
    "utf8"
  );
  const dataMonitor = readFileSync(
    new URL("../client/src/components/DataResourceCenter.tsx", import.meta.url),
    "utf8"
  );
  expect(home).toContain(
    "mountedMonitorWorkflowId.current !== effectiveWorkflowId"
  );
  expect(home).toContain('viewAllowed={workflowContentState === "granted"}');
  expect(home).toContain("blockedContent={workflowAccessNotice}");
  expect(home).toContain("queryErrorCode: runDetail.error?.data?.code");
  expect(monitor).toContain("if (!viewAllowed) return blockedContent ?? null;");
  expect(monitor).toContain("enabled: Boolean(viewAllowed && workflowId)");
  expect(monitor).toContain("}, [workflowId, selectedRunId]);");
  expect(monitor).not.toContain("}, [viewAllowed");
  expect(dataMonitor).toContain(
    "if (!viewAllowed) return blockedContent ?? null;"
  );
  expect(dataMonitor).toContain(
    "{projectId && workflowId && <div hidden={Boolean(selectedRunId)}><DataflowOperationList"
  );
});
