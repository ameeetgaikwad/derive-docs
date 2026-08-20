# Editorial claim boundary

The conceptual site can make product-thesis statements, but every present-tense factual claim must be supported by one of these current repository sources:

- `PRODUCTION.md`
- `protocol/deployments/staging/markets/56.json`
- `docs-site/how-it-works.mdx`
- `docs-site/architecture.mdx`
- `docs-site/reference/fees.mdx`
- `apps/web/src/components/marketing/PublicLanding.tsx`

If those sources conflict, current production guidance, manifests, and application source outrank descriptive documentation.

`claims.json` is the machine-readable review boundary. It maps every conceptual page to allowed sources and representative approved claims, then freezes the complete ten-page MDX corpus with a SHA-256 digest. Any prose change—including a plausible factual sentence without a forbidden keyword—fails `pnpm audit:content` until the changed page is reviewed against the allowlist, its claim markers are updated, and the reviewed digest is deliberately replaced. The current digest can be printed with `node scripts/audit-content.mjs --print-digest`; printing it does not approve it.

## Approved factual shapes

- Hedge is PRE-LAUNCH.
- Chain 56 is an isolated, capped staging environment for explicitly labelled public testing.
- The tracked staging manifest spans BTC, Gold, the S&P 500, and NVIDIA; that does not prove every market is continuously public or production-live.
- Production deposits and unrestricted production trading remain gated.
- Stale RWA sources fail closed; the equity calendar is not a promise of continuous pricing.
- When a fill creates new open interest, each side pays a configurable cash fee to the configured fee account. This is a mechanism, not a claim of realized revenue or final production pricing.
- A minimal-value BTCB staging trade has completed; outstanding settlement rehearsals prevent this from being described as launch readiness.

## Claims that require new evidence

Do not add traction, customer, partnership, market-size, team, fundraising, financial projection, production-availability, or fixed-take-rate claims until the underlying evidence is supplied and reviewed.
