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
// Final dataflow result tables measured: 1376.97 KiB raw / 406.22 KiB gzip before terminal labels.
const maxTotalBytes = 1_411 * 1024;
const maxTotalGzipBytes = 419 * 1024;
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
