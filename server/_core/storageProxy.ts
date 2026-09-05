import type { Express, Request } from "express";
import { parse } from "cookie";
import { ENV } from "./env";
import { authenticateToken, FLOW_SESSION_COOKIE } from "../internal-auth";
import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./sdk";

async function isAuthorizedStorageRequest(req: Request): Promise<boolean> {
  const cookies = parse(req.headers.cookie ?? "");
  const flowToken = cookies[FLOW_SESSION_COOKIE];
  if (flowToken) {
    const user = await authenticateToken(flowToken).catch(() => null);
    if (user) return true;
  }
  const oauthToken = cookies[COOKIE_NAME];
  if (oauthToken) {
    const session = await sdk.verifySession(oauthToken).catch(() => null);
    if (session) return true;
  }
  return false;
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const authorized = await isAuthorizedStorageRequest(req);
    if (!authorized) {
      res.status(401).send("Unauthorized");
      return;
    }

    const key = (req.params as Record<string, string>)[0];
    if (!key || key.includes("..") || key.includes("\\") || /[\x00-\x1f\x7f]/.test(key)) {
      res.status(400).send("Invalid or missing storage key");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        res.status(502).send("Invalid signed URL from backend");
        return;
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        res.status(502).send("Invalid signed URL protocol");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, parsedUrl.toString());
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
