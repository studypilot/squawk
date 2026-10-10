import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { configPath, normalizeServer, readConfig, resolveConnection, writeConfig } from "./config"

describe("config", () => {
   let directory: string

   beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "squawk-config-"))
   })

   afterEach(async () => {
      await rm(directory, { recursive: true, force: true })
   })

   const storeConfig = async (config: object): Promise<void> => {
      await mkdir(join(directory, "squawk"), { recursive: true })
      await writeFile(join(directory, "squawk", "config.json"), JSON.stringify(config))
   }

   it("lives under XDG_CONFIG_HOME", () => {
      expect(configPath({ XDG_CONFIG_HOME: directory })).toBe(
         join(directory, "squawk", "config.json")
      )
   })

   it("reads a missing file as empty", async () => {
      expect(await readConfig({ XDG_CONFIG_HOME: directory })).toEqual({})
   })

   it("rejects a broken file", async () => {
      await storeConfig({ server: 42 })
      await expect(readConfig({ XDG_CONFIG_HOME: directory })).rejects.toThrow(/not a valid/)
   })

   it("writes the file with mode 0600", async () => {
      const environment = { XDG_CONFIG_HOME: directory }
      await writeConfig(environment, { server: "https://a.test", token: "sqk_x" })
      const path = configPath(environment)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
         server: "https://a.test",
         token: "sqk_x"
      })
   })

   it("uses the stored server and token", async () => {
      await storeConfig({ server: "https://a.test/", token: "sqk_file" })
      expect(await resolveConnection({ XDG_CONFIG_HOME: directory }, undefined)).toEqual({
         server: "https://a.test",
         token: "sqk_file"
      })
   })

   it("lets the environment win over the file", async () => {
      await storeConfig({ server: "https://a.test", token: "sqk_file" })
      const environment = {
         XDG_CONFIG_HOME: directory,
         SQUAWK_SERVER: "https://b.test",
         SQUAWK_TOKEN: "sqk_env"
      }
      expect(await resolveConnection(environment, undefined)).toEqual({
         server: "https://b.test",
         token: "sqk_env"
      })
   })

   it("lets --server win over the environment", async () => {
      const environment = { XDG_CONFIG_HOME: directory, SQUAWK_SERVER: "https://b.test" }
      expect((await resolveConnection(environment, "c.test")).server).toBe("https://c.test")
   })

   it("never sends the stored token to another server", async () => {
      await storeConfig({ server: "https://a.test", token: "sqk_file" })
      expect(await resolveConnection({ XDG_CONFIG_HOME: directory }, "https://evil.test")).toEqual({
         server: "https://evil.test",
         token: null
      })
   })

   it("ignores empty environment variables", async () => {
      await storeConfig({ server: "https://a.test", token: "sqk_file" })
      const environment = { XDG_CONFIG_HOME: directory, SQUAWK_SERVER: "", SQUAWK_TOKEN: " " }
      expect(await resolveConnection(environment, undefined)).toEqual({
         server: "https://a.test",
         token: "sqk_file"
      })
   })

   it("normalizes server URLs", () => {
      expect(normalizeServer("squawk.test")).toBe("https://squawk.test")
      expect(normalizeServer("http://localhost:3000/")).toBe("http://localhost:3000")
      expect(normalizeServer("https://host.test/prefix/")).toBe("https://host.test/prefix")
      expect(() => normalizeServer("ftp://host.test")).toThrow(/http or https/)
   })
})
