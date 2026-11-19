import express from "express";
import { appendFile, mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDebugLogReceiver } from "../scripts/dev/debug-log-receiver.mjs";

const marker = "QA_PRIVATE_EXAMPLE";
afterEach(() => vi.unstubAllGlobals());

it("fetch、XHR 和页面事件只上报元数据，应用仍可读取正常响应", async () => {
  const reports: unknown[] = [];
  const native = vi.fn(async (url, init) => {
    if (url === "/__manus__/logs") reports.push(JSON.parse(init.body));
    return new Response(marker, { status: 200 });
  });
  const browser = Object.assign(new EventTarget(), {
    fetch: native, innerWidth: 800, innerHeight: 600,
  });
  const onDocument = new Map();
  const originalLog = vi.fn();
  class Input {
    tagName = "INPUT";
    value = marker;
    getAttribute() { return "password"; }
    closest() { return null; }
  }
  class XHR extends EventTarget {
    status = 201;
    open(_method: string, _url: string) { /* test transport */ }
    send(_body: string) { this.dispatchEvent(new Event("loadend")); }
  }
  vi.stubGlobal("window", browser);
  vi.stubGlobal("location", new URL("https://flow.example/work?test=" + marker + "#/system/agents?test=" + marker));
  vi.stubGlobal("document", { addEventListener: (name, listener) => onDocument.set(name, listener) });
  vi.stubGlobal("history", { pushState: vi.fn(), replaceState: vi.fn() });
  vi.stubGlobal("XMLHttpRequest", XHR);
  vi.stubGlobal("Element", Input);
  vi.stubGlobal("setInterval", vi.fn());
  vi.stubGlobal("console", { log: originalLog, debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  await import("../scripts/dev/debug-collector.js");

  const response = await browser.fetch(new URL("https://flow.example/api/people?tenant=" + marker), {
    method: "POST", headers: { Authorization: marker }, body: marker,
  });
  expect(await response.text()).toBe(marker);
  const xhr = new XHR();
  xhr.open("PATCH", "/api/departments?q=" + marker);
  xhr.send(marker);
  console.log(marker);
  expect(originalLog).toHaveBeenCalledWith(marker);
  onDocument.get("change")({ target: new Input() });
  browser.dispatchEvent(new Event("hashchange"));
  const collector = browser.__MANUS_DEBUG_COLLECTOR__;
  expect(JSON.stringify(collector.store)).not.toContain(marker);
  await collector.forceReport();
  expect(reports).toHaveLength(1);
  expect(JSON.stringify(reports)).not.toContain(marker);
  expect(reports[0].networkRequests).toEqual([
    { type: "fetch", method: "POST", url: "/api/people", status: 200, timestamp: expect.any(Number), duration: expect.any(Number) },
    { type: "xhr", method: "PATCH", url: "/api/departments", status: 201, timestamp: expect.any(Number), duration: expect.any(Number) },
  ]);
  expect(reports[0].sessionEvents[0]).toMatchObject({
    kind: "change", url: "/work", route: "/system/agents", payload: { target: { tag: "input", type: "password" } },
  });
  expect(reports[0].consoleLogs[0]).toMatchObject({ level: "LOG", argumentCount: 1 });
});

it("HTTP 入口在 JSON 与卸载信标两种上报路径中过滤旧客户端后再落盘", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "flow-debug-metadata-"));
  const file = path.join(folder, "events.jsonl");
  const writes: Promise<void>[] = [];
  const app = express();
  app.use(express.json());
  app.use("/__manus__/logs", createDebugLogReceiver((kind: string, rows: unknown[]) => {
    writes.push(appendFile(file, JSON.stringify({ kind, rows }) + "\n", "utf8"));
  }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as { port: number };
    const payload = {
      networkRequests: [{
        timestamp: 1, type: "fetch", method: "POST",
        url: "https://flow.example/api/people?field=" + marker + "#sample",
        request: { headers: { Authorization: marker, Cookie: marker }, body: marker },
        response: { status: 201, headers: { "Set-Cookie": marker }, body: marker },
        error: { message: marker, stack: marker }, duration: 12,
      }],
      consoleLogs: [{ timestamp: 1, level: "ERROR", args: [marker], stack: marker }],
      sessionEvents: [{
        timestamp: 1, kind: "network_error", url: "https://flow.example/?q=" + marker,
        payload: { url: "/api/people?q=" + marker, method: "POST", kind: "fetch", status: 400, message: marker },
      }],
    };
    for (const type of ["application/json", "text/plain;charset=UTF-8"]) {
      const result = await fetch(`http://127.0.0.1:${port}/__manus__/logs`, {
        method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(payload),
      });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ success: true });
    }
    await Promise.all(writes);
    const persisted = await readFile(file, "utf8");
    expect(persisted).not.toContain(marker);
    const receipts = persisted.trim().split("\n").map(line => JSON.parse(line));
    expect(receipts).toHaveLength(6);
    expect(receipts.filter(r => r.kind === "networkRequests")).toEqual(Array(2).fill({
      kind: "networkRequests", rows: [{ timestamp: 1, type: "fetch", method: "POST", url: "/api/people", status: 201, duration: 12 }],
    }));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(folder);
  }
});
