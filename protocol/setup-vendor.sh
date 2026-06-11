#!/usr/bin/env bash
# Restores the vendored Derive v2 repos at the license-pinned commits.
# See PROVENANCE.md before changing ANY pin.
set -euo pipefail
cd "$(dirname "$0")/lib" 2>/dev/null || { mkdir -p "$(dirname "$0")/lib" && cd "$(dirname "$0")/lib"; }

V2_CORE_PIN=0ae94c055fe69d1a724d39249fca3c8decb61e24      # last commit before 2025-02-17 BUSL cutoff -> GPL-3.0
V2_MATCHING_PIN=ae6e3847a1a06e697ff670ed397da44a824a9063  # AGPL-3.0; its v2-core submodule == V2_CORE_PIN

[ -d v2-core ] || git clone https://github.com/derivexyz/v2-core.git
[ -d v2-matching ] || git clone https://github.com/derivexyz/v2-matching.git

git -C v2-core checkout -q "$V2_CORE_PIN"
git -C v2-core submodule update --init --recursive --quiet
git -C v2-matching checkout -q "$V2_MATCHING_PIN"
git -C v2-matching submodule update --init --recursive --quiet

echo "vendor pinned: v2-core@$V2_CORE_PIN v2-matching@$V2_MATCHING_PIN"
echo "build: (cd v2-core && forge build) && (cd v2-matching && forge build) && (cd .. && forge build)"
