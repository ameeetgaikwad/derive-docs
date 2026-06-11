# Vendored code provenance

Pinned for license compliance — do NOT advance these commits without counsel review.
See `docs/bnb-options-protocol-plan.md` for the full licensing analysis.

| Path | Upstream | Pinned commit | Date | License at this pin |
|---|---|---|---|---|
| `protocol/lib/v2-core` | github.com/derivexyz/v2-core | `0ae94c055fe69d1a724d39249fca3c8decb61e24` | 2025-01-31 | BUSL-1.1 whose Change Date (2025-11-16) has passed → **GPL-3.0-or-later** (applies to all code released before 2025-02-17) |
| `protocol/lib/v2-matching` | github.com/derivexyz/v2-matching | `ae6e3847a1a06e697ff670ed397da44a824a9063` | 2025-01-31 | **AGPL-3.0** (repo LICENSE). Its `lib/v2-core` submodule points at exactly our v2-core pin. |

Rules:
- Never cherry-pick from upstream `master` past 2025-02-17 into v2-core paths (those commits are BUSL-1.1 until 2029-03-20). In particular: no `PMRM_2`, no `PMRM_2_1`.
- Files headered `UNLICENSED` in v2-matching (`LiquidateModule.sol`, TSA collateral-management files if present at this pin) are pending counsel review — do not build product features on them yet.
- GPL/AGPL grant no trademark rights: no "Derive"/"Lyra" branding in anything user-facing.
- Our own code (deploy scripts, services) lives OUTSIDE `protocol/lib/` and only imports the vendored source.
