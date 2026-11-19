/** Shared by the CommonJS browser suites and the ESM HTTP suites. No I/O on import. */
function acceptanceTarget(env, configured = env.FLOW_ACCEPTANCE_BASE_URL) {
  if (!configured)
    throw new Error(
      "Set FLOW_ACCEPTANCE_BASE_URL to a dedicated acceptance environment; there is no default target"
    );
  let url;
  try {
    url = new URL(configured);
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
  )
    throw new Error(
      "FLOW_ACCEPTANCE_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment"
    );
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Remote acceptance requires HTTPS; use loopback HTTP only for a local test environment or SSH tunnel"
    );
  if (env.FLOW_ACCEPTANCE_CONFIRM_WRITES !== url.origin)
    throw new Error(
      "Set FLOW_ACCEPTANCE_CONFIRM_WRITES to the exact target origin before running a mutating acceptance suite"
    );
  return url.origin;
}

function acceptanceLogin(env, configured) {
  const base = acceptanceTarget(env, configured);
  const username = env.FLOW_BOOTSTRAP_ADMIN_USERNAME;
  const password = env.FLOW_BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password)
    throw new Error("Missing existing login configuration");
  return { base, username, password };
}

// Browser fixtures also operate inside Docker. Bind both sides to the host
// selected by the operator before any child process or fixture write starts.
function acceptanceSsh(env) {
  const origin = new URL(acceptanceTarget(env));
  const target = env.FLOW_ACCEPTANCE_SSH_TARGET || "";
  const match = /^([a-z_][a-z0-9_-]*)@([a-z0-9.:-]+)$/i.exec(target);
  if (!match || match[2].toLowerCase() !== origin.hostname.toLowerCase())
    throw new Error(
      "FLOW_ACCEPTANCE_SSH_TARGET must name the same host as the confirmed HTTP origin"
    );
  const key = env.FLOW_ACCEPTANCE_SSH_KEY;
  if (!key)
    throw new Error(
      "Set FLOW_ACCEPTANCE_SSH_KEY to the dedicated fixture identity file"
    );
  function container(name) {
    const value = env[name] || "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))
      throw new Error(
        "Set " + name + " to the dedicated fixture container name"
      );
    return value;
  }
  return {
    target,
    key,
    app: container("FLOW_ACCEPTANCE_APP_CONTAINER"),
    get mysql() {
      return container("FLOW_ACCEPTANCE_MYSQL_CONTAINER");
    },
  };
}

module.exports = { acceptanceTarget, acceptanceLogin, acceptanceSsh };
