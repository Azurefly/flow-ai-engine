import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./client/demo/", import.meta.url)),
  base: "./",
  envDir: false,
  publicDir: false,
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL("./dist/demo/", import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    {
      name: "demo-license",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "LICENSE.txt",
          source: readFileSync(new URL("./LICENSE", import.meta.url), "utf8"),
        });
      },
    },
  ],
});
