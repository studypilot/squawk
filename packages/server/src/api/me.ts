import type { MeResponse } from "@squawk/shared"
import { Hono } from "hono"
import { getPrincipal, type TokenWithSite } from "../auth/principal"
import type { AppEnv } from "../context"
import { toAgentAuthor, toUserAuthor } from "./views"

export const meRoutes = new Hono<AppEnv>()

meRoutes.get("/", async c => {
   const principal = await getPrincipal(c)
   const response: MeResponse =
      principal.kind === "agent"
         ? { principal: toAgentAuthor(principal.token), token: describeToken(principal.token) }
         : {
              principal: toUserAuthor(principal.user),
              token: principal.viaToken ? describeToken(principal.viaToken) : null
           }
   return c.json(response)
})

function describeToken(token: TokenWithSite): NonNullable<MeResponse["token"]> {
   return { id: token.id, name: token.name, kind: token.kind, siteKey: token.siteKey }
}
