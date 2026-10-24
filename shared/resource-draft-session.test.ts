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

describe("资源提交结果确认", () => {
  const payload = () => ({
    projectId: "p1",
    name: "订单",
    schema: [{ name: "id" }],
  });
  it("同一填写重试沿用原标识，调整对象字段顺序不生成新请求", () => {
    const store = new ResourceDraftStore();
    const first = store.prepareCreation("p1", "assets", payload());
    expect(first.key).toMatch(/^[a-f0-9]{48}$/);
    expect(
      store.prepareCreation("p1", "assets", {
        schema: [{ name: "id" }],
        name: "订单",
        projectId: "p1",
      }).key
    ).toBe(first.key);
  });
  it("提交快照不随原表单对象后续修改而变化", () => {
    const store = new ResourceDraftStore(),
      form = payload();
    const attempt = store.prepareCreation("p1", "assets", form);
    form.name = "已修改";
    form.schema[0].name = "changed";
    expect(attempt.payload.name).toBe("订单");
    expect(attempt.payload.schema).toEqual([{ name: "id" }]);
  });
  it("网络错误保留快照并阻止更换内容，不依赖原表单是否仍挂载", () => {
    const store = new ResourceDraftStore(),
      attempt = store.prepareCreation("p1", "assets", payload());
    store.failCreation(
      "p1",
      "assets",
      attempt.key,
      new Error("Failed to fetch")
    );
    expect(store.stats()).toEqual({ count: 1, pending: 0 });
    expect(store.hasUncertainCreation("p1")).toBe(true);
    expect(store.hasUncertainCreation("p2")).toBe(false);
    expect(store.prepareCreation("p1", "assets", payload()).key).toBe(
      attempt.key
    );
    expect(() =>
      store.prepareCreation("p1", "assets", { ...payload(), name: "其他" })
    ).toThrow("先核对");
    expect(store.exportDrafts()).toEqual([]);
  });
  it("未知结果后权限被收回仍保留原标识，恢复权限后可核对原保存", () => {
    const store = new ResourceDraftStore(),
      attempt = store.prepareCreation("p1", "sources", payload());
    store.failCreation("p1", "sources", attempt.key, {
      data: { code: "INTERNAL_SERVER_ERROR" },
    });
    store.failCreation("p1", "sources", attempt.key, {
      data: { code: "FORBIDDEN" },
    });
    expect(store.creation("p1", "sources")?.uncertain).toBe(true);
    expect(store.prepareCreation("p1", "sources", payload()).key).toBe(
      attempt.key
    );
    store.completeCreation("p1", "sources", attempt.key);
    expect(store.hasUncertainCreation()).toBe(false);
    expect(store.stats().count).toBe(0);
  });
  it("明确的首次参数或权限拒绝允许调整填写，调整后生成新标识", () => {
    const store = new ResourceDraftStore(),
      attempt = store.prepareCreation("p1", "tags", payload());
    store.failCreation("p1", "tags", attempt.key, {
      data: { code: "BAD_REQUEST" },
    });
    expect(store.creation("p1", "tags")?.uncertain).toBe(false);
    expect(
      store.prepareCreation("p1", "tags", { ...payload(), name: "修正" }).key
    ).not.toBe(attempt.key);
  });
  it("确认成功后才结束原请求，同一内容的新建操作使用新标识", () => {
    const store = new ResourceDraftStore(),
      first = store.prepareCreation("p1", "plugins", payload());
    store.completeCreation("p1", "plugins", first.key);
    const next = store.prepareCreation("p1", "plugins", payload());
    expect(next.key).not.toBe(first.key);
    store.completeCreation("p1", "plugins", first.key);
    store.failCreation("p1", "plugins", first.key, new Error("late"));
    expect(store.creation("p1", "plugins")?.key).toBe(next.key);
    expect(store.creation("p1", "plugins")?.uncertain).toBe(false);
  });
  it("业务、资源类别、账号实例各自隔离请求，放弃清空当前会话", () => {
    const first = new ResourceDraftStore(),
      otherAccount = new ResourceDraftStore();
    const a = first.prepareCreation("p1", "tags", payload());
    expect(first.prepareCreation("p2", "tags", payload()).key).not.toBe(a.key);
    expect(first.prepareCreation("p1", "assets", payload()).key).not.toBe(
      a.key
    );
    expect(otherAccount.creation("p1", "tags")).toBeUndefined();
    first.failCreation("p1", "tags", a.key, {});
    first.clear();
    expect(first.creation("p1", "tags")).toBeUndefined();
    expect(first.stats().count).toBe(0);
  });
  it("非法快照不建立待确认请求", () => {
    const store = new ResourceDraftStore();
    for (const value of [null, [], "text", new Date()])
      expect(() => store.prepareCreation("p1", "tags", value)).toThrow();
    expect(store.creation("p1", "tags")).toBeUndefined();
  });
});

