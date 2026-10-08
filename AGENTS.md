# caffeine-browser

React + Vite + Tailwind CSS project — a self-hosted in-browser web browser (Caffeine-style proxy) deployed on Railway.

## Stack
- React 19 + TypeScript
- Vite (dev server and production build/preview on `PORT`, default 8443)
- Tailwind CSS v4 via `@tailwindcss/vite`

## Key files
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, site-configuration plugins, and the `@` alias for `src`
- `server.js` - Express server that also serves the `/p/...` URL proxy used by the built-in browser
- `public/caffeine-proxy.js` - Service worker + HTML rewriting helpers for the proxy
- `src/App.tsx` - Browser UI (tabs, search bar, profiles)
- `.make-site/site.json` - Site metadata (title, description, icons) applied to the HTML shell

## Commands
- `npm run dev` - start the dev server
- `npm run build` - produce `dist/`
- `npm run preview` / `node server.js` - serve the built app + proxy
