import { z } from "zod"
import { parseOriginPattern } from "./auth/connect"

const logLevelSchema = z.enum(["debug", "info", "warn", "error", "silent"])
export type LogLevel = z.infer<typeof logLevelSchema>

export interface OidcConfig {
   issuer: string
   clientId: string
   clientSecret: string
   allowedEmailDomains: string[]
   hostedDomain: string | null
}

export interface Config {
   databaseUrl: string
   /** Origin the server is reached at, without a trailing slash, e.g. `https://squawk.example.com`. */
   publicUrl: string
   sessionSecret: string
   /** Null when OIDC is not configured; `/auth/login` then answers 503. */
   oidc: OidcConfig | null
   dataDir: string
   port: number
   logLevel: LogLevel
   /** Development bypass: requests without credentials act as this user. Never in production. */
   devUserEmail: string | null
   /** Page origins whose popup login skips the consent card, e.g. `https://*.example.com`. */
   trustedOriginPatterns: string[]
}

/** Treats empty strings like unset variables, which is what `.env` files usually mean. */
const optionalString = z.preprocess(
   value => (value === "" ? undefined : value),
   z.string().trim().min(1).optional()
)

const environmentSchema = z.object({
   NODE_ENV: optionalString,
   DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
   PUBLIC_URL: z.url("PUBLIC_URL must be an absolute URL"),
   SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
   OIDC_ISSUER: optionalString.default("https://accounts.google.com"),
   OIDC_CLIENT_ID: optionalString,
   OIDC_CLIENT_SECRET: optionalString,
   OIDC_ALLOWED_EMAIL_DOMAINS: optionalString,
   OIDC_HOSTED_DOMAIN: optionalString,
   DATA_DIR: optionalString.default("/data"),
   PORT: z.preprocess(
      value => (value === "" ? undefined : value),
      z.coerce.number().int().min(1).max(65535).default(3000)
   ),
   LOG_LEVEL: z.preprocess(
      value => (value === "" ? undefined : value),
      logLevelSchema.default("info")
   ),
   SQUAWK_DEV_USER: z.preprocess(
      value => (value === "" ? undefined : value),
      z.email("SQUAWK_DEV_USER must be an email address").optional()
   ),
   SQUAWK_TRUSTED_ORIGINS: optionalString
})

/** Reads and validates the configuration. Throws with a readable message on invalid input. */
export function loadConfig(environment: NodeJS.ProcessEnv): Config {
   const parsed = environmentSchema.safeParse(environment)
   if (!parsed.success) {
      throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`)
   }
   const values = parsed.data

   if (values.SQUAWK_DEV_USER && values.NODE_ENV === "production") {
      throw new Error("SQUAWK_DEV_USER must not be set when NODE_ENV=production")
   }

   return {
      databaseUrl: values.DATABASE_URL,
      publicUrl: values.PUBLIC_URL.replace(/\/+$/, ""),
      sessionSecret: values.SESSION_SECRET,
      oidc: readOidcConfig(values),
      dataDir: values.DATA_DIR,
      port: values.PORT,
      logLevel: values.LOG_LEVEL,
      devUserEmail: values.SQUAWK_DEV_USER?.toLowerCase() ?? null,
      trustedOriginPatterns: readTrustedOriginPatterns(values.SQUAWK_TRUSTED_ORIGINS)
   }
}

function readTrustedOriginPatterns(value: string | undefined): string[] {
   const patterns = (value ?? "")
      .split(",")
      .map(pattern => pattern.trim().toLowerCase())
      .filter(pattern => pattern.length > 0)
   const invalid = patterns.find(pattern => parseOriginPattern(pattern) === null)
   if (invalid !== undefined) {
      throw new Error(
         `SQUAWK_TRUSTED_ORIGINS: "${invalid}" is not an origin pattern like https://*.example.com`
      )
   }
   return patterns
}

function readOidcConfig(values: z.infer<typeof environmentSchema>): OidcConfig | null {
   const { OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret } = values
   if (!clientId && !clientSecret) return null
   if (!clientId || !clientSecret) {
      throw new Error("Set both OIDC_CLIENT_ID and OIDC_CLIENT_SECRET, or neither")
   }

   const allowedEmailDomains = (values.OIDC_ALLOWED_EMAIL_DOMAINS ?? "")
      .split(",")
      .map(domain => domain.trim().toLowerCase())
      .filter(domain => domain.length > 0)
   if (allowedEmailDomains.length === 0) {
      throw new Error("OIDC_ALLOWED_EMAIL_DOMAINS is required when OIDC is configured")
   }

   return {
      issuer: values.OIDC_ISSUER,
      clientId,
      clientSecret,
      allowedEmailDomains,
      hostedDomain: values.OIDC_HOSTED_DOMAIN?.toLowerCase() ?? null
   }
}
