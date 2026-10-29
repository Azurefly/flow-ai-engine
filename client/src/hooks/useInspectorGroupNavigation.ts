import { useEffect, useRef } from "react";

export function inspectorGroupScrollTarget(input: {
  scrollTop: number;
  containerTop: number;
  panelTop: number;
  tabsHeight: number;
}) {
  return Math.max(0, input.scrollTop + input.panelTop - input.containerTop - input.tabsHeight - 8);
}

// UX 优化：只调整配置区滚动；保留原分类按钮的焦点和键盘行为。
export function useInspectorGroupNavigation(scope: string | null) {
  const contentRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  }, [scope]);
  const reveal = () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const content = contentRef.current, tabs = tabsRef.current, panel = panelRef.current;
      if (liveScope.current !== scope || !content?.isConnected || !tabs || !panel) return;
      content.scrollTo({
        top: inspectorGroupScrollTarget({
          scrollTop: content.scrollTop,
          containerTop: content.getBoundingClientRect().top,
          panelTop: panel.getBoundingClientRect().top,
          tabsHeight: tabs.getBoundingClientRect().height,
        }),
        behavior: "auto",
      });
    });
  };
  return { contentRef, tabsRef, panelRef, reveal };
}
