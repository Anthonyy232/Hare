# Hare media

Generated images for [Hare](https://github.com/Anthonyy232/Hare), kept off `main` so it stays light: the README hero and feature panels, the website screenshots, and the release banners. Every script takes the path of a Hare checkout of `main`, reads the logo from its `assets/logo.svg`, and needs no network.

| Path | What |
| --- | --- |
| `lib.cjs` | Fonts and rendering shared by the scripts |
| `fonts/` | Instrument Serif, under the SIL Open Font License (`OFL.txt`) |
| `readme/capture.cjs` | Captures the popup, Sync Mode, settings and on-page controller from the built extension into `readme/inputs/` |
| `readme/build.cjs` | Writes `.github/readme/*.png` and `site/img/*.png` in the checkout from `readme/inputs/`, and `social-preview.png` here, and the Chrome Web Store screenshots (1280x800) and promo tile (440x280) in `store/` |
| `social-preview.png` | The 1280x640 GitHub social preview |
| `releases/banner.cjs` | Writes `releases/v<version>.png` from `releases/banners.json` |

## Setup

From a Hare checkout of `main`:

```bash
git worktree add local/media media
cd local/media
npm ci && npx playwright install chromium
```

## README and site images

```bash
(cd ../.. && npm ci && npm run build)   # capture loads .output/chrome-mv3
node readme/capture.cjs ../..           # only when the UI changed
node readme/build.cjs ../..
```

The capture serves the e2e fixture page (`tests/e2e/server.mjs`) as `watch.example`, opens two tabs titled "Grand Prix replay: onboard camera" and "Grand Prix replay: live commentary", sets 1.5× from the popup, pairs both tabs in Sync Mode, and opens the settings page with the controller preview expanded. It runs in light and dark at 2x, in a throwaway profile. The on-page controller is saved as HTML and CSS (`controller.html`) so the build draws it sharp at any scale.

Commit the new inputs and `social-preview.png` here, and the changed images on `main`. GitHub has no API for the social preview: upload `social-preview.png` in the repository settings under Social preview.

## Release banners

```bash
node releases/banner.cjs ../.. 1.11.0 "One short highlight"
```

That records the highlight in `releases/banners.json` and writes `releases/v1.11.0.png` (1280x640). Without a version it redraws every banner. Commit, push, and use the raw URL in the release notes:

`https://raw.githubusercontent.com/Anthonyy232/Hare/media/releases/v1.11.0.png`
