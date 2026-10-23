import {
  canonicalResourcePayload,
  newResourceRequestKey,
} from "./resource-creation";

type CreationAttempt = {
  projectId: string;
  category: string;
  key: string;
  canonical: string;
  payload: Record<string, unknown>;
  uncertain: boolean;
};

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
  private creations = new Map<string, CreationAttempt>();
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
    for (const attempt of Array.from(this.creations.values())) {
      if ((!projectId || attempt.projectId === projectId) && attempt.uncertain)
        categories.add(JSON.stringify([attempt.projectId, attempt.category]));
    }
    const pending = Array.from(this.pending.values()).reduce(
      (total, item) =>
        total + (!projectId || item.projectId === projectId ? item.count : 0),
      0
    );
    return { count: categories.size, pending };
  }
  hasDraftCategory(category: string, projectId?: string) {
    return Array.from(this.entries.values()).some(
      entry =>
        entry.category === category &&
        (!projectId || entry.projectId === projectId) &&
        this.dirty(entry)
    );
  }
  hasAuthorizationDraft(projectId?: string) {
    return (
      this.hasDraftCategory("project-authorization", projectId) ||
      this.hasDraftCategory("workflow-authorization", projectId) ||
      this.hasDraftCategory("system-authorization", projectId) ||
      this.hasDraftCategory("organization-configuration", projectId)
    );
  }
  hasWorkflowDraft(projectId?: string) {
    const matches = (scope: string, category: string) =>
      (!projectId || scope === projectId) &&
      (category === "workflow-create" || category.startsWith("workflow-copy:"));
    return (
      Array.from(this.entries.values()).some(
        entry => matches(entry.projectId, entry.category) && this.dirty(entry)
      ) ||
      Array.from(this.creations.values()).some(
        attempt =>
          matches(attempt.projectId, attempt.category) && attempt.uncertain
      )
    );
  }
  clearCategory(projectId: string, category: string) {
    for (const [slot, entry] of Array.from(this.entries.entries()))
      if (entry.projectId === projectId && entry.category === category)
        this.entries.delete(slot);
    this.creations.delete(this.slot(projectId, category, "creation"));
    this.emit();
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
    this.creations.clear();
    this.emit();
  }
  creation(projectId: string, category: string) {
    return this.creations.get(this.slot(projectId, category, "creation"));
  }
  hasUncertainCreation(projectId?: string) {
    return Array.from(this.creations.values()).some(
      attempt =>
        attempt.uncertain && (!projectId || attempt.projectId === projectId)
    );
  }
  prepareCreation(projectId: string, category: string, payload: unknown) {
    const canonical = canonicalResourcePayload(payload);
    const snapshot = JSON.parse(canonical);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      throw new Error("保存内容格式无效，请检查填写。");
    const current = this.creation(projectId, category);
    if (current?.canonical === canonical) return current;
    if (current?.uncertain)
      throw new Error("请先核对上次保存结果，再修改填写。");
    const attempt: CreationAttempt = {
      projectId,
      category,
      key: newResourceRequestKey(),
      canonical,
      payload: snapshot,
      uncertain: false,
    };
    this.creations.set(this.slot(projectId, category, "creation"), attempt);
    this.emit();
    return attempt;
  }
  completeCreation(projectId: string, category: string, key: string) {
    if (this.creation(projectId, category)?.key !== key) return;
    this.creations.delete(this.slot(projectId, category, "creation"));
    this.emit();
  }
  failCreation(
    projectId: string,
    category: string,
    key: string,
    error: unknown
  ) {
    const current = this.creation(projectId, category);
    if (!current || current.key !== key) return;
    const code = (error as { data?: { code?: string } } | null)?.data?.code;
    const knownRejection = Boolean(
      code &&
        [
          "BAD_REQUEST",
          "UNAUTHORIZED",
          "FORBIDDEN",
          "NOT_FOUND",
          "CONFLICT",
          "PRECONDITION_FAILED",
          "UNPROCESSABLE_CONTENT",
          "PAYLOAD_TOO_LARGE",
          "TOO_MANY_REQUESTS",
        ].includes(code)
    );
    if (!current.uncertain && !knownRejection) {
      this.creations.set(this.slot(projectId, category, "creation"), {
        ...current,
        uncertain: true,
      });
      this.emit();
    }
  }
  exportDrafts() {
    const drafts: Array<{
      projectId: string;
      category: string;
      field: string;
      value: unknown;
    }> = Array.from(this.entries.values())
      .filter(entry => this.dirty(entry))
      .map(entry => ({
        projectId: entry.projectId,
        category: entry.category,
        field: entry.key,
        value:
          entry.category === "organization-configuration" &&
          entry.value &&
          typeof entry.value === "object"
            ? {
                ...entry.value,
                fields: Object.fromEntries(
                  Object.entries(
                    (entry.value as { fields?: Record<string, unknown> })
                      .fields ?? {}
                  ).filter(([key]) => key !== "password")
                ),
              }
            : entry.value,
      }));
    for (const attempt of Array.from(this.creations.values())) {
      if (
        !attempt.uncertain ||
        !(
          attempt.category === "workflow-create" ||
          attempt.category.startsWith("workflow-copy:")
        )
      )
        continue;
      drafts.push({
        projectId: attempt.projectId,
        category: attempt.category,
        field: "unconfirmed-creation",
        value: {
          requestKey: attempt.key,
          uncertain: true,
          payload: Object.fromEntries(
            Object.entries(attempt.payload).filter(([key]) =>
              [
                "projectId",
                "name",
                "id",
                "processCode",
                "description",
                "flowType",
                "dataSourceId",
                "expectedDefinitionVersion",
                "expectedConfigurationToken",
              ].includes(key)
            )
          ),
        },
      });
    }
    return drafts;
  }
}
