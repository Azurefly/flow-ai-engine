import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const workspace = readFileSync(
  new URL("../client/src/components/ProjectWorkspace.tsx", import.meta.url),
  "utf8"
).replace(/\s+/g, " ");
const session = readFileSync(
  new URL("../client/src/components/ResourceDraftSession.tsx", import.meta.url),
  "utf8"
);
const picker = readFileSync(
  new URL(
    "../client/src/components/SearchableMultiSelect.tsx",
    import.meta.url
  ),
  "utf8"
);
const members = workspace.slice(workspace.indexOf("function ProjectMembers("));
it("成员和部门填写放在当前账号的内存草稿中，恢复页面不重置填写", () => {
  expect(
    members.match(/useResourceDraftState/g)?.length
  ).toBeGreaterThanOrEqual(8);
  expect(members).toContain('"project-authorization"');
  expect(members).toContain("memberSelection");
  expect(members).toContain("unitSelection");
  expect(session).toContain("离开前保留授权填写");
  expect(session).toContain("不会撤销可能已经提交的授权");
});
it("提交锁定字段、目录弹层、重复提交及离开，已确认成功先清空草稿再刷新", () => {
  expect(
    members.match(/fieldset disabled=\{busy \|\| !canManage\}/g)
  ).toHaveLength(2);
  expect(members).toContain("submitting.current");
  expect(members).toContain("const finish = beginPending()");
  expect(picker).toContain("open={open && !disabled}");
  const grant = members.slice(
    members.indexOf("const grant ="),
    members.indexOf("const revokeMember =")
  );
  expect(grant.indexOf("setForm(")).toBeLessThan(
    grant.indexOf("refreshAfterSave()")
  );
  expect(members).not.toContain("await refreshProjectAuthorization()");
});
it("失权、授权列表读取失败都保留填写，隐藏过期列表并明确重新读取入口", () => {
  expect(members).toContain("暂时无法确认保存结果，填写已保留");
  expect(members).toContain("管理权限暂不可用，已保留本次填写");
  expect(members).toContain("viewAllowed && !membersError && !membersLoading");
  expect(members).toContain(
    "viewAllowed && !projectUnits.isError && !projectUnits.isPending"
  );
  expect(members).toContain("重新读取业务授权");
  expect(workspace).toContain(
    "access.isError || (access.isSuccess && !capabilities.ready)"
  );
});
