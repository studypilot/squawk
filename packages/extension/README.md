# Squawk Screenshots (Chrome extension)

The Squawk overlay lets you pin a comment to a spot on a preview deployment and attaches a
screenshot. Without this extension the overlay renders the page into an image itself, which is only
approximate (canvas content, web fonts and some CSS come out wrong). With the extension installed
the overlay gets a pixel-exact screenshot of the visible tab from Chrome instead.

That is the extension's only job. It has no settings and no UI beyond a small status popup.

## How it works

1. When the overlay starts, it posts `ext:ping` to its own window. The extension's content script
   answers with `ext:pong` and its version, so the overlay knows exact screenshots are available.
2. When you pin a spot, the overlay hides itself and posts `ext:capture` with a request id.
3. The content script checks the request (see below), asks the background service worker, which
   calls `chrome.tabs.captureVisibleTab` for the tab you are looking at, and posts the PNG back as
   `ext:captured` together with `devicePixelRatio`.

The message format is defined in `packages/shared/src/extension-protocol.ts`.

## Privacy

- The extension captures only when a page that embeds the Squawk overlay asks for it, and only if
  that same page announced itself first (`ext:ping`) and you clicked or typed on the page within
  the last few seconds (`navigator.userActivation`). A page cannot take screenshots silently in
  the background, and synthetic clicks fired by page scripts do not count.
- Only the visible area of the tab you are currently looking at is captured, never other tabs.
- The extension never uploads, stores or sends anything anywhere. It hands the image to the page
  that asked for it. The Squawk overlay then uploads it to its own Squawk server together with your
  comment, exactly as it would with its built-in approximate screenshot.
- The content script only answers messages from the page's own window and only replies to the
  page's own origin.

## Install

1. Download `squawk-extension-<version>.zip` from the release and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
4. Reload any tab that already has the Squawk overlay open.

To update, replace the folder contents with the new release and click the reload icon on the
extension's card in `chrome://extensions`.

## Why it asks for access to all sites

`chrome.tabs.captureVisibleTab` needs either the `activeTab` permission, which is only granted
after you click the extension's toolbar icon, or host access to the page. The overlay asks for the
screenshot right when you pin a spot, without a click on the toolbar icon, so the extension needs
host access (`<all_urls>`). Preview deployments live on many different hostnames, so it cannot be
narrowed to a fixed list. The content script runs on every page but stays idle unless the page
embeds Squawk and talks to it as described above.

## Troubleshooting

**The overlay says "Approximate screenshot".** The overlay did not get an answer to its ping:

- The extension is not installed or is switched off in `chrome://extensions`.
- The page was already open when you installed or updated the extension. Reload the page so the
  content script is injected and the overlay can ping it again.
- The page runs inside an iframe. The content script only runs in top-level pages.

**A screenshot fails although the extension is installed.** Chrome refuses captures on its own
pages (`chrome://`, the Chrome Web Store) and when the tab is not the active tab of its window. If
the extension was reloaded while the page stayed open, reload the page as well.

## Development

```bash
pnpm --filter @squawk/extension build      # dist/, ready for "Load unpacked"
pnpm --filter @squawk/extension test
pnpm --filter @squawk/extension zip        # checks dist/ and writes squawk-extension-<version>.zip
```

The icons are drawn by `scripts/icon.ts` at build time; the manifest is generated in
`vite.config.ts` with the version from `package.json`. The content script is built separately as a
single classic script because Chrome does not load content scripts as modules.
