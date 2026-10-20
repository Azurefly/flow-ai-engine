import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const notice = readFileSync(
  new URL(
    "../client/src/components/WorkflowSubflowSnapshots.tsx",
    import.meta.url
  ),
  "utf8"
);
const home = readFileSync(
  new URL("../client/src/pages/Home.tsx", import.meta.url),
  "utf8"
);
const canvas = readFileSync(
  new URL("../client/src/components/WorkflowCanvas.tsx", import.meta.url),
  "utf8"
);
const css = readFileSync(
  new URL("../client/src/index.css", import.meta.url),
  "utf8"
);
it("标题位于提示和画布之前，窄屏快照操作不会压缩说明文字", () => {
  expect(css).toContain(
    "[data-aiflow-designer] > [data-aiflow-context-header]"
  );
  expect(css).not.toContain("[data-aiflow-designer] > :nth-child(n + 5)");
  expect(notice).toContain("grid min-w-0 gap-3 sm:flex");
  expect(notice).toContain("sm:w-auto sm:shrink-0");
});
it("引用信息按保存的快照展示，不额外读取个人库，也不克隆整张图", () => {
  expect(notice).toContain(
    "node.config.resolvedSubflowId === node.config.subflowId"
  );
  expect(notice).toContain("resolvedSubflowUpdatedAt");
  expect(notice).toContain("查看本页快照信息");
  expect(notice).not.toContain("useQuery");
  expect(notice).not.toContain("structuredClone");
});
it("更新入口防止重复提交，异常后先核对版本，保留当前填写", () => {
  expect(notice).toContain("lock.current");
  expect(notice).toContain("busy || saving || Boolean(error)");
  expect(notice).toContain("核对保存结果并保留修改");
  expect(notice).toContain("currentVersion.current === submittedVersion");
  expect(notice).toContain("[savedVersion]");
  expect(home).toContain("onRefreshSubflows={async () =>");
  expect(home).toContain("请先取消发布，再更新草稿快照。");
  expect(home).toContain("key={`subflow-snapshots:${workflow.id}`}");
  expect(home).not.toContain("<WorkflowSubflowSnapshots key={workflow.id}");
});
it("切换引用时清除旧快照；更新入口以实际草稿版本保存", () => {
  expect(canvas).toContain("value !== selectedConfig.subflowId");
  expect(canvas).toContain("resolvedSubflowDefinition: undefined");
  const action = home.slice(
    home.indexOf("onRefreshSubflows={async () =>"),
    home.indexOf("onResolveSubflowSave=")
  );
  expect(action).toContain(
    "workflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current)"
  );
  expect(action).toContain("definition: draftDefinition");
  expect(action).not.toContain("!isDraftDirty");
});
it("切换已缓存流程时等待匹配基准，不在渲染过程中抛出提交错误", () => {
  expect(home).toContain(
    "const draftBaseVersion = readWorkflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current)"
  );
  expect(home).toContain("!access.data || draftBaseVersion === null");
  expect(home).toContain("正在准备流程草稿…");
  expect(home).not.toContain("draftBaseVersion={workflowDraftBaseVersion(");
});
