import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * Generate login parameters for WebSocket authentication.
 * Signs a timestamp (ms since epoch) with the session key.
 * The wallet param should be the EOA wallet address (account owner),
 * while the signature is from the session key.
 */
export async function getWsLoginParams(sessionPrivateKey: Hex, walletAddress?: `0x${string}`) {
  const account = privateKeyToAccount(sessionPrivateKey);
  const timestamp = Date.now().toString();

  // Sign the raw timestamp string with the session key
  const rawSignature = await account.signMessage({
    message: timestamp,
  });
  // Derive API expects signature WITHOUT 0x prefix
  const signature = rawSignature.startsWith("0x") ? rawSignature.slice(2) : rawSignature;

  return {
    // Use EOA wallet address if provided, otherwise fall back to session key address
    wallet: walletAddress ?? account.address,
    timestamp,
    signature,
  };
}

/**
 * Get the public address from a session private key.
 */
export function getSessionPublicKey(privateKey: Hex): Hex {
  const account = privateKeyToAccount(privateKey);
  return account.address;
}
