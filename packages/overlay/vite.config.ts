import { resolve } from "node:path"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

const packageDirectory = import.meta.dirname

/** Sends `/` to the demo page so `pnpm dev` opens something useful. */
function redirectRootToDemo(): Plugin {
   return {
      name: "squawk-dev-root-redirect",
      configureServer(server) {
         server.middlewares.use((request, response, next) => {
            if (request.url !== "/") return next()
            response.writeHead(302, { Location: "/dev/index.html" })
            response.end()
         })
      }
   }
}

export default defineConfig({
   root: packageDirectory,
   publicDir: false,
   plugins: [redirectRootToDemo()],
   server: { port: 5174, strictPort: true },
   build: {
      outDir: resolve(packageDirectory, "../server/public"),
      emptyOutDir: false,
      target: ["es2022", "safari16", "chrome110", "firefox110"],
      lib: {
         entry: resolve(packageDirectory, "src/main.ts"),
         name: "Squawk",
         formats: ["iife"],
         fileName: () => "squawk.js"
      },
      rollupOptions: {
         // The shared package re-exports zod schemas next to plain constants. The overlay only
         // validates in dev builds, so production builds must be able to drop unused schema modules.
         treeshake: { moduleSideEffects: id => !id.includes("/packages/shared/") }
      }
   },
   test: {
      environment: "jsdom",
      include: ["src/**/*.spec.ts"]
   }
})
