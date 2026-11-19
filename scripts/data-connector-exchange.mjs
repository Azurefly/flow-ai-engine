import { createServer } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  linkSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";

const {
  FLOW_EXCHANGE_TENANT: tenant,
  FLOW_EXCHANGE_STATE_DIR: store,
  FLOW_EXCHANGE_TOKEN_FILE: tokenFile,
} = process.env;
const port = Number(process.env.FLOW_EXCHANGE_PORT ?? 18481);
if (
  !tenant ||
  !/^[A-Za-z0-9_-]{12,64}$/.test(tenant) ||
  !store ||
  !isAbsolute(store) ||
  !tokenFile ||
  !isAbsolute(tokenFile) ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535
)
  throw new Error("需要有效的租户、端口以及绝对状态和令牌文件路径。");
const token = readFileSync(tokenFile, "utf8").trim();
if (token.length < 24) throw new Error("测试令牌长度不足。");
mkdirSync(store, { recursive: true, mode: 0o700 });
if (!statSync(store).isDirectory()) throw new Error("状态目录不可用。");
const root = join(store, tenant);
mkdirSync(root, { recursive: true, mode: 0o700 });
const base = "/g01/" + tenant + "/";
const rows = [
  { id: "1", name: "北区" },
  { id: "2", name: "东区" },
  { id: "3", name: "南区" },
];
const canonical = v =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, canonical(v[k])])
        )
      : v;
const digest = v => createHash("sha256").update(v).digest("hex");
const send = (res, code, value) => {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
function increment(name) {
  const file = join(root, name + ".count");
  const next = existsSync(file) ? Number(readFileSync(file, "utf8")) + 1 : 1;
  writeFileSync(file, String(next), { mode: 0o600 });
  return next;
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (
      !url.pathname.startsWith(base) ||
      !equal(String(req.headers.authorization ?? ""), "Bearer " + token)
    )
      return send(res, 404, {});
    const resource = url.pathname.slice(base.length);
    if (req.method === "GET" && resource === "sample.csv") {
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      return res.end(
        '\ufeffid,name\r\n1,"中文,\r\n第二行"\r\n2,"他说""好"""\r\n'
      );
    }
    if (req.method === "GET" && resource === "rows") {
      const version = url.searchParams.get("version");
      if (version !== "revision-v1")
        return send(res, 409, { error: "unknown version" });
      const cursor = url.searchParams.get("cursor") ?? "0";
      if (!["0", "1", "2"].includes(cursor)) return send(res, 400, {});
      const n = Number(cursor);
      const count = increment("read-" + n);
      if (n === 1 && count === 1 && process.env.FLOW_EXCHANGE_FAULTS === "1")
        return send(res, 503, { error: "single transient failure" });
      return send(res, 200, {
        version,
        rows: [rows[n]],
        nextCursor: n < rows.length - 1 ? String(n + 1) : null,
      });
    }
    if (req.method === "GET" && resource === "counters") {
      const read = n => {
        const p = join(root, n + ".count");
        return existsSync(p) ? Number(readFileSync(p, "utf8")) : 0;
      };
      return send(res, 200, {
        pages: [0, 1, 2].map(n => read("read-" + n)),
        commits: readdirSync(root).filter(name =>
          /^[a-f0-9]{64}\.json$/.test(name)
        ).length,
      });
    }
    const match = /^(receipts|objects)\/([a-f0-9]{64})$/.exec(resource);
    if (!match) return send(res, 404, {});
    const key = match[2],
      file = join(root, key + ".json");
    if (req.method === "GET") {
      if (!existsSync(file)) return send(res, 404, {});
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (match[1] === "objects")
        return Array.isArray(saved.rows)
          ? send(res, 200, { operationKey: key, rows: saved.rows })
          : send(res, 404, {});
      return send(res, 200, saved.proof ?? saved);
    }
    if (
      match[1] !== "receipts" ||
      req.method !== "POST" ||
      req.headers["idempotency-key"] !== key
    )
      return send(res, 400, {});
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 600_000) return send(res, 413, {});
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      payload.operationKey !== key ||
      !Array.isArray(payload.rows) ||
      payload.payloadHash !== digest(JSON.stringify(canonical(payload.rows)))
    )
      return send(res, 422, {});
    const receipt = {
      operationKey: key,
      payloadHash: payload.payloadHash,
      rowCount: payload.rows.length,
      receipt: "g01-" + key.slice(0, 24),
    };
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      const old = saved.proof ?? saved;
      return send(
        res,
        old.payloadHash === payload.payloadHash ? 200 : 409,
        old
      );
    }
    const tmp = join(root, randomUUID() + ".tmp");
    writeFileSync(tmp, JSON.stringify({ proof: receipt, rows: payload.rows }), {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    try {
      linkSync(tmp, file);
    } finally {
      unlinkSync(tmp);
    }
    // The receipt and business rows become visible in the same atomic file operation.
    if (process.env.FLOW_EXCHANGE_FAULTS === "1") {
      res.destroy();
      return;
    }
    send(res, 201, receipt);
  } catch {
    if (!res.headersSent && !res.destroyed)
      send(res, 400, { error: "invalid exchange request" });
  }
}).listen(port, "127.0.0.1", () =>
  console.log("独立数据交换测试服务已在回环端口 " + port + " 启动。")
);
