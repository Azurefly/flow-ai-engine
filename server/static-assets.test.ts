import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { mountProductionAssets } from "./_core/static-assets";

let server: Server | undefined;
let root: string | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close(e => (e ? reject(e) : resolve()))
    );
  server = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});
describe("release asset continuity", () => {
  it("serves old chunks, prefers current files, never returns HTML for missing chunks, and disables shell caching", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "flow-static-"));
    const publicPath = path.join(root, "public");
    const retained = path.join(root, "retained");
    await fs.mkdir(path.join(publicPath, "assets"), { recursive: true });
    await fs.mkdir(retained);
    await fs.writeFile(
      path.join(publicPath, "index.html"),
      "<html>current</html>"
    );
    await fs.writeFile(
      path.join(publicPath, "assets", "same-12345678.js"),
      "current"
    );
    await fs.writeFile(path.join(retained, "same-12345678.js"), "old");
    await fs.writeFile(
      path.join(retained, "old-abcdefgh.js"),
      "export default 'old';"
    );
    const app = express();
    mountProductionAssets(app, publicPath, retained);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test address");
    const base = `http://127.0.0.1:${address.port}`;
    const old = await fetch(`${base}/assets/old-abcdefgh.js`);
    expect(old.status).toBe(200);
    expect(old.headers.get("content-type")).toContain("javascript");
    expect(old.headers.get("cache-control")).toContain("immutable");
    expect(await old.text()).toContain("export default");
    expect(await (await fetch(`${base}/assets/same-12345678.js`)).text()).toBe(
      "current"
    );
    const missing = await fetch(`${base}/assets/gone-12345678.js`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).not.toContain("html");
    for (const url of ["/", "/index.html", "/flows/workflow/test"]) {
      const response = await fetch(base + url);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("<html>current</html>");
    }
  });
});
