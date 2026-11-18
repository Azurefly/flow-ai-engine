import { useLayoutEffect, useRef } from "react";

export function useRuleNavigationFocus() {
  const pending = useRef<string | number | null>(null);
  useLayoutEffect(() => {
    pending.current = null;
  });

  function buttonRef(target: string | number) {
    return (button: HTMLButtonElement | null) => {
      if (button && pending.current === target) button.focus();
    };
  }

  return { pending, buttonRef };
}
