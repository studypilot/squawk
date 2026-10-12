import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/* Verifies that `dist/` is a loadable extension: valid manifest, every referenced file present. */

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..")
const distDirectory = join(packageDirectory, "dist")
const problems: string[] = []

function expect(condition: boolean, problem: string): void {
   if (!condition) problems.push(problem)
}

function expectFile(relativePath: unknown, label: string): void {
   if (typeof relativePath !== "string") {
      problems.push(`${label} is not a path`)
      return
   }
   expect(existsSync(join(distDirectory, relativePath)), `${label} missing: dist/${relativePath}`)
}

interface Manifest {
   manifest_version?: unknown
   name?: unknown
   description?: unknown
   version?: unknown
   permissions?: unknown
   host_permissions?: unknown
   background?: { service_worker?: unknown; type?: unknown }
   content_scripts?: { matches?: unknown; js?: unknown; run_at?: unknown; all_frames?: unknown }[]
   action?: { default_popup?: unknown; default_icon?: Record<string, unknown> }
   icons?: Record<string, unknown>
}

const manifestPath = join(distDirectory, "manifest.json")
if (!existsSync(manifestPath)) {
   console.error("dist/manifest.json missing. Run `pnpm build` first.")
   process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest
const { version } = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as {
   version: string
}

expect(manifest.manifest_version === 3, "manifest_version is not 3")
expect(manifest.name === "Squawk Screenshots", "unexpected name")
expect(typeof manifest.description === "string", "description missing")
expect(manifest.version === version, `version is not ${version}`)
expect(
   JSON.stringify(manifest.permissions) === JSON.stringify(["activeTab", "tabs"]),
   "permissions are not [activeTab, tabs]"
)
expect(
   JSON.stringify(manifest.host_permissions) === JSON.stringify(["<all_urls>"]),
   "host_permissions are not [<all_urls>]"
)
expect(manifest.background?.type === "module", "background is not a module service worker")
expectFile(manifest.background?.service_worker, "background.service_worker")

const contentScript = manifest.content_scripts?.[0]
expect(manifest.content_scripts?.length === 1, "expected exactly one content script entry")
expect(JSON.stringify(contentScript?.matches) === '["<all_urls>"]', "content script matches")
expect(contentScript?.run_at === "document_idle", "content script run_at")
expect(contentScript?.all_frames === false, "content script all_frames")
const contentFiles = Array.isArray(contentScript?.js) ? (contentScript.js as unknown[]) : []
expect(contentFiles.length > 0, "content script has no js")
for (const file of contentFiles) {
   expectFile(file, "content script")
   if (typeof file !== "string" || !existsSync(join(distDirectory, file))) continue
   const source = readFileSync(join(distDirectory, file), "utf8")
   expect(!/^\s*(import|export)\b/m.test(source), `${file} contains module syntax`)
}

const popup = manifest.action?.default_popup
expectFile(popup, "action.default_popup")
if (typeof popup === "string" && existsSync(join(distDirectory, popup))) {
   const html = readFileSync(join(distDirectory, popup), "utf8")
   for (const match of html.matchAll(/(?:src|href)="(?!https?:)([^"]+)"/g)) {
      const reference = match[1]
      if (reference) expectFile(join(dirname(popup), reference), `popup reference ${reference}`)
   }
}

for (const size of ["16", "32", "48", "128"]) {
   expectFile(manifest.icons?.[size], `icons.${size}`)
   expectFile(manifest.action?.default_icon?.[size], `action.default_icon.${size}`)
}

if (problems.length > 0) {
   console.error(`dist/ is not a valid extension:\n- ${problems.join("\n- ")}`)
   process.exit(1)
}
console.log(`dist/ OK: manifest v${version}, all referenced files present.`)
