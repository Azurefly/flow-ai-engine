// Run with node --import tsx scripts/index-project-api.mjs [--check] from the repository.
import { readFile, writeFile } from "node:fs/promises";
import { appRouter } from "../server/routers.ts";

const destination = new URL("../docs/development/optimization/api-current.json", import.meta.url);
const procedures = Object.entries(appRouter._def.procedures)
  .sort(([left], [right]) => left < right ? -1 : left === right ? 0 : 1)
  .map(([name, p]) => ({ name, method: p._def.type }));
const entrypoints = {
  assistant: "server/assistant-router.ts",
  connector: "server/data-connector-router.ts",
  directoryImport: "server/directory-import-router.ts",
};
const namespaces = {};
for (const p of procedures) {
  const key = p.name.split(".")[0];
  namespaces[key] ??= { source: entrypoints[key] ?? "server/routers.ts", procedures: [] };
  namespaces[key].procedures.push({ name: p.name, method: p.method });
}
const data = JSON.stringify({ schemaVersion: 1, count: procedures.length, namespaces }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const actual = (await readFile(destination, "utf8")).replaceAll("\r\n", "\n");
  if (actual !== data) throw new Error("当前 tRPC 注册清单与源码不同，请重新运行索引生成。");
} else {
  await writeFile(destination, data, "utf8");
}
console.log("已核对实际注册的 tRPC 过程 " + procedures.length + " 个。");
