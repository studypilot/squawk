export type Theme = "system" | "light" | "dark"

export const THEME_STORAGE_KEY = "squawk.theme"

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
   { value: "system", label: "System" },
   { value: "light", label: "Light" },
   { value: "dark", label: "Dark" }
]

/** The persisted choice; anything unknown or unreadable counts as "system". */
export function readTheme(): Theme {
   try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      return stored === "light" || stored === "dark" ? stored : "system"
   } catch {
      return "system"
   }
}

/**
 * Mirrors the inline script in index.html: light and dark pin `data-theme`, system removes it so
 * `prefers-color-scheme` decides.
 */
export function applyTheme(theme: Theme): void {
   const root = document.documentElement
   if (theme === "system") {
      root.removeAttribute("data-theme")
   } else {
      root.setAttribute("data-theme", theme)
   }
   try {
      if (theme === "system") {
         localStorage.removeItem(THEME_STORAGE_KEY)
      } else {
         localStorage.setItem(THEME_STORAGE_KEY, theme)
      }
   } catch {
      // Without storage the choice lasts for this page only.
   }
}
