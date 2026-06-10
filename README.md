# Kundli AI Exporter — mobile app (PWA)

A standalone, installable web app. All chart math runs on the phone itself
using the Swiss Ephemeris compiled to WebAssembly — the same engine as the
Python app. After the first load everything is cached, so chart generation
works fully offline (only place search needs internet; manual coordinates
work offline).

The JavaScript port was verified line-by-line against the Python app's TXT
output: identical for the same ephemeris source. The bundled ephemeris data
files actually make this version slightly more accurate than the Python app's
Moshier fallback.

## Install on your phone (recommended: free hosting)

The app needs to be served over HTTPS once to become installable. Easiest free
option is GitHub Pages:

1. Create a free account at github.com, then a new public repository
   (e.g. `kundli-app`).
2. Upload the contents of this `mobile-app` folder to the repository
   (drag-and-drop works in the GitHub web UI; the 12 MB `swisseph.data` file
   is fine).
3. In the repository: Settings → Pages → Source: "Deploy from a branch" →
   Branch: `main`, folder `/ (root)` → Save.
4. After a minute your app is live at `https://<username>.github.io/kundli-app/`.
5. Open that URL on your phone, then:
   - Android Chrome: menu ⋮ → "Add to Home screen" / "Install app"
   - iPhone Safari: Share → "Add to Home Screen"

It now opens like a normal app from your home screen and works offline.

Alternatives: Cloudflare Pages or Netlify Drop (drag the folder, get a URL).

## Quick test on this PC

```powershell
cd mobile-app
py -m http.server 8000
```

Open http://localhost:8000. (Service worker/offline mode works on localhost.
Opening via LAN IP on the phone works for testing too, but installing and
offline mode require the HTTPS hosting above.)

## Files

- `index.html`, `app.js` — mobile UI (type-ahead place search, one-tap copy,
  share sheet, TXT/JSON download, collapsible chart details)
- `kundli.js` — chart logic ported from the Python `kundli` package
  (positions, houses, bhava chalit, 16 vargas, ashtakavarga, 5 dasha systems,
  transits, AI text/JSON exporters)
- `lib/` — swisseph-wasm engine (GPL; Swiss Ephemeris dual license applies)
  and tz-lookup (timezone from coordinates)
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA install + offline cache

## Notes

- Timezone history (including pre-1947 Indian zones) comes from the browser's
  built-in IANA database via `Intl`, equivalent to Python `zoneinfo`.
- If you update any file, bump `CACHE` in `sw.js` (v1 → v2) so phones pick up
  the new version.
