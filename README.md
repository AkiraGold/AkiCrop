# AkiCrop

Client-side image framing PWA. Drop a photo, pick an aspect ratio, fit or fill the frame, then export — as a single crop, a multi-panel carousel strip, or a vertical stack.

Crop for one framed still. Carousel slices a wide image into Instagram-style panels. Stack applies the same frame to several images and exports them together.

## What it does

- **Crop** — aspect presets (1:1, 4:5, 16:9, story, custom, …), Fit/Fill, Auto/Blur/Solid borders, padding, export PNG/JPEG
- **Carousel** — split one image into 2+ panels with zoom; warns when the source is too narrow
- **Stack** — ordered multi-image list or swipe view, shared aspect/border, batch export preview
- Runs entirely in the browser (canvas + optional service worker); no upload backend

## Stack

- SvelteKit 3, Svelte 5, Vite 8, TypeScript 6
- `@sveltejs/adapter-static` → `build/`
- Bun (`bun.lock`) for install and scripts

Client-only — no backend.

## Setup

Needs [Bun](https://bun.sh) ≥ 1.4.

```bash
git clone https://github.com/AkiraGold/AkiCrop.git
cd AkiCrop

bun install
bun dev            # http://localhost:5173
```

HTTPS / LAN:

```bash
bun run dev:https
bun run dev:host
bun run dev:https:host
```

## Scripts

```bash
bun dev
bun run build
bun run preview
bun run check
bun run generate-icons
```

## Layout

```text
scripts/            PWA icon generator
src/
  lib/
    components/     Topbar, Sidebar, Crop/Carousel/Stack views, export + aspect popups
    renderer.ts     canvas compose (preview + export)
    utils.ts        downscale, edge color, debounce
    types.ts        templates, borders, render options
    constants.ts
  routes/           single-page app (+page)
  service-worker.js offline cache for built assets
static/             icons, manifest, headers
amplify.yml         Amplify Hosting build (Bun → build/)
package.json
bun.lock
```

## Deploy

Amplify Hosting uses `amplify.yml`: install Bun, `bun install --frozen-lockfile`, `bun run build`, publish `build/`.

No Amplify Gen 2 backend — static frontend only.

## License

[MIT](LICENSE)
