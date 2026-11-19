import { Buffer } from "node:buffer";
import { projectDebugPayload } from "./debug-log-metadata.mjs";

const bodyLimit = 2 * 1024 * 1024;

export function createDebugLogReceiver(writeEntries) {
  return (req, res, next) => {
    if (req.method !== "POST") return next();
    function reply(status, error) {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(error ? { success: false, error } : { success: true }));
    }
    function persist(input) {
      let batch;
      try {
        batch = projectDebugPayload(input);
      } catch {
        reply(400, "调试事件格式无效。");
        return;
      }
      try {
        if (batch.consoleLogs.length) writeEntries("browserConsole", batch.consoleLogs);
        if (batch.networkRequests.length) writeEntries("networkRequests", batch.networkRequests);
        if (batch.sessionEvents.length) writeEntries("sessionReplay", batch.sessionEvents);
      } catch {
        reply(500, "调试事件写入失败。");
        return;
      }
      reply(200);
    }
    // Express sets an empty body even when skipping a text/plain unload beacon.
    // Handle it as a stream unless a preceding parser consumed it.
    if (req.body !== undefined && (req._body || req.readableEnded)) {
      persist(req.body);
      return;
    }
    let size = 0;
    const parts = [];
    req.on("data", chunk => {
      if (size > bodyLimit) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > bodyLimit) {
        parts.length = 0;
        reply(413, "调试事件超过大小限制。");
      } else {
        parts.push(bytes);
      }
    });
    req.on("end", () => {
      if (size > bodyLimit) return;
      let input;
      try {
        input = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        reply(400, "调试事件格式无效。");
        return;
      }
      persist(input);
    });
    req.on("error", () => reply(400, "调试事件未完整接收。"));
  };
}
