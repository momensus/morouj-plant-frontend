# Morouj Plant Frontend (PWA)

Static Progressive Web App for the Morouj Tomato Paste Process Monitoring system.
Plain HTML/CSS/JS — no build step required.

## Deploy on Cloudflare Pages

1. Connect this repo to Cloudflare Pages.
2. **Build command:** `None` (static site, no build)
3. **Build output directory:** `/` (repo root — assets are served at `/`)

### Before deploying
Edit **`_redirects`** and replace `<YOUR-RENDER-URL>` with your deployed Render
service URL, e.g. `https://morouj-api.onrender.com`:

```text
/api/* https://<YOUR-RENDER-URL>/api/:splat 200
/* /index.html 200
```

That proxies every `/api/*` request to the backend with HTTP 200 (the browser
never leaves your Pages domain, so no CORS is involved). Unknown paths fall back
to `index.html`.

### Alternative: direct API URL
Instead of the proxy, set the backend URL in `config.js`:

```js
var MOROUJ_API_BASE = "https://<YOUR-RENDER-URL>";
```

In that case make sure the backend's `CORS_ORIGINS` includes your Pages domain.

## Offline support
- Service Worker (`sw.js`) caches the app shell for offline use.
- `offline-queue.js` stores failed submissions in IndexedDB and replays them
  automatically when connectivity returns (fetch/push/background-sync).