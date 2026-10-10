import { chmod } from "node:fs/promises"
import { build } from "esbuild"

const outfile = "dist/main.js"

await build({
   entryPoints: ["src/main.ts"],
   bundle: true,
   platform: "node",
   format: "esm",
   target: "node22",
   outfile,
   // commander is CommonJS and requires Node built-ins; ESM output needs a real `require` for that.
   banner: {
      js: [
         "#!/usr/bin/env node",
         'import { createRequire } from "node:module"',
         "const require = createRequire(import.meta.url)"
      ].join("\n")
   }
})
await chmod(outfile, 0o755)
