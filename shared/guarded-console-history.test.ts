import { expect, it } from "vitest";
import {
  createGuardedConsoleHistory,
  type ConsoleHistoryEntry,
} from "./guarded-console-history";
function setup() {
  const entries: ConsoleHistoryEntry[] = [
    {
      url: "#/flows",
      state: { aiflowEditorReturn: "warehouse", extra: "keep" },
    },
  ];
  let index = 0,
    block = false,
    proceed: (() => void) | undefined,
    scopes = 0;
  const moves: number[] = [],
    accepted: string[] = [],
    reasons: string[] = [];
  const history = createGuardedConsoleHistory(
    {
      read: () => entries[index],
      push: entry => {
        entries.splice(index + 1);
        entries.push(entry);
        index++;
      },
      replace: entry => {
        entries[index] = entry;
      },
      go: delta => {
        moves.push(delta);
      },
    },
    (_entry, resume) => {
      proceed = resume;
      return !block;
    },
    (entry, reason) => {
      accepted.push(entry.url);
      reasons.push(reason);
    },
    () => `scope${++scopes}`
  );
  return {
    history,
    entries,
    moves,
    accepted,
    reasons,
    block: () => {
      block = true;
    },
    confirm: () => proceed?.(),
    external: (entry: ConsoleHistoryEntry) => {
      entries.splice(index + 1);
      entries.push(entry);
      index++;
      history.reconcile();
    },
    traverse: (delta: number) => {
      index += delta;
      history.reconcile();
    },
    settle: () => {
      index += moves.shift()!;
      history.reconcile();
    },
    index: () => index,
  };
}
it("后退取消保留原条目，确认后执行原后退，前进仍可返回", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.block();
  s.traverse(-1);
  expect(s.moves).toEqual([1]);
  s.settle();
  expect(s.index()).toBe(1);
  expect(s.accepted).toEqual(["#/runs"]);
  s.traverse(-1);
  s.settle();
  s.confirm();
  expect(s.moves).toEqual([-1]);
  s.settle();
  expect(s.index()).toBe(0);
  expect(s.entries).toHaveLength(2);
  expect(s.accepted.at(-1)).toBe("#/flows");
  s.traverse(1);
  s.settle();
  s.confirm();
  s.settle();
  expect(s.index()).toBe(1);
  expect(s.entries).toHaveLength(2);
});
it("确认先于恢复事件时等待恢复，再执行原目标", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.block();
  s.traverse(-1);
  s.confirm();
  expect(s.moves).toEqual([1]);
  s.settle();
  expect(s.moves).toEqual([-1]);
  s.settle();
  expect(s.accepted.at(-1)).toBe("#/flows");
});
it("页面内跳转确认前不写历史，替换和规范化保留位置元数据", () => {
  const s = setup();
  s.block();
  expect(s.history.navigate("#/runs", {})).toBe(false);
  expect(s.entries).toHaveLength(1);
  s.confirm();
  expect(s.entries).toHaveLength(2);
  s.history.replaceSilently("#/runs/workbench", { aiflowEditorReturn: null });
  expect(s.entries[1].state.aiflowNavigationPosition).toEqual({
    scope: "scope1",
    index: 1,
  });
  s.history.navigate("#/safe", {}, true);
  expect(s.entries).toHaveLength(2);
});
it("重复 hashchange 不重复确认或重复写入", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.block();
  s.traverse(-1);
  s.history.reconcile();
  expect(s.moves).toEqual([1]);
  s.settle();
  s.history.reconcile();
  expect(s.moves).toEqual([]);
  expect(s.entries).toHaveLength(2);
  s.confirm();
  s.settle();
  s.history.reconcile();
  expect(s.accepted).toEqual(["#/runs", "#/flows"]);
});
it("跨多条历史回退后恢复准确位置，不追加历史记录", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.history.navigate("#/warehouse", {});
  s.block();
  s.traverse(-2);
  expect(s.moves).toEqual([2]);
  s.settle();
  s.confirm();
  s.settle();
  expect(s.index()).toBe(0);
  expect(s.entries).toHaveLength(3);
  expect(s.reasons).toEqual(["push", "push", "traverse"]);
});
it("缺少位置的外部哈希保留当前草稿，确认后建立新历史范围", () => {
  const s = setup();
  s.block();
  s.external({ url: "#/system", state: {} });
  expect(s.entries[s.index()].url).toBe("#/flows");
  expect(s.accepted).toEqual([]);
  expect(s.moves).toEqual([]);
  s.confirm();
  expect(s.accepted).toEqual(["#/system"]);
  expect(s.entries[s.index()].state.aiflowNavigationPosition).toEqual({
    scope: "scope2",
    index: 0,
  });
});
it("外部条目复用同一位置时不会 go(0) 刷新或卸载任务", () => {
  const s = setup();
  s.block();
  s.external({ url: "#/system", state: { ...s.entries[0].state } });
  expect(s.moves).toEqual([]);
  expect(s.entries[s.index()].url).toBe("#/flows");
  s.confirm();
  expect(s.accepted).toEqual(["#/system"]);
});
it("更晚的安全替换会使旧确认失效，同时保留无关历史状态", () => {
  const s = setup();
  s.block();
  s.history.navigate("#/runs", {});
  s.history.replaceSilently("#/safe", { aiflowEditorReturn: "center" });
  s.confirm();
  expect(s.entries).toHaveLength(1);
  expect(s.entries[0].url).toBe("#/safe");
  expect(s.entries[0].state.extra).toBe("keep");
  expect(s.accepted).toEqual([]);
});
it.each([
  null,
  { scope: "scope1", index: -1 },
  { scope: "scope1", index: 0.5 },
  { scope: 1, index: 1 },
])("旧或损坏的位置元数据不能刷新页面：%j", value => {
  const s = setup();
  s.block();
  s.external({ url: "#/system", state: { aiflowNavigationPosition: value } });
  expect(s.moves).toEqual([]);
  expect(s.accepted).toEqual([]);
  expect(s.entries[s.index()].url).toBe("#/flows");
  s.confirm();
  expect(s.accepted).toEqual(["#/system"]);
});
it("恢复历史期间不写入页面跳转，重复确认只执行一次后退", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.block();
  s.traverse(-1);
  expect(s.history.navigate("#/system", {})).toBe(false);
  expect(s.entries).toHaveLength(2);
  s.settle();
  s.confirm();
  s.confirm();
  expect(s.moves).toEqual([-1]);
  s.settle();
  expect(s.index()).toBe(0);
});
it("无草稿时浏览器后退直接接收，历史重复事件不重复接收", () => {
  const s = setup();
  s.history.navigate("#/runs", {});
  s.traverse(-1);
  s.history.reconcile();
  expect(s.entries).toHaveLength(2);
  expect(s.moves).toEqual([]);
  expect(s.accepted).toEqual(["#/runs", "#/flows"]);
});
