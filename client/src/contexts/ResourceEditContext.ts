import { createContext } from "react";

// Also applies to dialogs rendered through a portal; permission changes preserve drafts.
export const ResourceEditContext = createContext({
  canEdit: false,
  canRun: false,
  ready: false,
  refreshing: false,
  refresh: () => {},
});
