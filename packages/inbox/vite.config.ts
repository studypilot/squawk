import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const serverTarget = "http://localhost:3000"

export default defineConfig({
   base: "/",
   plugins: [react()],
   build: {
      outDir: "../server/public",
      emptyOutDir: false
   },
   server: {
      port: 5173,
      strictPort: true,
      proxy: {
         "/api": serverTarget,
         "/auth": serverTarget,
         "/healthz": serverTarget
      }
   },
   test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"]
   }
})
