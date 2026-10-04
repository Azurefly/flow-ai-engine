import express, { type Express } from "express";
import path from "node:path";

/** Current assets win; retained hashed assets let open clients finish their work. */
export function mountProductionAssets(
  app: Express,
  publicPath: string,
  retainedPath?: string
) {
  const options = { immutable: true, maxAge: "30d", index: false } as const;
  app.use("/assets", express.static(path.join(publicPath, "assets"), options));
  if (retainedPath) app.use("/assets", express.static(retainedPath, options));
  app.use("/assets", (_req, res) =>
    res.status(404).type("text/plain").send("Asset not found")
  );
  app.use(
    express.static(publicPath, {
      index: false,
      setHeaders(res, file) {
        if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
      },
    })
  );
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(publicPath, "index.html"));
  });
}
