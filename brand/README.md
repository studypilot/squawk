# Squawk mark

The Squawk logo is an outline speech bubble shaped like a bird, with one eye. `squawk-mark.svg`
is the outline in `currentColor`; `squawk-tile.svg` is the white outline on a rounded tile in the
brand blue `#2d98da`. Use the outline on surfaces that set a text colour, and the tile wherever a
solid icon is needed (favicon, touch icon, extension icons).

Thin lines vanish at small sizes, so stroke width and eye radius depend on the rendered size:

| Rendered size | Outline stroke | Outline eye radius |
| ------------- | -------------- | ------------------ |
| 48 px and up  | 5              | 3.2                |
| 24 to 47 px   | 6              | 3.6                |
| 17 to 23 px   | 7              | 4                  |
| 16 px or less | 8              | 4.5                |

The tile uses stroke 7 and eye radius 4.2 up to 32 px, and stroke 5 and eye radius 3.4 above.

The code copies live in `packages/inbox/src/assets/squawk-mark.tsx` and
`packages/overlay/src/ui/dom.ts`. The PNGs (`packages/inbox/public/apple-touch-icon.png`,
`packages/extension/icons/`) are the tile rendered in Chromium at their target size.
