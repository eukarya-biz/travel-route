import { cpSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { defineConfig, type Plugin } from "vite";

/** Directory of the published `@navaramap/three` bundle inside node_modules. */
const navaraDist = path.dirname(
  createRequire(import.meta.url).resolve("@navaramap/three"),
);

/**
 * Precomputed data the engine fetches at runtime — atmosphere scattering LUTs,
 * cloud shapes, noise and water textures. The bundle addresses them as
 * `new URL("./assets/<name>", import.meta.url)`, relative to the chunk that
 * runs, so Vite cannot resolve (or hash) them at build time: they have to be
 * copied next to the emitted chunks verbatim.
 *
 * In dev this is unnecessary — the package is served from node_modules, where
 * those directories already sit beside the bundle.
 */
const RUNTIME_ASSET_DIRS = ["atmosphere", "cloud", "noise", "water"];

const copyNavaraRuntimeAssets = (): Plugin => ({
  name: "copy-navara-runtime-assets",
  apply: "build",
  closeBundle() {
    const out = path.resolve(__dirname, "dist");

    for (const dir of RUNTIME_ASSET_DIRS) {
      const from = path.join(navaraDist, "assets", dir);
      if (!existsSync(from)) continue;
      cpSync(from, path.join(out, "assets", dir), { recursive: true });
    }

    // The engine's worker chunks ship prebuilt, so Vite re-emits them as opaque
    // assets and never sees the .wasm they fetch relative to their own URL —
    // notably the font worker's. Copy those through verbatim, next to the
    // emitted chunks (`build.assetsDir: "."`, i.e. the root of `dist`).
    const assets = path.join(navaraDist, "assets");
    for (const file of readdirSync(assets)) {
      if (!file.endsWith(".wasm")) continue;
      cpSync(path.join(assets, file), path.join(out, file));
    }
  },
});

export default defineConfig({
  // A GitHub Pages project site is served from `/<repo>/`, not the domain root,
  // so the deploy workflow passes that prefix in. Local dev and any root-hosted
  // deployment keep the default.
  base: process.env.BASE_PATH ?? "/",
  plugins: [copyNavaraRuntimeAssets()],
  build: {
    // Emit chunks at the root of `dist` so the engine's runtime
    // `./assets/<name>` lookups land on the directories copied above.
    assetsDir: ".",
    // The engine ships WASM well past the default 500 kB warning threshold.
    chunkSizeWarningLimit: 8192,
  },
  optimizeDeps: {
    // The prebuilt bundle loads its workers, WASM and data directories through
    // `new URL(..., import.meta.url)`. Pre-bundling would rewrite those URLs
    // into the dep cache, where the sibling files do not exist, so serve the
    // package as published instead.
    exclude: [
      "@navaramap/three",
      "@navaramap/three-default-descs",
      "@navaramap/three-default-plugin",
    ],
  },
});
