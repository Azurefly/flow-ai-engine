export type ConsoleHistoryEntry = {
  url: string;
  state: Record<string, unknown>;
};
type Position = { scope: string; index: number };
type Entry = ConsoleHistoryEntry & { at: Position };
export interface ConsoleHistoryPort {
  read(): ConsoleHistoryEntry;
  push(entry: ConsoleHistoryEntry): void;
  replace(entry: ConsoleHistoryEntry): void;
  go(delta: number): void;
}
const key = "aiflowNavigationPosition";
function position(entry: ConsoleHistoryEntry): Position | null {
  const value = entry.state[key] as Position | undefined;
  return value &&
    typeof value.scope === "string" &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0
    ? value
    : null;
}
function located(entry: ConsoleHistoryEntry, value: Position): Entry {
  return { ...entry, state: { ...entry.state, [key]: value }, at: value };
}

/** Undo a blocked traversal first, then resume that same traversal on confirmation. */
export function createGuardedConsoleHistory(
  port: ConsoleHistoryPort,
  guard: (target: ConsoleHistoryEntry, proceed: () => void) => boolean,
  accept: (
    target: ConsoleHistoryEntry,
    reason: "push" | "replace" | "traverse"
  ) => void,
  scope = () => Math.random().toString(36)
) {
  let current: Entry;
  let pending:
    | { target: Entry; restoring: boolean; approved: boolean }
    | undefined;
  let revision = 0;
  const entry = port.read();
  current = located(entry, position(entry) ?? { scope: scope(), index: 0 });
  port.replace(current);
  function commit(
    target: Entry,
    reason: "push" | "replace" | "traverse" = "traverse"
  ) {
    pending = undefined;
    current = target;
    accept(target, reason);
  }
  function writing(
    target: Entry,
    method: "push" | "replace",
    reason: "push" | "replace" | "traverse"
  ) {
    const attemptRevision = ++revision;
    return () => {
      if (attemptRevision !== revision) return;
      revision++;
      port[method](target);
      commit(target, reason);
    };
  }
  function navigate(
    url: string,
    state: Record<string, unknown>,
    replace = false
  ): boolean {
    if (pending?.restoring) return false;
    const target = located(
      { url, state },
      {
        scope: current.at.scope,
        index: current.at.index + (replace ? 0 : 1),
      }
    );
    const method = replace ? "replace" : "push";
    const proceed = writing(target, method, method);
    if (!replace && !guard(target, proceed)) return false;
    proceed();
    return true;
  }
  function replaceSilently(url: string, state: Record<string, unknown>) {
    revision++;
    pending = undefined;
    current = located(
      { url, state: { ...current.state, ...state } },
      current.at
    );
    port.replace(current);
  }
  function reconcile() {
    const raw = port.read();
    const nextPosition = position(raw);
    const previousAttempt = pending;
    const arrived = (target: Entry) =>
      raw.url === target.url &&
      nextPosition?.scope === target.at.scope &&
      nextPosition.index === target.at.index;
    const isCurrent = arrived(current);
    if (previousAttempt?.restoring) {
      if (isCurrent) {
        previousAttempt.restoring = false;
        if (previousAttempt.approved)
          port.go(previousAttempt.target.at.index - current.at.index);
      }
      return;
    }
    if (isCurrent) return;
    if (previousAttempt?.approved && arrived(previousAttempt.target)) {
      commit(previousAttempt.target);
      return;
    }
    if (
      !nextPosition ||
      nextPosition.scope !== current.at.scope ||
      nextPosition.index === current.at.index
    ) {
      // Older or externally-created entries have no reliable traversal offset.
      pending = undefined;
      const target = located(raw, { scope: scope(), index: 0 });
      const proceed = writing(target, "replace", "traverse");
      if (guard(target, proceed)) proceed();
      else port.push(current);
      return;
    }
    const target = located(raw, nextPosition);
    revision++;
    const attempt = { target, restoring: true, approved: false };
    pending = attempt;
    const proceed = () => {
      if (pending !== attempt || attempt.approved) return;
      attempt.approved = true;
      if (!attempt.restoring)
        port.go(target.at.index - current.at.index);
    };
    if (guard(target, proceed)) {
      commit(target);
    } else port.go(current.at.index - target.at.index);
  }
  return { navigate, replaceSilently, reconcile };
}

export type GuardedConsoleHistory = ReturnType<
  typeof createGuardedConsoleHistory
>;
