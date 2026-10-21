import { expect, it } from "vitest";
import { ResourceDraftStore } from "./resource-draft-session";
it("授权填写和选中名称按业务保存，只有输入进入导出，账号会话之间隔离", () => {
  const store = new ResourceDraftStore(),
    base = { userId: "", role: "viewer", hours: "" };
  store.set("one", "project-authorization", "member", base, {
    userId: "7",
    role: "designer",
    hours: "12",
  });
  store.set(
    "one",
    "project-authorization",
    "memberSelection",
    [],
    [{ value: "7", label: "所选账号" }],
    false
  );
  expect(store.hasDraftCategory("project-authorization", "one")).toBe(true);
  expect(store.hasDraftCategory("project-authorization", "two")).toBe(false);
  expect(store.stats("one").count).toBe(1);
  expect(store.exportDrafts().map(draft => draft.field)).toEqual(["member"]);
  expect(
    new ResourceDraftStore().hasDraftCategory("project-authorization")
  ).toBe(false);
});
it("成功确认后释放写入锁，延迟刷新不重现已保存草稿", () => {
  const store = new ResourceDraftStore(),
    base = { unitId: "", role: "viewer" };
  store.set("one", "project-authorization", "unit", base, {
    unitId: "dept",
    role: "designer",
  });
  const finish = store.begin("one", "project-authorization");
  store.set("one", "project-authorization", "unit", base, base);
  expect(store.stats("one")).toEqual({ count: 0, pending: 1 });
  expect(store.hasDraftCategory("project-authorization")).toBe(false);
  finish();
  expect(store.stats("one")).toEqual({ count: 0, pending: 0 });
  expect(store.read("one", "project-authorization", "unit", base)).toEqual(
    base
  );
});
