import { useEffect, useState } from "react";
import {
  hasClientVersionChanged,
  isProductionClientEntry,
  readClientEntry,
} from "@shared/client-version";

export function useClientVersionUpdate(enabled: boolean) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const current =
      document
        .querySelector('script[type="module"][src]')
        ?.getAttribute("src") ?? null;
    if (!isProductionClientEntry(current)) return;
    let disposed = false;
    let changed = false;
    let lastCheck = 0;
    let controller: AbortController | null = null;
    const check = async () => {
      if (
        disposed ||
        changed ||
        controller ||
        document.visibilityState !== "visible" ||
        Date.now() - lastCheck < 60_000
      )
        return;
      lastCheck = Date.now();
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 8_000);
      try {
        const response = await fetch("/", {
          cache: "no-store",
          headers: { accept: "text/html" },
          signal: request.signal,
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("text/html")
        )
          return;
        changed = hasClientVersionChanged(
          current,
          readClientEntry(await response.text())
        );
        if (changed && !disposed) setAvailable(true);
      } catch {
        // A failed check must not interrupt the user's current work.
      } finally {
        window.clearTimeout(timeout);
        if (controller === request) controller = null;
      }
    };
    const onResume = () => {
      void check();
    };
    void check();
    const interval = window.setInterval(onResume, 300_000);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [enabled]);
  return available;
}
