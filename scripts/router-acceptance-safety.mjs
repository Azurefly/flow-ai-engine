// No I/O on import: validate the destination and write consent before login.
import acceptance from "./acceptance-target.cjs";
export const routerAcceptanceConfig = acceptance.acceptanceLogin;

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
