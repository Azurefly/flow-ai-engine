type DraftEntry = {
  projectId: string;
  category: string;
  key: string;
  value: unknown;
  base: unknown;
  tracked: boolean;
};

/** One authenticated console owns this store; no browser storage or server data. */
export class ResourceDraftStore {
  private entries = new Map<string, DraftEntry>();
  private pending = new Map<string, { projectId: string; count: number }>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach(listener => listener());
  }
  private slot(projectId: string, category: string, key: string) {
    return JSON.stringify([projectId, category, key]);
  }
  read<T>(projectId: string, category: string, key: string, initial: T): T {
    const entry = this.entries.get(this.slot(projectId, category, key));
    return entry ? (entry.value as T) : initial;
  }
  set<T>(
    projectId: string,
    category: string,
    key: string,
    initial: T,
    action: T | ((value: T) => T),
    tracked = true
  ) {
    const slot = this.slot(projectId, category, key);
    const previous = this.entries.get(slot);
    const current = previous ? (previous.value as T) : initial;
    const value =
      typeof action === "function"
        ? (action as (value: T) => T)(current)
        : action;
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    this.entries.set(slot, {
      projectId,
      category,
      key,
      value,
      base: previous ? previous.base : initial,
      tracked,
    });
    this.emit();
  }
  private dirty(entry: DraftEntry) {
    return (
      entry.tracked &&
      JSON.stringify(entry.value) !== JSON.stringify(entry.base)
    );
  }
  stats(projectId?: string) {
    const categories = new Set<string>();
    for (const entry of Array.from(this.entries.values())) {
      if ((!projectId || entry.projectId === projectId) && this.dirty(entry))
        categories.add(JSON.stringify([entry.projectId, entry.category]));
    }
    const pending = Array.from(this.pending.values()).reduce(
      (total, item) =>
        total + (!projectId || item.projectId === projectId ? item.count : 0),
      0
    );
    return { count: categories.size, pending };
  }
  begin(projectId: string, category: string) {
    const slot = this.slot(projectId, category, "pending");
    this.pending.set(slot, {
      projectId,
      count: (this.pending.get(slot)?.count ?? 0) + 1,
    });
    this.emit();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      const count = (this.pending.get(slot)?.count ?? 1) - 1;
      if (count) this.pending.set(slot, { projectId, count });
      else this.pending.delete(slot);
      this.emit();
    };
  }
  clear() {
    this.entries.clear();
    this.emit();
  }
  exportDrafts() {
    return Array.from(this.entries.values())
      .filter(entry => this.dirty(entry))
      .map(entry => ({
        projectId: entry.projectId,
        category: entry.category,
        field: entry.key,
        value: entry.value,
      }));
  }
}
