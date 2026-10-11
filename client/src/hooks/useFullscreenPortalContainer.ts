import { useEffect, useState } from "react";

// Native fullscreen only paints descendants of the fullscreen element.
// Keep overlays inside it, including after Escape exits fullscreen.
export function useFullscreenPortalContainer() {
  const [container, setContainer] = useState<HTMLElement | undefined>(() =>
    typeof document === "undefined" ? undefined : (document.fullscreenElement as HTMLElement | null) ?? undefined
  );
  useEffect(() => {
    const sync = () => setContainer((document.fullscreenElement as HTMLElement | null) ?? undefined);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  return container;
}
