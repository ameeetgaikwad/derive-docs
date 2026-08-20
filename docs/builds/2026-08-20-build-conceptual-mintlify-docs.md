# Build Conceptual Mintlify Docs

Created: 2026-08-20
Agent: Codex
Status: VERIFIED
Approved: Yes
Rounds: 2
Worktree: No
Type: Build

## Summary

**Goal:** Create a second, standalone Mintlify project at `concept-site/` that a CEO can use as a conceptual investor narrative, while leaving the technical `docs-site/` and the product web app unchanged.

**Oracle:** A deterministic navigation and rendered-content audit finds the five groups `Start Here` → `The Thesis` → `Product` → `Platform` → `Proof & Path` in order; across their linked pages it finds the category thesis, holder problem, BTC covered-call wedge, the sequence `collateralize` → `quote and accept` → `settle on-chain`, transaction-linked business model, reusable platform thesis, bounded current proof, explicit pre-launch boundary, and milestone-based path, with no integration instructions.

**Misfire:** The result becomes another integration manual, a generic marketing landing page, or an investor story containing fabricated traction, partnerships, market-size, fundraising, or production-readiness claims.

**Constraints:** Use Mintlify MDX rather than a Next.js route; keep the conceptual site in its own deployable root; preserve `docs-site/`, product routes, protocol behavior, deployment manifests, unrelated user changes, and Git state; ground factual claims only in the explicit source allowlist below; invent no metrics, partners, team facts, fundraising facts, or launch claims; identify chain-56 activity as isolated capped staging and Hedge as `PRE-LAUNCH`. This is a documentation/configuration build, so test-first code work is not applicable; content, config, claim, link, and runtime checks are the deciding evidence.

**Reference:** Reuse the information architecture and Mintlify conventions from the local `docs-site/` project, while replacing its technical integration focus with a conceptual pitch-book structure. Current readiness language comes from `PRODUCTION.md` and current staging configuration, not stale documentation copy.

**Claim source allowlist:** `PRODUCTION.md`; `protocol/deployments/staging/markets/56.json`; `docs-site/how-it-works.mdx`; `docs-site/architecture.mdx`; `docs-site/reference/fees.mdx`; and `apps/web/src/components/marketing/PublicLanding.tsx`. If sources conflict, `PRODUCTION.md`, current manifests, and current application source outrank descriptive documentation. No traction, partnership, market-size, fundraising, team, or production-availability claim is allowed because none is established by this allowlist.

## Acceptance Criteria

- [x] Criterion 1 (oracle): A deterministic audit of `docs.json` and rendered MDX finds the five required groups and narrative beats in order, including the exact market-loop sequence `collateralize` → `quote and accept` → `settle on-chain`; the same audit rejects integration instructions and any factual claim outside the explicit allowlist.
- [x] Criterion 2: `concept-site/docs.json` defines a standalone Mintlify root with exactly ten navigable conceptual MDX pages.
- [x] Criterion 3: The prior attempt's exact artifacts—`apps/web/src/app/investors/`, `apps/web/src/components/investors/`, `apps/web/public/og.png`, `apps/web/src/types/styles.d.ts`, and `docs/builds/2026-08-19-build-investor-marketing-site.md`—are absent; unrelated untracked files are preserved, and the final tracked-diff digest for `apps/web/` plus `docs-site/` equals its empty baseline digest.
- [x] Criterion 4: `concept-site/investors/brief.mdx` passes a content-contract audit: 450–650 prose words; labeled coverage of thesis, wedge, mechanism, business model, proof/status, and next milestone; plus a visible checklist of facts to verify before external circulation.
- [x] Criterion 5: One rendered current-status disclosure contains `PRE-LAUNCH`, identifies chain 56 as isolated capped staging, names BTC, Gold, S&P 500, and NVIDIA only as staging-manifest markets, states that production deposits and unrestricted production trading remain gated, and states that stale RWA sources fail closed.
- [x] Criterion 6: The release check exits successfully only after `mint validate`, `mint broken-links`, HTTP 200 checks for the home page and investor brief, and browser inspection of the five conceptual navigation groups and opening narrative have each passed.

## Out of Scope

- Production deployment, Mintlify dashboard configuration, custom-domain/DNS changes, Git operations, changes to technical docs, protocol implementation, confidential team material, financial projections, market sizing, fundraising terms, partner/customer logos, and unverified traction.

## Progress Tracking

- [x] Task 1: Remove only `apps/web/src/app/investors/`, `apps/web/src/components/investors/`, `apps/web/public/og.png`, `apps/web/src/types/styles.d.ts`, and `docs/builds/2026-08-19-build-investor-marketing-site.md`; preserve unrelated untracked changes and record the exact removals.
- [x] Task 2: Scaffold the standalone `concept-site/` Mintlify configuration, package metadata, workspace entry, and operator README.
- [x] Task 3: Write the opening, thesis, and product narrative pages in plain conceptual language.
- [x] Task 4: Write the platform, business-model, proof, roadmap, and CEO investor-brief pages with bounded status language.
- [x] Task 5: Audit claims and information architecture, run Mintlify validation and link checks, inspect the local preview, and record verification.

