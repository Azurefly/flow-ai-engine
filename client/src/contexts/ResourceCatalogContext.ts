import { createContext } from "react";

// A failed list refresh must stop writes without destroying locally entered forms.
export const ResourceCatalogContext = createContext({
  ready: false,
  refreshing: false,
  refresh: () => {},
});
