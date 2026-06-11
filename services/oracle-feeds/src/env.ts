import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * Anvil's well-known account #0 key. The anvil deploy script whitelists
 * 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (anvil #0) as the feed signer
 * (`feedSigner` in protocol/deployments/31337.json), so this is a safe
 * default ONLY for chainId 31337.
 */
const ANVIL_KEY_0: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Feed signer key from FEED_SIGNER_KEY. On anvil (31337) we fall back to the
 * anvil #0 key; on any other chain the env var is mandatory.
 */
export function getFeedSignerAccount(chainId: number): PrivateKeyAccount {
  const raw = process.env.FEED_SIGNER_KEY;
  if (raw) {
    const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
    return privateKeyToAccount(key);
  }
  if (chainId === 31337) return privateKeyToAccount(ANVIL_KEY_0);
  throw new Error(`FEED_SIGNER_KEY env var is required for chainId ${chainId}`);
}

/** Signature deadline horizon in seconds (FEED_DEADLINE_SEC, default 1h). */
export function getDeadlineSec(): bigint {
  return BigInt(process.env.FEED_DEADLINE_SEC ?? 3600);
}
