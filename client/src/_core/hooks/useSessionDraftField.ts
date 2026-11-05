import { useCallback, useState, type SetStateAction } from "react";
import type { AccountDraftLease, WorkflowDraftMemory } from "@shared/account-draft-session";

/** Record edits synchronously before React can unmount an expired session. */
export function useSessionDraftField<T>(lease: AccountDraftLease, memory: WorkflowDraftMemory, field: keyof WorkflowDraftMemory["values"]): [T, (action: SetStateAction<T>) => void] {
  const [value, setValue] = useState<T>(() => memory.values[field] as T);
  const set = useCallback((action: SetStateAction<T>) => {
    if (lease.edit(memory, field, action)) setValue(memory.values[field] as T);
  }, [lease, memory, field]);
  return [value, set];
}