## Round Log

- Pre-loop discovery: The prior implementation created a Next.js marketing route, which does not match the corrected request. The intended artifact is a second Mintlify content root beside the technical docs. Current production guidance remains `PRE-LAUNCH`; isolated chain-56 testing must be labelled as capped staging, and no repository source establishes investor-ready traction, market size, partnerships, fundraising, or team claims.
- Build review: Replaced reader-comprehension language with deterministic artifact checks; fixed the market loop as collateralize, quote and accept, then settle on-chain; named the only allowable factual sources and their precedence; made cleanup targets exact; separated site-root and cleanup criteria; and converted the brief, status disclosure, and release checks into explicit content contracts.
- Round 1 build: Removed only the prior untracked Next.js attempt, created a standalone ten-page Mintlify narrative, added an editorial source boundary and deterministic content audit, registered the new workspace importer, and rendered the local preview. The story now moves from category and holder problem through the BTC wedge, three-step market loop, fee mechanism, reusable platform, bounded staging proof, and evidence-gated roadmap.
- Round 1 judge: All six criteria passed. The content audit reports ten unique pages and a 556-word CEO brief; Mintlify validation and broken-link checks pass; home and brief return HTTP 200; browser inspection shows the five navigation groups and rendered brief; and the tracked-diff digest for `apps/web/` plus `docs-site/` remains the empty baseline digest.
- Round 2 build: Final review found that forbidden-word patterns alone could not enforce the explicit source boundary. Added `claims.json` with the six-source allowlist, ordered per-page source reviews, representative approved claim markers, and a frozen SHA-256 of the complete ten-page MDX corpus. The audit now rejects any unreviewed prose change, exercises an unsupported-sentence mutation regression, compares market-loop step positions, and requires all eight pre-circulation fact categories.
- Round 2 judge: All six criteria pass after the audit hardening. Final independent review verified 6/6 truths with high compliance, high quality, and the goal achieved; its only remaining note was to add `claims.json` to this inventory, which is now done.

## Changed Files

- `concept-site/docs.json`
- `concept-site/claims.json`
- `concept-site/package.json`
- `concept-site/README.md`
- `concept-site/EDITORIAL.md`
- `concept-site/index.mdx`
- `concept-site/investors/brief.mdx`
- `concept-site/thesis/category.mdx`
- `concept-site/thesis/held-assets.mdx`
- `concept-site/product/outcome-first.mdx`
- `concept-site/product/market-loop.mdx`
- `concept-site/platform/business-model.mdx`
- `concept-site/platform/market-engine.mdx`
- `concept-site/progress/proof.mdx`
- `concept-site/progress/roadmap.mdx`
- `concept-site/scripts/audit-content.mjs`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `docs/builds/2026-08-20-build-conceptual-mintlify-docs.md`

Removed prior untracked artifacts: `apps/web/src/app/investors/`, `apps/web/src/components/investors/`, `apps/web/public/og.png`, `apps/web/src/types/styles.d.ts`, and `docs/builds/2026-08-19-build-investor-marketing-site.md`.

## Verification Record

| Layer | Evidence |
|---|---|
| Config | `docs.json` defines five ordered groups and ten unique pages; `pnpm-lock.yaml` adds only the matching `concept-site` importer. |
| Content | `pnpm --dir concept-site run audit:content` passes with ten pages, a 556-word brief, and reviewed digest prefix `3af8f68c267f`; `claims.json` fixes the six-source allowlist, per-page source/claim review, and full-corpus digest, while the audit checks an unsupported-sentence mutation, narrative/step order, forbidden technical material, brief structure, and the single status disclosure. |
| Build | `pnpm --dir concept-site run validate` exits zero with `success build validation passed`. |
| Links | `pnpm --dir concept-site run check:links` exits zero with `success no broken links found`. |
| Runtime | Local Mintlify preview on port 3311 returns HTTP 200 for `/` and `/investors/brief`; browser DOM inspection confirms the full sidebar order, opening narrative, brief sections, and warning checklist. |
| Isolation | The final `apps/web/` plus `docs-site/` tracked-diff SHA-256 is `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`, equal to the recorded empty baseline; narrow status is clean after removing the exact prior artifacts. |
| Review | Build review passed with high alignment and low risk. Final changes review verified 6/6 truths with high compliance, high quality, and `goal_score=achieved`; its one changed-files inventory note was resolved. |

## Not Verified

- Production deployment, Mintlify dashboard connection, custom-domain/DNS work, and any Git operation were not performed.
- No authenticated/private investor facts were supplied, so team, traction, partner, market-size, fundraising, use-of-funds, cap-table, and projection material remains an explicit pre-circulation checklist rather than site claims.
- The stock Mintlify theme was inspected through rendered DOM and browser logs; no separate automated accessibility audit or viewport matrix was run.
