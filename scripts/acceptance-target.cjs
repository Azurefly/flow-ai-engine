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

/** Bind the HTTP service to the MySQL endpoint selected for this test, including forwarded ports. */
function acceptanceDatabaseTarget(env) {
  const origin = acceptanceTarget(env);
  if (!env.FLOW_ACCEPTANCE_DATABASE_TARGET || !env.DATABASE_URL)
    throw new Error("Set FLOW_ACCEPTANCE_DATABASE_TARGET and DATABASE_URL for this HTTP and MySQL acceptance run");
  const invalid = "DATABASE_URL must match the confirmed HTTP origin, MySQL host, port and database in FLOW_ACCEPTANCE_DATABASE_TARGET";
  try {
    const expected = JSON.parse(env.FLOW_ACCEPTANCE_DATABASE_TARGET);
    const actual = new URL(env.DATABASE_URL);
    const hostname = value => value.toLowerCase().replace(/^\[([^\]]+)\]$/, "$1");
    const database = decodeURIComponent(actual.pathname.slice(1));
    if (!expected || Array.isArray(expected) ||
        Object.keys(expected).some(key => !["origin", "host", "port", "database"].includes(key)) ||
        expected.origin !== origin || typeof expected.host !== "string" || !expected.host ||
        !Number.isInteger(expected.port) || expected.port < 1 || expected.port > 65535 ||
        !database || /[\/\\\x00-\x1f]/.test(database) || expected.database !== database ||
        actual.protocol !== "mysql:" || !actual.hostname || actual.hash ||
        hostname(decodeURIComponent(actual.hostname)) !== hostname(expected.host) ||
        Number(actual.port || 3306) !== expected.port)
      throw new Error();
    // mysql2 merges query options after parsing the authority and database path.
    for (const key of actual.searchParams.keys())
      if (["host", "port", "database", "socketpath", "stream", "uri", "__proto__", "prototype", "constructor"].includes(key.toLowerCase()))
        throw new Error();
  } catch {
    // Parsing errors from URL/JSON can include the full input and its credentials.
    throw new Error(invalid);
  }
  return origin;
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

function loadRoleUsers(env, origin) {
  const filename = env.FLOW_ACCEPTANCE_ROLE_USERS_FILE;
  if (!filename)
    throw new Error("Set FLOW_ACCEPTANCE_ROLE_USERS_FILE to the private role fixture for this test origin");
  let fixture;
  try {
    fixture = JSON.parse(require("node:fs").readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Cannot read the private role fixture as UTF-8 JSON");
  }
  if (fixture?.origin !== origin)
    throw new Error("The private role fixture must match the confirmed acceptance origin");
  const ids = new Set();
  const names = new Set();
  const users = {};
  for (const role of ["alice", "bob", "fiona", "leo", "clark", "oscar"]) {
    const account = fixture.users?.[role];
    const id = String(account?.id ?? "");
    const username = typeof account?.username === "string" ? account.username.trim() : "";
    const password = account?.password;
    if (!/^[1-9]\d*$/.test(id) || !username || typeof password !== "string" || !password)
      throw new Error("Missing account ID, username or password for role " + role);
    if (ids.has(id) || names.has(username.toLowerCase()))
      throw new Error("Each test role must use a different account");
    ids.add(id);
    names.add(username.toLowerCase());
    users[role] = { id, username, password };
  }
  return users;
}

module.exports = { acceptanceTarget, acceptanceLogin, acceptanceDatabaseTarget, acceptanceSsh, loadRoleUsers };
