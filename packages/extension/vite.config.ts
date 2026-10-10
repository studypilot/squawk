import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
import { renderIconPng } from "./scripts/icon"

/*
 * Two builds into `dist/`:
 * - default mode: popup and background service worker (ES modules), plus manifest and icons;
 * - `--mode content`: the content script as one self-contained IIFE, because Chrome cannot load
 *   content scripts as modules.
 */

const packageDirectory = fileURLToPath(new URL(".", import.meta.url))
const outputDirectory = fileURLToPath(new URL("./dist", import.meta.url))
const { version } = JSON.parse(
   readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as {
   version: string
}
const iconSizes = [16, 48, 128] as const

function manifestPlugin(): Plugin {
   const icons = Object.fromEntries(iconSizes.map(size => [size, `icons/icon-${size}.png`]))
   const manifest = {
      manifest_version: 3,
      name: "Squawk Screenshots",
      description: "Exact screenshots for Squawk preview comments.",
      version,
      permissions: ["activeTab", "tabs"],
      host_permissions: ["<all_urls>"],
      background: { service_worker: "background.js", type: "module" },
      content_scripts: [
         { matches: ["<all_urls>"], js: ["content.js"], run_at: "document_idle", all_frames: false }
      ],
      action: { default_popup: "popup/index.html", default_icon: icons },
      icons
   }
   return {
      name: "squawk-extension-manifest",
      generateBundle() {
         this.emitFile({
            type: "asset",
            fileName: "manifest.json",
            source: `${JSON.stringify(manifest, null, 3)}\n`
         })
         for (const size of iconSizes) {
            this.emitFile({ type: "asset", fileName: icons[size], source: renderIconPng(size) })
         }
      }
   }
}

export default defineConfig(({ mode }) => {
   if (mode === "content") {
      return {
         root: packageDirectory,
         build: {
            outDir: outputDirectory,
            emptyOutDir: false,
            minify: false,
            lib: {
               entry: fileURLToPath(new URL("./src/content.ts", import.meta.url)),
               formats: ["iife"],
               name: "squawkContent",
               fileName: () => "content.js"
            },
            // `@squawk/shared` re-exports zod schemas; only the protocol helpers belong in here.
            rollupOptions: { treeshake: { moduleSideEffects: false } }
         }
      }
   }
   return {
      root: fileURLToPath(new URL("./src", import.meta.url)),
      base: "./",
      plugins: [manifestPlugin()],
      build: {
         outDir: outputDirectory,
         emptyOutDir: true,
         minify: false,
         modulePreload: false,
         rollupOptions: {
            input: {
               popup: fileURLToPath(new URL("./src/popup/index.html", import.meta.url)),
               background: fileURLToPath(new URL("./src/background.ts", import.meta.url))
            },
            output: {
               entryFileNames: "[name].js",
               chunkFileNames: "chunks/[name].js",
               assetFileNames: "assets/[name][extname]"
            }
         }
      }
   }
})