it("流程与业务授权草稿均使用授权退出提示，流程之间保留且互不覆盖", () => {
  const store = new ResourceDraftStore();
  store.set("p", "workflow-authorization", "flow-a:builtin", "", "3");
  store.set("p", "workflow-authorization", "flow-a:custom", "", "7");
  expect(store.hasAuthorizationDraft("p")).toBe(true);
  expect(store.hasAuthorizationDraft("other")).toBe(false);
  store.set("p", "workflow-authorization", "flow-a:builtin", "", "");
  expect(store.read("p", "workflow-authorization", "flow-a:custom", "")).toBe(
    "7"
  );
  expect(store.read("p", "workflow-authorization", "flow-b:custom", "")).toBe(
    ""
  );
  expect(store.stats("p").count).toBe(1);
  store.clear();
  expect(store.hasAuthorizationDraft()).toBe(false);
  store.set("p", "project-authorization", "member", "", "draft");
  expect(store.hasAuthorizationDraft()).toBe(true);
});

it("系统角色授权草稿可跨管理页面卸载保留，同账号恢复后再提交", () => {
  const store = new ResourceDraftStore();
  store.set(
    "iam",
    "system-authorization",
    "user:7",
    { hours: "" },
    { hours: "7" }
  );
  expect(store.hasAuthorizationDraft("iam")).toBe(true);
  expect(store.exportDrafts()[0].field).toBe("user:7");
  expect(new ResourceDraftStore().hasAuthorizationDraft()).toBe(false);
});

it("organization drafts are recoverable authorization input and exports omit the initial password", () => {
  const store = new ResourceDraftStore();
  store.set(
    "organization",
    "organization-configuration",
    "new-user",
    { fields: { username: "", password: "" } },
    { fields: { username: "draft-user", password: "not-for-export" } }
  );
  expect(store.hasAuthorizationDraft()).toBe(true);
  expect(store.hasDraftCategory("organization-configuration")).toBe(true);
  expect(JSON.stringify(store.exportDrafts())).not.toContain("not-for-export");
  expect(
    store.read("organization", "organization-configuration", "new-user", null)
  ).toMatchObject({ fields: { password: "not-for-export" } });
});
it("流程基本信息草稿按业务和流程隔离，单独清理不会影响其他流程填写", () => {
  const store = new ResourceDraftStore();
  store.set(
    "p",
    "workflow-info:a",
    "fields",
    { name: "原名" },
    { name: "待保存" }
  );
  store.set(
    "p",
    "workflow-info:b",
    "fields",
    { name: "另一流程" },
    { name: "另一修改" }
  );
  expect(store.hasWorkflowDraft("p")).toBe(true);
  expect(store.hasWorkflowDraft("other")).toBe(false);
  store.clearCategory("p", "workflow-info:a");
  expect(store.read("p", "workflow-info:b", "fields", null)).toEqual({
    name: "另一修改",
  });
  expect(store.hasWorkflowDraft("p")).toBe(true);
  expect(new ResourceDraftStore().hasWorkflowDraft("p")).toBe(false);
});
