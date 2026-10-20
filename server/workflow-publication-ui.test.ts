import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const project = readFileSync(
  new URL("../client/src/components/ProjectWorkspace.tsx", import.meta.url),
  "utf8"
);
it("编辑器按实际规则与编辑版本判断发布，预检前拦截并给出下一步", () => {
  expect(home).toContain("const publicationGate = workflowPublicationGate(");
  expect(home).toContain(
    "publication: access.isSuccess ? access.data?.publication : null"
  );
  expect(home).toContain("if (!publicationGate.allowed)");
  expect(home).toContain('data-workflow-publication-gate=""');
  expect(home).toContain("处理版本变化");
  expect(home).toContain("重新读取权限与规则");
  expect(project).toContain("publishBlockedReason");
  expect(project).toContain(
    "publicationRule?.requireProjectApproval === false"
  );
});
it("取消发布仅衔接基准，不替换本地画布；卸载后的回执不回写缓存", () => {
  const callback = home.slice(
    home.indexOf("  const onUnpublished ="),
    home.indexOf(
      "  const draftError =",
      home.indexOf("  const onUnpublished =")
    )
  );
  expect(callback).toContain("acknowledgeWorkflowUnpublish");
  expect(callback).toContain("!consoleAlive.current");
  expect(callback).not.toContain("setDraftDefinition");
  expect(callback).not.toContain("setDraftName");
  expect(home).toContain("consoleAlive.current = false");
});
it("结果不明时读取实际状态进行核对，核对中锁定关闭与重复请求", () => {
  const checking = home.slice(
    home.indexOf("  const reconcileUnpublish ="),
    home.indexOf(
      "  // Keep the shortcut callback",
      home.indexOf("  const reconcileUnpublish =")
    )
  );
  expect(checking).toContain('latest.status === "draft"');
  expect(checking).not.toContain("unpublishFlow.mutate");
  expect(checking).toContain("unpublishCheckLock.current");
  expect(home).toContain("核对取消发布结果");
  expect(home).toContain("关闭并保留修改");
  expect(home).toContain("!unpublishTarget && !unpublishBusy && canEdit");
});
