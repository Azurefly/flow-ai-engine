export function restoreTaskDrawerFocus(
  taskId: string,
  opener: HTMLElement | null,
  root: Document = document
) {
  const available = (element: HTMLElement | null): element is HTMLElement => Boolean(
    element?.isConnected && element !== root.body && element.getClientRects().length && !element.hasAttribute("disabled")
  );
  const target = available(opener) ? opener : Array.from(root.querySelectorAll<HTMLElement>("[data-task-open-id]")).find(element => element.dataset.taskOpenId === taskId && available(element));
  target?.focus({ preventScroll: true });
  return target ?? null;
}
