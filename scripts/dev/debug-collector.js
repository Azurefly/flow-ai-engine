import {
  consoleMetadata,
  networkMetadata,
  projectDebugPayload,
  requestPath,
  sessionMetadata,
} from "./debug-log-metadata.mjs";

// Development-only instrumentation. The browser console still receives the
// application's original arguments. Only projected metadata enters our store.
if (!window.__MANUS_DEBUG_COLLECTOR__) installCollector();

function installCollector() {
  const reportEndpoint = "/__manus__/logs";
  const limits = { consoleLogs: 500, networkRequests: 200, uiEvents: 500 };
  const store = { consoleLogs: [], networkRequests: [], uiEvents: [] };
  const originalFetch = window.fetch.bind(window);

  function record(source, entry) {
    if (!entry) return;
    const entries = store[source];
    entries.push(entry);
    if (entries.length > limits[source]) entries.splice(0, entries.length - limits[source]);
  }

  function uiEvent(kind, payload) {
    record("uiEvents", sessionMetadata({
      timestamp: Date.now(), kind, url: location.href, payload,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
  }

  for (const kind of ["click", "change", "focusin", "focusout", "keydown", "submit"]) {
    document.addEventListener(kind, event => {
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest(".manus-no-record")) return;
      if (kind === "keydown" && event.key !== "Enter" && event.key !== "Escape") return;
      uiEvent(kind, {
        target: { tag: element?.tagName.toLowerCase(), type: element?.getAttribute("type") },
        key: event.key, x: event.clientX, y: event.clientY,
      });
    }, true);
  }
  let lastScroll = 0;
  window.addEventListener("scroll", () => {
    if (Date.now() - lastScroll < 500) return;
    lastScroll = Date.now();
    uiEvent("scroll", {
      scrollX: window.scrollX, scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
    });
  }, { passive: true });
  for (const reason of ["pushState", "replaceState"]) {
    const original = history[reason];
    history[reason] = function (...args) {
      const result = original.apply(this, args);
      uiEvent("navigate", { reason });
      return result;
    };
  }
  for (const reason of ["popstate", "hashchange"]) {
    window.addEventListener(reason, () => uiEvent("navigate", { reason }));
  }

  for (const level of ["log", "debug", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = function (...args) {
      record("consoleLogs", consoleMetadata({
        timestamp: Date.now(), level: level.toUpperCase(), kind: "console", argumentCount: args.length,
      }));
      return original(...args);
    };
  }
  window.addEventListener("error", event => {
    record("consoleLogs", consoleMetadata({
      timestamp: Date.now(), level: "ERROR", kind: "UncaughtError",
      source: event.filename, line: event.lineno, column: event.colno,
    }));
    uiEvent("error", { filename: event.filename, lineno: event.lineno, colno: event.colno });
  });
  window.addEventListener("unhandledrejection", () => {
    record("consoleLogs", consoleMetadata({
      timestamp: Date.now(), level: "ERROR", kind: "UnhandledRejection",
    }));
    uiEvent("unhandledrejection", {});
  });

  function completed(start, type, method, url, status) {
    const entry = networkMetadata({
      timestamp: start, type, method, url, status, duration: Date.now() - start,
    });
    record("networkRequests", entry);
    if (entry && (!entry.status || entry.status >= 400)) {
      uiEvent("network_error", {
        kind: type, method: entry.method, url: entry.url, status: entry.status,
      });
    }
  }
  function trackedPath(input) {
    const raw = typeof input === "string" ? input : input?.url ?? input?.href;
    const url = requestPath(raw, location.href);
    return url?.startsWith("/__manus__/") ? undefined : url;
  }
  window.fetch = function (input, init) {
    const url = trackedPath(input);
    if (!url) return originalFetch(input, init);
    const method = init?.method ?? input?.method ?? "GET";
    const start = Date.now();
    return originalFetch(input, init).then(
      response => {
        completed(start, "fetch", method, url, response.status);
        return response;
      },
      error => {
        completed(start, "fetch", method, url, 0);
        throw error;
      }
    );
  };

  const xhrRequests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...options) {
    const result = originalOpen.call(this, method, url, ...options);
    xhrRequests.set(this, { method, url: trackedPath(url) });
    return result;
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const request = xhrRequests.get(this);
    if (request?.url) {
      const start = Date.now();
      this.addEventListener("loadend", () => {
        completed(start, "xhr", request.method, request.url, this.status);
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  function payload(snapshot) {
    const report = projectDebugPayload(snapshot);
    return { ...report, uiEvents: report.sessionEvents, timestamp: Date.now() };
  }
  function hasEntries(snapshot) {
    return Object.keys(limits).some(key => snapshot[key].length > 0);
  }
  function reportLogs() {
    if (!hasEntries(store)) return Promise.resolve();
    const pending = {};
    for (const key of Object.keys(limits)) pending[key] = store[key].splice(0);
    return originalFetch(reportEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(pending)),
    }).then(response => {
      if (response.status >= 500) throw new Error("调试事件暂未写入。");
    }).catch(() => {
      for (const key of Object.keys(limits)) {
        store[key] = pending[key].concat(store[key]).slice(-limits[key]);
      }
    });
  }
  setInterval(reportLogs, 2000);
  window.addEventListener("beforeunload", () => {
    if (!navigator.sendBeacon || !hasEntries(store)) return;
    let snapshot = { ...store };
    let body = JSON.stringify(payload(snapshot));
    while (new Blob([body]).size > 60000) {
      for (const key of Object.keys(limits)) {
        snapshot[key] = snapshot[key].slice(Math.ceil(snapshot[key].length / 2));
      }
      body = JSON.stringify(payload(snapshot));
    }
    navigator.sendBeacon(reportEndpoint, body);
  });
  window.__MANUS_DEBUG_COLLECTOR__ = { version: "2.1-metadata", store, forceReport: reportLogs };
}
