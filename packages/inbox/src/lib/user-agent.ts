/**
 * A short, human description of a user agent string such as "Safari 26 · iOS" or
 * "Chrome 131 · macOS". Returns null when neither a browser nor a platform is recognised.
 */
export function describeUserAgent(userAgent: string): string | null {
   const browser = detectBrowser(userAgent)
   const platform = detectPlatform(userAgent)
   const parts = [browser, platform].filter((part): part is string => part !== null)
   return parts.length === 0 ? null : parts.join(" · ")
}

function detectBrowser(userAgent: string): string | null {
   const candidates: ReadonlyArray<[string, RegExp]> = [
      ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
      ["Opera", /OPR\/(\d+)/],
      ["Samsung Internet", /SamsungBrowser\/(\d+)/],
      ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
      ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
      ["Safari", /Version\/(\d+)[.\d]* .*Safari/]
   ]
   for (const [name, pattern] of candidates) {
      const match = userAgent.match(pattern)
      if (match !== null) {
         return `${name} ${match[1]}`
      }
   }
   return null
}

function detectPlatform(userAgent: string): string | null {
   if (/iPhone|iPod/.test(userAgent)) {
      return "iOS"
   }
   if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent))) {
      return "iPadOS"
   }
   if (/Android/.test(userAgent)) {
      return "Android"
   }
   if (/Windows/.test(userAgent)) {
      return "Windows"
   }
   if (/Mac OS X|Macintosh/.test(userAgent)) {
      return "macOS"
   }
   if (/CrOS/.test(userAgent)) {
      return "ChromeOS"
   }
   if (/Linux/.test(userAgent)) {
      return "Linux"
   }
   return null
}
