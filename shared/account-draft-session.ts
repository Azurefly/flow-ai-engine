import { ResourceDraftStore } from "./resource-draft-session";
import { isWorkflowDraftDirty } from "./workflow-publish";

export type WorkflowDraftMemory = {
  epoch: number;
  values: Record<"name" | "definition" | "runInput" | "conflict", unknown>;
  base: { current: { workflowId: string; name: string; definitionJson: string; definitionVersion: number } | null };
};

export class AccountDraftLease {
  readonly resources = new ResourceDraftStore();
  workflow: WorkflowDraftMemory | null = null;
  active = true;
  constructor(readonly userId: number, readonly generation: number) {}
  isCurrent(epoch: number) { return this.active && this.resources.isCurrentView(epoch); }
  edit<T>(memory: WorkflowDraftMemory, field: keyof WorkflowDraftMemory["values"], action: T | ((value: T) => T)) {
    if (!this.isCurrent(memory.epoch)) return false;
    memory.values[field] = typeof action === "function" ? (action as (value: T) => T)(memory.values[field] as T) : action;
    this.workflow = memory;
    return true;
  }
}

function workflowChanged(memory: WorkflowDraftMemory | null) {
  return Boolean(memory && (isWorkflowDraftDirty(memory.base.current?.workflowId ?? null, memory.base.current,
    String(memory.values.name), memory.values.definition) || Object.keys(memory.values.runInput as object).length));
}

/** One owner, page memory only. A locked session cannot retrieve retained content. */
export class AccountDraftSession {
  private current: AccountDraftLease | null = null;
  private generation = 0;
  activate(userId: number | null) {
    if (userId === null) {
      if (this.current?.active) {
        this.current.active = false;
        this.current.resources.invalidateViews();
      }
      return null;
    }
    if (this.current?.userId !== userId) {
      this.clear();
      this.current = new AccountDraftLease(userId, ++this.generation);
    }
    this.current.active = true;
    return this.current;
  }
  forUser(userId: number | null) {
    return this.current?.active && this.current.userId === userId ? this.current : null;
  }
  hasRecovery() { return Boolean(this.current && (workflowChanged(this.current.workflow) || this.current.resources.hasRecoverableEntries())); }
  clear() {
    if (this.current) {
      this.current.active = false;
      this.current.resources.invalidateViews();
      this.current.resources.clear();
      this.current.workflow = null;
    }
    this.current = null;
  }
  reset(userId: number | null) { this.clear(); return this.activate(userId); }
}

export function openWorkflowDraft(lease: AccountDraftLease, workflowId: string | null): WorkflowDraftMemory {
  const previous = lease.workflow;
  if (previous?.base.current?.workflowId === workflowId && workflowChanged(previous))
    return { ...structuredClone(previous), epoch: lease.resources.generation };
  return { epoch: lease.resources.generation, values: { name: "", definition: null, runInput: {}, conflict: null }, base: { current: null } };
}
