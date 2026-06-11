# Hedge — documentation site

Mintlify documentation for the Hedge protocol. Content lives in `.mdx` pages; site config (branding, navigation) in `docs.json`.

## Local preview

The Mintlify CLI (`mint`) is a local dev dependency — no global install needed.

```sh
cd docs-site
pnpm install
pnpm dev          # mint dev -> http://localhost:3000
```

## Checks

```sh
pnpm exec mint broken-links   # verify internal links & nav entries
pnpm exec mint validate       # strict build validation (fails on warnings/errors)
```

## Publishing

Hosting is via the Mintlify dashboard (hobby tier is sufficient):

1. Sign in at [dashboard.mintlify.com](https://dashboard.mintlify.com) (create the org if needed).
2. Install the **Mintlify GitHub app** on the `Sats-Terminal/derive` repository and grant it access.
3. In the dashboard, point the deployment at this repo with **`docs-site/` as the content directory** (Settings → Git → set the path/monorepo directory), branch `main`.
4. Every push to `main` that touches `docs-site/` auto-deploys. The dashboard shows build logs and the live URL (a `*.mintlify.app` subdomain on hobby tier; custom domains require a paid tier).

Notes:

- `docs.json` is the single source of truth for navigation — a page not listed there is not reachable from the sidebar.
- Logo/favicon are placeholder SVGs in `logo/` and `favicon.svg`; replace when real branding lands.
- The protocol name "Hedge" is a working name; update `docs.json` (`name`, logos) on rebrand.
