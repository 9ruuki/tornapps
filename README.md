# TornApps

TornApps is a privacy-first personal Torn assistant. The first build is a static browser application designed for GitHub Pages and local development.

## MVP direction

- Personal use first.
- Browser-side Torn API key handling.
- No Full Access keys.
- No server-side key storage.
- Responsive dark UI.
- English and Spanish interface.
- 30-day local history planned through browser storage.

## Current milestone

`M0` creates the application shell:

- Vite + React + TypeScript
- Tailwind CSS
- Local unlock screen
- Dashboard layout
- Bilingual copy
- Feature flags
- Placeholder modules
- GitHub Pages deployment workflow

## Local setup on Windows

Install Node.js LTS and Git first. Then run:

```powershell
npm install -g pnpm
pnpm install
pnpm dev
```

Open:

```text
http://localhost:5173
```

## Build and test

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

## GitHub Pages

The repository includes `.github/workflows/deploy.yml`. When GitHub Pages is enabled for GitHub Actions, every push to `main` will build and deploy the static app.

## Security notes

Never commit Torn API keys, passwords, `.env` files, or secrets. TornApps is designed so the raw Torn API key stays in the browser. The local unlock screen protects the local UI state; it is not a substitute for real server-side authentication.
