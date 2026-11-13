// No I/O on import: validate the destination and write consent before login.
export function routerAcceptanceConfig(env) {
  if (!env.FLOW_ACCEPTANCE_BASE_URL) {
    throw new Error(
      "Set FLOW_ACCEPTANCE_BASE_URL to a dedicated acceptance environment; there is no default target"
    );
  }
  let url;
  try {
    url = new URL(env.FLOW_ACCEPTANCE_BASE_URL);
  } catch {
    throw new Error("FLOW_ACCEPTANCE_BASE_URL must be an HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "FLOW_ACCEPTANCE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment"
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    throw new Error(
      "Remote acceptance requires HTTPS; use loopback HTTP only for a local test environment or SSH tunnel"
    );
  }
  if (env.FLOW_ACCEPTANCE_CONFIRM_WRITES !== url.origin) {
    throw new Error(
      "This script creates projects, publishes workflows and starts real runs. Set FLOW_ACCEPTANCE_CONFIRM_WRITES to the exact target origin to confirm; fixtures are retained, not automatically deleted"
    );
  }
  if (
    !env.FLOW_BOOTSTRAP_ADMIN_USERNAME ||
    !env.FLOW_BOOTSTRAP_ADMIN_PASSWORD
  ) {
    throw new Error("Missing existing login configuration");
  }
  return {
    base: url.origin,
    username: env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  };
}

export class RouterAcceptanceSession {
  #base;
  #fetch;
  #cookie = "";

  constructor(base, fetchImpl = globalThis.fetch) {
    this.#base = base;
    this.#fetch = fetchImpl;
  }

  async request(path, input, mutation = false) {
    const json = JSON.stringify({ json: input ?? null });
    let response;
    let payload;
    try {
      response = await this.#fetch(
        `${this.#base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(json)}`}`,
        {
          method: mutation ? "POST" : "GET",
          headers: { "content-type": "application/json", cookie: this.#cookie },
          ...(mutation ? { body: json } : {}),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        }
      );
      payload = await response.json();
    } catch {
      // Do not echo request bodies, cookies or server error text containing secrets.
      // Writes are deliberately never retried after an uncertain response.
      throw new Error(
        `${path}: request failed or timed out; inspect recorded fixture IDs before retrying`
      );
    }
    if (!response.ok || payload?.error) {
      throw new Error(
        `${path}: request rejected (HTTP ${response.status}); inspect server logs privately`
      );
    }
    const cookie = response.headers.getSetCookie()[0];
    if (cookie) this.#cookie = cookie.split(";", 1)[0];
    return payload.result.data.json;
  }
}
