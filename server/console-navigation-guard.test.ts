import { afterEach, expect, it, vi } from "vitest";
import {
  consoleNavigationEvent,
  requestConsoleNavigation,
  type ConsoleNavigationEvent,
} from "../client/src/lib/console-navigation-guard";

afterEach(() => vi.unstubAllGlobals());

it("没有未提交表单时允许主路由导航", () => {
  vi.stubGlobal("window", new EventTarget());
  expect(requestConsoleNavigation(vi.fn())).toBe(true);
});

it("任务表单可延后导航，解除监听后不再阻塞后续页面", () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const proceed = vi.fn();
  let held: (() => void) | undefined;
  const listener = (event: Event) => {
    event.preventDefault();
    held = (event as ConsoleNavigationEvent).detail.proceed;
  };
  target.addEventListener(consoleNavigationEvent, listener);
  expect(requestConsoleNavigation(proceed)).toBe(false);
  expect(proceed).not.toHaveBeenCalled();
  held?.();
  expect(proceed).toHaveBeenCalledOnce();
  target.removeEventListener(consoleNavigationEvent, listener);
  expect(requestConsoleNavigation(proceed)).toBe(true);
});
