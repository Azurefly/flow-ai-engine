const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"]);
const transports = new Set(["fetch", "xhr"]);
const levels = new Set(["LOG", "DEBUG", "INFO", "WARN", "ERROR"]);
const consoleKinds = new Set(["console", "UncaughtError", "UnhandledRejection"]);
const eventKinds = new Set(["click", "change", "focusin", "focusout", "keydown", "submit", "scroll", "navigate", "error", "unhandledrejection", "network_error"]);
const elementTags = new Set(["a", "article", "button", "canvas", "div", "fieldset", "form", "g", "img", "input", "label", "li", "main", "option", "p", "path", "section", "select", "span", "svg", "table", "td", "textarea", "th", "tr"]);
const inputTypes = new Set(["button", "checkbox", "date", "datetime-local", "email", "file", "hidden", "number", "password", "radio", "range", "reset", "search", "submit", "tel", "text", "time", "url"]);
const navReasons = new Set(["pushState", "replaceState", "popstate", "hashchange"]);

function integer(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
}

function httpUrl(value, base = "https://flow.invalid/") {
  if (typeof value !== "string" || !value) return;
  try {
    const url = new URL(value, base);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    // Non-HTTP identifiers have no usable request path.
  }
}

export function requestPath(value, base) {
  const path = httpUrl(value, base)?.pathname;
  // Preserve the leading slash and keep the stored path safe to normalize again.
  return path?.replace(/^\/{2,}/, "/").slice(0, 1024);
}

function method(value) {
  const name = typeof value === "string" ? value.toUpperCase() : "";
  return methods.has(name) ? name : "OTHER";
}

export function networkMetadata(entry) {
  const url = requestPath(entry?.url);
  if (!url || !transports.has(entry?.type)) return null;
  return {
    timestamp: integer(entry.timestamp),
    type: entry.type,
    method: method(entry.method),
    url,
    status: integer(entry.status ?? entry.response?.status, 599) ?? 0,
    duration: integer(entry.duration),
  };
}

export function consoleMetadata(entry) {
  if (!levels.has(entry?.level)) return null;
  const first = Array.isArray(entry.args) ? entry.args[0] : undefined;
  const kind = entry.kind ?? first?.type;
  return {
    timestamp: integer(entry.timestamp),
    level: entry.level,
    kind: consoleKinds.has(kind) ? kind : "console",
    argumentCount: integer(entry.argumentCount ?? entry.args?.length),
    source: requestPath(entry.source ?? first?.filename),
    line: integer(entry.line ?? first?.lineno),
    column: integer(entry.column ?? first?.colno),
  };
}

export function sessionMetadata(entry) {
  if (!eventKinds.has(entry?.kind)) return null;
  const data = entry.payload ?? {};
  const payload = {};
  if (elementTags.has(data.target?.tag)) {
    payload.target = { tag: data.target.tag };
    if (inputTypes.has(data.target.type)) payload.target.type = data.target.type;
  }
  switch (entry.kind) {
    case "click":
      payload.x = integer(data.x);
      payload.y = integer(data.y);
      break;
    case "scroll":
      for (const key of ["scrollX", "scrollY", "documentHeight", "viewportHeight"]) {
        payload[key] = integer(data[key]);
      }
      break;
    case "navigate":
      if (navReasons.has(data.reason)) payload.reason = data.reason;
      break;
    case "keydown":
      if (data.key === "Escape" || data.key === "Enter") payload.key = data.key;
      break;
    case "error":
      payload.filename = requestPath(data.filename);
      payload.lineno = integer(data.lineno);
      payload.colno = integer(data.colno);
      break;
    case "network_error":
      if (transports.has(data.kind)) payload.kind = data.kind;
      payload.method = method(data.method);
      payload.url = requestPath(data.url);
      payload.status = integer(data.status, 599) ?? 0;
      break;
  }
  const url = httpUrl(entry.url);
  const route = entry.route ?? (url?.hash.startsWith("#/") ? url.hash.slice(1) : undefined);
  return {
    timestamp: integer(entry.timestamp),
    kind: entry.kind,
    url: requestPath(entry.url),
    route: requestPath(route),
    viewport: { width: integer(entry.viewport?.width), height: integer(entry.viewport?.height) },
    payload,
  };
}

function latest(entries, limit, project) {
  return Array.isArray(entries) ? entries.slice(-limit).map(project).filter(Boolean) : [];
}

export function projectDebugPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("调试事件格式无效。");
  }
  return {
    consoleLogs: latest(payload.consoleLogs, 500, consoleMetadata),
    networkRequests: latest(payload.networkRequests, 200, networkMetadata),
    sessionEvents: latest(payload.sessionEvents ?? payload.uiEvents, 500, sessionMetadata),
  };
}
