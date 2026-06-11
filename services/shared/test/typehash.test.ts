import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPEHASH,
  ACTION_TYPE_STRING,
  FEED_DATA_TYPEHASH,
  FEED_DATA_TYPE_STRING,
} from "../src/constants.js";

const repoRoot = resolve(__dirname, "..", "..", "..");

function deployedBytecode(artifactPath: string): string {
  const artifact = JSON.parse(readFileSync(join(repoRoot, artifactPath), "utf8"));
  const obj = artifact.deployedBytecode?.object ?? artifact.deployedBytecode;
  if (typeof obj !== "string") throw new Error(`no deployedBytecode in ${artifactPath}`);
  return obj.toLowerCase();
}

describe("EIP-712 typehashes vs vendored compiled bytecode", () => {
  it("recomputes ACTION_TYPEHASH from the type string", () => {
    expect(keccak256(toHex(ACTION_TYPE_STRING))).toBe(ACTION_TYPEHASH);
    // Known-good value for the vendored Action struct
    expect(ACTION_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("ACTION_TYPEHASH constant is embedded in ActionVerifier + Matching bytecode", () => {
    const needle = ACTION_TYPEHASH.slice(2).toLowerCase();
    expect(
      deployedBytecode("protocol/lib/v2-matching/out/ActionVerifier.sol/ActionVerifier.json"),
    ).toContain(needle);
    expect(
      deployedBytecode("protocol/lib/v2-matching/out/Matching.sol/Matching.json"),
    ).toContain(needle);
  });

  it("FEED_DATA_TYPEHASH constant is embedded in every Lyra feed's bytecode", () => {
    expect(keccak256(toHex(FEED_DATA_TYPE_STRING))).toBe(FEED_DATA_TYPEHASH);
    const needle = FEED_DATA_TYPEHASH.slice(2).toLowerCase();
    for (const feed of ["LyraSpotFeed", "LyraForwardFeed", "LyraVolFeed", "LyraRateFeed"]) {
      expect(
        deployedBytecode(`protocol/lib/v2-core/out/${feed}.sol/${feed}.json`),
      ).toContain(needle);
    }
  });

  it("matches the literal type string in the vendored Solidity source", () => {
    const src = readFileSync(
      join(repoRoot, "protocol/lib/v2-matching/src/ActionVerifier.sol"),
      "utf8",
    );
    expect(src).toContain(`"${ACTION_TYPE_STRING}"`);
    const feedSrc = readFileSync(
      join(repoRoot, "protocol/lib/v2-core/src/feeds/BaseLyraFeed.sol"),
      "utf8",
    );
    expect(feedSrc).toContain(`"${FEED_DATA_TYPE_STRING}"`);
  });
});
