/** Prefix of every bearer token Squawk issues. Lets logs and the UI recognise a token at a glance. */
export const TOKEN_PREFIX = "sqk_"

/** Number of random characters after the prefix. */
export const TOKEN_RANDOM_LENGTH = 32

/** Characters shown in token lists so a human can tell tokens apart without seeing the secret. */
export const TOKEN_DISPLAY_PREFIX_LENGTH = 12

/** Device-code lifetime in seconds. */
export const DEVICE_CODE_TTL_SECONDS = 600

/** Minimum polling interval the server tells clients to respect. */
export const DEVICE_CODE_POLL_INTERVAL_SECONDS = 3

/** Lifetime of tokens issued through the device-code flow (overlay and CLI logins). */
export const LOGIN_TOKEN_TTL_DAYS = 30

/** Limits enforced by the server and mirrored by the clients. */
export const LIMITS = {
   bodyMaxLength: 10_000,
   screenshotMaxBytes: 8 * 1024 * 1024,
   screenshotMaxWidth: 2560,
   anchorMaxBytes: 16 * 1024,
   siteKeyMaxLength: 200,
   pageKeyMaxLength: 2000,
   tokenNameMaxLength: 100,
   listPageSize: 50
} as const

/** Fragment the overlay reads to open a thread directly: `https://host/page#squawk=<id>`. */
export const SQUAWK_LINK_FRAGMENT_KEY = "squawk"

/** Key under which the overlay stores its token in the page origin's localStorage. */
export function overlayStorageKey(serverOrigin: string): string {
   return `squawk:${serverOrigin}:token`
}
