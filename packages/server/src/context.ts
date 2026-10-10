import type { Config } from "./config"
import type { Database } from "./db/index"
import type { Logger } from "./logger"
import type { Principal } from "./auth/principal"

export interface AppDependencies {
   config: Config
   database: Database
   logger: Logger
   /** Directory with the built inbox (`index.html`, `assets/`) and `squawk.js`. May be missing. */
   publicDir: string
}

export interface AppEnv {
   Variables: {
      dependencies: AppDependencies
      /** Cached by `getPrincipal` so a request resolves its credentials once. */
      principal: Principal | undefined
   }
}
