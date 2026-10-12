# Embedding the overlay

The overlay is `squawk.js`, served by every Squawk server at `<PUBLIC_URL>/squawk.js`. It is
framework-free, renders into a Shadow DOM so the page's CSS does not reach it, and is about 36 kB
gzipped. The server sends it with `Cache-Control: public, max-age=300`, so a server upgrade reaches
open previews within five minutes.

## Script tag

```html
<script
   src="https://squawk.example.com/squawk.js"
   data-site="feature/settings"
   data-ref="3f6dd62"
   defer
></script>
```

| Attribute     | Default                              | Meaning                                                                                                                                                    |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src`         |                                      | The overlay. Its origin is the Squawk server the overlay talks to.                                                                                         |
| `data-site`   | the page's hostname                  | Site key: groups squawks and numbers them (`feature/settings#3`). At most 200 characters from `A-Z a-z 0-9 . _ : / @ -`; the server rejects anything else. |
| `data-ref`    | none                                 | Commit, branch or build id the reviewer sees; stored as `meta.ref` on every squawk. At most 200 characters.                                                |
| `data-page`   | path, query and hash of the location | Fixed page key. Turns off following the location (see below).                                                                                              |
| `data-server` | the origin of `src`                  | Server origin, only needed when `squawk.js` is loaded from somewhere other than the Squawk server.                                                         |

The overlay finds its own tag through `document.currentScript`, or else the first
`script[data-server]` or `script[src*='squawk.js']` on the page. Without a server origin it logs a
warning and does nothing.

## Site keys

A site is created when its first squawk arrives; nothing needs to be registered. The convention is
**site key = branch name**: the preview of `feature/settings` embeds `data-site="feature/settings"`,
and an agent working in a checkout of that branch finds the squawks with `squawk site-key`, which
prints the branch with every character outside the allowed set replaced by `-`. Do the same
replacement in your build, for example:

```bash
SQUAWK_SITE=$(printf '%s' "$BRANCH" | sed 's|[^A-Za-z0-9._:/@-]|-|g')
```

Other schemes work as well (`pr-123`, an app name per environment), as long as the people and
agents involved agree on it.

## Page keys and single-page apps

Squawks are grouped by page inside a site. By default the page key is `pathname + search + hash`
of the current location (without a `#squawk=` deep link), at most 2000 characters. The overlay
follows client-side navigation on its own: it listens to `popstate` and `hashchange` and wraps
`history.pushState` and `history.replaceState`.

If your URLs make bad page keys (ids, tracking parameters), set the key yourself with
`Squawk.setPage(key)` on every route change. After the first `setPage` call, or with `data-page`,
the overlay no longer derives the key from the URL.

## `window.Squawk`

Once loaded, `window.Squawk` has:

| Member          | Effect                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `version`       | Overlay version.                                                                                                                        |
| `setPage(key)`  | Sets the page key and stops following the location.                                                                                     |
| `setSite(key)`  | Switches to another site key and reloads the squawks.                                                                                   |
| `setMeta(meta)` | Merges facts into the metadata of new squawks, typically `appVersion`, `ref` and `extra` (a flat object of strings, numbers, booleans). |
| `open()`        | Opens the panel.                                                                                                                        |
| `close()`       | Closes the panel and leaves pin mode.                                                                                                   |
| `capture()`     | Starts pin mode, like pressing `c`. Opens the panel with the sign-in first when the user is not signed in.                              |

Calls made before the script has loaded go into a queue that the overlay replays on start:

```html
<script>
   window.Squawk = window.Squawk || { q: [] }
   window.Squawk.q.push(["setMeta", { appVersion: "2.4.0", extra: { tenant: "demo" } }])
   window.Squawk.q.push(["setPage", "/projects/:id"])
</script>
<script src="https://squawk.example.com/squawk.js" data-site="feature/settings" defer></script>
```

Every squawk records `url`, `title`, `userAgent`, `viewport` and `devicePixelRatio` on its own;
values from `setMeta` win over them.

## Loading it on previews only

Gate the script on a build-time variable that only preview environments set, so production
bundles never contain it. [AGENTS.md](../AGENTS.md#embed-the-overlay) has examples for Vite and
Next.js. Until someone signs in, the overlay makes no API calls.

## Sign-in

The first click on **Sign in** opens a popup on `<PUBLIC_URL>/connect`. It uses the browser
session on the Squawk server (signing in through OIDC first if needed), asks for consent on a "Connect this site" card unless the page origin matches `SQUAWK_TRUSTED_ORIGINS`, and posts a 30-day login token back to
exactly the page origin that opened it. The overlay keeps the token in the page origin's
`localStorage` under `squawk:<server origin>:token`.

When the popup is blocked, or with **Use a code instead** (useful inside embedded web views), the
overlay shows a code that the user confirms on `<PUBLIC_URL>/device`.

`SQUAWK_TRUSTED_ORIGINS` is a comma-separated list of `scheme://host[:port]` patterns; `*` matches
part of one host label (never a dot) or any port, e.g.
`https://*.preview.example.com,http://localhost:*`.

## Content Security Policy

If the preview sends a CSP, allow the Squawk origin:

| Directive     | Add                                          | Why                                                                |
| ------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `script-src`  | `https://squawk.example.com`                 | `squawk.js`                                                        |
| `connect-src` | `https://squawk.example.com`                 | API calls                                                          |
| `img-src`     | `https://squawk.example.com blob: data:`     | Screenshots are fetched with the token and shown as `blob:` URLs   |
| `style-src`   | `https://squawk.example.com 'unsafe-inline'` | The overlay's `<style>` in its shadow root, and the Inter font CSS |
| `font-src`    | `https://squawk.example.com`                 | Inter                                                              |

`Cross-Origin-Opener-Policy: same-origin` cuts the popup off from the page, so sign-in can only
use the code. Use `same-origin-allow-popups` on previews if you need COOP.

## Deep links

`#squawk=<id>` in a page URL opens that thread when the overlay starts or the hash changes. The
overlay and the inbox build these links for you; other hash content (hash routers) is kept.

## Exact screenshots: the Chrome extension

Without the extension the overlay renders the page into an image itself, which is approximate
(canvas content, web fonts and some CSS come out wrong). With it, Chrome supplies a pixel-exact
capture of the visible tab.

1. Download `squawk-extension-<version>.zip` from the
   [latest release](https://github.com/studypilot/squawk/releases/latest) and unzip it.
2. Open `chrome://extensions`, switch on **Developer mode**.
3. **Load unpacked** and select the unzipped folder (the one with `manifest.json`).
4. Reload tabs that already show the overlay.

What it may capture and when is described in [packages/extension/README.md](../packages/extension/README.md).

## Keyboard

| Key       | Action                                   |
| --------- | ---------------------------------------- |
| `c`       | Pin a new squawk                         |
| `j` / `k` | Next / previous thread (also `]` / `[`)  |
| `r`       | Resolve the open thread (with undo)      |
| `u`       | Mark the open thread unread              |
| `Esc`     | Leave a field, close the thread or panel |

Shortcuts are ignored while the page's own inputs have focus.
