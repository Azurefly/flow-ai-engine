import type { KeyboardEvent } from "react";

/** Arrow keys move focus within a tablist. Enter and Space activate the focused tab. */
export function moveTabFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
  const current = tabs.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const last = tabs.length - 1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? last :
    (current + (event.key === "ArrowRight" ? 1 : last)) % tabs.length;
  tabs[next].focus();
}
