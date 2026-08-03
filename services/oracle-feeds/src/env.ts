import type { Hex, LocalAccount } from "viem";
import { resolveAccount } from "@hedge/shared";

/**
 * Anvil's well-known account #0 key. The anvil deploy script whitelists
 * 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (anvil #0) as the feed signer
 * (`feedSigner` in protocol/deployments/31337.json), so this is a safe
 * default ONLY for chainId 31337.
 */
const ANVIL_KEY_0: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * Feed signer account. Resolution order (via shared resolveAccount):
 * 1. FEED_SIGNER_KMS_KEY_ID  -> AWS KMS-backed account (key never leaves the HSM)
 * 2. FEED_SIGNER_KEY         -> raw private key
 * 3. anvil #0 key            -> chainId 31337 only
 */
export async function getFeedSignerAccount(chainId: number): Promise<LocalAccount> {
  const raw = process.env.FEED_SIGNER_KEY;
  const key = raw ? ((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex) : undefined;
  if (!key && !process.env.FEED_SIGNER_KMS_KEY_ID && chainId !== 31337) {
    throw new Error(`FEED_SIGNER_KMS_KEY_ID or FEED_SIGNER_KEY is required for chainId ${chainId}`);
  }
  return resolveAccount({
    role: "FEED_SIGNER",
    privateKey: key ?? (chainId === 31337 ? ANVIL_KEY_0 : undefined),
  });
}

/** Signature deadline horizon in seconds (FEED_DEADLINE_SEC, default 1h). */
export function getDeadlineSec(): bigint {
  return BigInt(process.env.FEED_DEADLINE_SEC ?? 3600);
}
