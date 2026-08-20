# Hedge conceptual docs

This is the investor- and company-facing Hedge narrative. It is a separate Mintlify project from `docs-site/`, which remains the technical integration reference.

## Local preview

From the repository root:

```sh
pnpm install
pnpm --dir concept-site dev
```

Mintlify prints the local preview URL when it starts.

## Checks

```sh
pnpm --dir concept-site check
```

That command runs strict Mintlify validation followed by the internal-link check.

## Editorial safety

Read `EDITORIAL.md` before changing factual claims. The site deliberately says PRE-LAUNCH and distinguishes current staging configuration from public or production availability. It contains no invented traction, partner, market-size, team, or fundraising facts.

The investor brief includes a visible checklist of company facts that still need verified CEO input. Keep those items framed as missing inputs until source material is supplied.

## Publish as a second Mintlify project

1. Create a new project in the Mintlify dashboard; do not repoint the technical docs project.
2. Connect the `Sats-Terminal/derive` repository and the intended release branch.
3. Set the monorepo or content directory to `concept-site`.
4. Run the local checks and review `progress/proof.mdx` against current deployment evidence.
5. Publish to the generated Mintlify URL, then add a custom domain only when the narrative and company facts are approved for public circulation.

Publishing requires an authorized Git push and Mintlify dashboard access. Neither is performed by the local build.
