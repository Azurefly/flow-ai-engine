import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const assetsDirectory = join(process.cwd(), "dist", "public", "assets");
const indexHtmlPath = join(process.cwd(), "dist", "public", "index.html");
const debugCollectorArtifact = join(
  process.cwd(),
  "dist",
  "public",
  "__manus__",
  "debug-collector.js"
);
const maxChunkBytes = 450 * 1024;
// Account status confirmation/recovery: 1422.16 KiB raw / 422.10 KiB gzip.
// Keep one-KiB headroom for this measured increment; chunk/HTML limits stay fixed.
// Project archive/restore and its history dialog add about 2.5 KiB gzip.
// Draft revision conflicts, export/reload recovery, and cancel-publish reconfirm add about 0.76 KiB gzip.
// Inline loop draft validation adds about 1.07 KiB raw / 0.38 KiB gzip.
// Task form trial preview and the shared task display contract add 2.53 KiB raw.
// Task opener lookup after nested dialogs adds about 0.23 KiB raw.
// Native schedule revisions, recovery actions and preset selection add < 1 KiB gzip.
// The resource center stays lazy loaded; per-chunk and HTML limits remain unchanged.
// Resource permission boundaries, recoverable forms and lazy loading add about 1.5 KiB gzip.
// Business and workflow pages no longer preload the resource-center module.
// Numeric input and draft-save validation: measured total about 1450.6 KiB raw / 434 KiB gzip.
// Keep the per-chunk and HTML limits unchanged, with bounded total headroom.
// Shared workspace styling and login introduction: 1451.33 KiB raw / 433.81 KiB gzip.
// Role presets, conflict recovery and draft protection: 1457.82 KiB raw / 436.07 KiB gzip.
// Workspace navigation/search, authorization relationships and context motion: 1471.83 / 441.61 KiB.
const maxTotalBytes = 1_473 * 1024;
// Task drawer draft protection adds about 0.82 KiB gzip.
const maxTotalGzipBytes = 443 * 1024;
const maxHtmlBytes = 20 * 1024;

let assets;
try {
  assets = readdirSync(assetsDirectory).filter(file => file.endsWith(".js"));
} catch (error) {
  throw new Error(
    `Bundle budget cannot inspect ${assetsDirectory}: ${String(error)}`
  );
}

if (assets.length === 0) {
  throw new Error(
    `Bundle budget found no JavaScript assets in ${assetsDirectory}`
  );
}

let html;
try {
  html = readFileSync(indexHtmlPath, "utf8");
} catch (error) {
  throw new Error(
    `Bundle budget cannot inspect ${indexHtmlPath}: ${String(error)}`
  );
}

const htmlBytes = Buffer.byteLength(html, "utf8");
const sizes = assets
  .map(file => {
    const contents = readFileSync(join(assetsDirectory, file));
    return {
      file,
      bytes: statSync(join(assetsDirectory, file)).size,
      gzipBytes: gzipSync(contents).length,
    };
  })
  .sort((left, right) => right.bytes - left.bytes);
const totalBytes = sizes.reduce((sum, asset) => sum + asset.bytes, 0);
const totalGzipBytes = sizes.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const oversized = sizes.filter(asset => asset.bytes > maxChunkBytes);

for (const asset of sizes) {
  console.log(`bundle ${asset.file}: ${(asset.bytes / 1024).toFixed(2)} KiB`);
}
console.log(`bundle total: ${(totalBytes / 1024).toFixed(2)} KiB`);
console.log(`bundle gzip total: ${(totalGzipBytes / 1024).toFixed(2)} KiB`);
console.log(`HTML shell: ${(htmlBytes / 1024).toFixed(2)} KiB`);
console.log(
  `bundle budget: ${maxChunkBytes / 1024} KiB/chunk, ${maxTotalBytes / 1024} KiB raw total, ${maxTotalGzipBytes / 1024} KiB gzip total, ${maxHtmlBytes / 1024} KiB HTML`
);

const details = oversized.map(
  asset => `${asset.file}=${(asset.bytes / 1024).toFixed(2)} KiB`
);
if (totalBytes > maxTotalBytes)
  details.push(`total=${(totalBytes / 1024).toFixed(2)} KiB`);
if (totalGzipBytes > maxTotalGzipBytes)
  details.push(`gzip total=${(totalGzipBytes / 1024).toFixed(2)} KiB`);
if (htmlBytes > maxHtmlBytes)
  details.push(`index.html=${(htmlBytes / 1024).toFixed(2)} KiB`);
if (html.includes('id="manus-runtime"'))
  details.push("production HTML includes the Manus editor runtime");
if (existsSync(debugCollectorArtifact))
  details.push("production assets include the Manus debug collector");

if (details.length > 0) {
  throw new Error(`Bundle budget exceeded: ${details.join(", ")}`);
}
