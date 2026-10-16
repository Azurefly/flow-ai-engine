export const consoleNavigationEvent = "flow:before-console-navigation";
export type ConsoleNavigationEvent = CustomEvent<{ proceed: () => void }>;
export function requestConsoleNavigation(proceed: () => void): boolean {
  return window.dispatchEvent(
    new CustomEvent(consoleNavigationEvent, {
      cancelable: true,
      detail: { proceed },
    })
  );
}
