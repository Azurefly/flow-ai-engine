/** Public APIs such as GitHub reject requests that do not identify the client. */
export function withHttpClientIdentity(headers: Record<string, string>) {
  const custom = Object.keys(headers).find(
    key => key.toLowerCase() === "user-agent"
  );
  return custom
    ? { ...headers }
    : { ...headers, "User-Agent": "FlowAIEngine/1.0" };
}
