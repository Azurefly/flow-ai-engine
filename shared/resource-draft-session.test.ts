import { describe, expect, it } from "vitest";
import { ResourceDraftStore } from "./resource-draft-session";

describe("资源填写会话", () => {
  it("默认读取不登记草稿，页面位置和弹窗不算未保存业务数据", () => {
    const store = new ResourceDraftStore();
    expect(store.read("p1", "tags", "name", "")).toBe("");
    store.set("p1", "workspace", "view", "process", "resources", false);
    store.set("p1", "sources", "open", false, true, false);
    expect(store.stats()).toEqual({ count: 0, pending: 0 });
    expect(store.exportDrafts()).toEqual([]);
  });
  it("卸载订阅不删除填写，重新订阅可读取原值", () => {
    const store = new ResourceDraftStore();
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);
    store.set("p1", "sources", "form", { name: "" }, { name: "订单源" });
    unsubscribe();
    store.set("p1", "sources", "form", { name: "" }, value => ({
      ...value,
      name: "新订单源",
    }));
    expect(updates).toBe(1);
    expect(store.read("p1", "sources", "form", { name: "" })).toEqual({
      name: "新订单源",
    });
    expect(store.stats()).toEqual({ count: 1, pending: 0 });
  });
  it("同一类别的名称、字段和样本合并计数，并按业务隔离", () => {
    const store = new ResourceDraftStore();
    store.set("p1", "assets", "form", { name: "" }, { name: "订单" });
    store.set(
      "p1",
      "assets",
      "schema",
      [],
      [{ name: "order_id", type: "string" }]
    );
    store.set("p1", "assets", "sample", [], [{ key: "order_id", value: "1" }]);
    store.set("p2", "tags", "name", "", "标签");
    expect(store.stats().count).toBe(2);
    expect(store.stats("p1").count).toBe(1);
    expect(store.read("p2", "assets", "form", { name: "" })).toEqual({
      name: "",
    });
  });
  it("保存回默认值清理该类别，其余类别继续保留", () => {
    const store = new ResourceDraftStore();
    store.set("p1", "tags", "name", "", "标签");
    store.set("p1", "sources", "form", { name: "" }, { name: "订单" });
    store.set("p1", "tags", "name", "", "");
    expect(store.stats("p1").count).toBe(1);
    expect(store.exportDrafts().map(item => item.category)).toEqual([
      "sources",
    ]);
  });
  it("切换账号使用独立实例，清空当前会话不会影响其他实例", () => {
    const accountA = new ResourceDraftStore(),
      accountB = new ResourceDraftStore();
    accountA.set("p1", "tags", "name", "", "甲账号填写");
    expect(accountB.read("p1", "tags", "name", "")).toBe("");
    accountB.set("p1", "tags", "name", "", "乙账号填写");
    accountA.clear();
    expect(accountA.stats().count).toBe(0);
    expect(accountB.read("p1", "tags", "name", "")).toBe("乙账号填写");
  });
  it("提交锁独立于页面订阅，完成回调只释放一次", () => {
    const store = new ResourceDraftStore();
    const finishA = store.begin("p1", "sources"),
      finishB = store.begin("p1", "sources");
    const finishC = store.begin("p2", "tags");
    expect(store.stats()).toEqual({ count: 0, pending: 3 });
    expect(store.stats("p1").pending).toBe(2);
    finishA();
    finishA();
    expect(store.stats("p1").pending).toBe(1);
    finishB();
    finishC();
    expect(store.stats().pending).toBe(0);
  });
  it("清空填写不会伪造正在进行的提交已完成", () => {
    const store = new ResourceDraftStore();
    store.set("p1", "tags", "name", "", "标签");
    const finish = store.begin("p1", "tags");
    store.clear();
    expect(store.stats()).toEqual({ count: 0, pending: 1 });
    finish();
    expect(store.stats().pending).toBe(0);
  });
  it("导出只包含有改动的用户填写，不含弹窗、错误消息和保存锁", () => {
    const store = new ResourceDraftStore();
    store.set(
      "p1",
      "sources",
      "form",
      { name: "", credentialReference: "" },
      { name: "订单", credentialReference: "env:ORDER_READ" }
    );
    store.set("p1", "sources", "open", false, true, false);
    store.set("p1", "sources", "submitError", "", "读取失败", false);
    const finish = store.begin("p1", "sources");
    expect(store.exportDrafts()).toEqual([
      {
        projectId: "p1",
        category: "sources",
        field: "form",
        value: { name: "订单", credentialReference: "env:ORDER_READ" },
      },
    ]);
    finish();
  });
  it("相同值不产生更新，恢复 null 默认值按原基线判断", () => {
    const store = new ResourceDraftStore();
    let updates = 0;
    store.subscribe(() => updates++);
    store.set("p1", "tags", "name", "", "");
    expect(updates).toBe(0);
    store.set<string | null>("p1", "tags", "optional", null, "值");
    store.set<string | null>("p1", "tags", "optional", "不同默认值", null);
    expect(store.stats().count).toBe(0);
  });
});
