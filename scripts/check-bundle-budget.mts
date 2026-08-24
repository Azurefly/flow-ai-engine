import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDirectory = join(process.cwd(), "dist", "public", "assets");
const maxChunkBytes = 450 * 1024;
const maxTotalBytes = 1_300 * 1024;

let assets: string[];
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

const sizes = assets
  .map(file => ({ file, bytes: statSync(join(assetsDirectory, file)).size }))
  .sort((left, right) => right.bytes - left.bytes);
const totalBytes = sizes.reduce((sum, asset) => sum + asset.bytes, 0);
const oversized = sizes.filter(asset => asset.bytes > maxChunkBytes);

for (const asset of sizes) {
  console.log(`bundle ${asset.file}: ${(asset.bytes / 1024).toFixed(2)} KiB`);
}
console.log(`bundle total: ${(totalBytes / 1024).toFixed(2)} KiB`);
console.log(
  `bundle budget: ${maxChunkBytes / 1024} KiB/chunk, ${maxTotalBytes / 1024} KiB total`
);

if (oversized.length > 0 || totalBytes > maxTotalBytes) {
  const details = oversized.map(
    asset => `${asset.file}=${(asset.bytes / 1024).toFixed(2)} KiB`
  );
  if (totalBytes > maxTotalBytes)
    details.push(`total=${(totalBytes / 1024).toFixed(2)} KiB`);
  throw new Error(`Bundle budget exceeded: ${details.join(", ")}`);
}
