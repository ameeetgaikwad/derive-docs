import { type WalletClient, type Hex, erc20Abi, maxUint256 } from "viem";
import { getPublicClient, waitForTransactionReceipt } from "wagmi/actions";
import type { Config } from "wagmi";
import {
  type BridgeToken,
  type SourceChainId,
  getBridgeConfig,
  BRIDGE_MSG_GAS_LIMIT,
} from "./bridge-config";

/** Minimal Socket vault ABI for depositToAppChain + getMinFees */
const SOCKET_VAULT_ABI = [
  {
    name: "depositToAppChain",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "receiver_", type: "address" },
      { name: "amount_", type: "uint256" },
      { name: "msgGasLimit_", type: "uint256" },
      { name: "connector_", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getMinFees",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "connector_", type: "address" },
      { name: "gasLimit_", type: "uint256" },
    ],
    outputs: [{ name: "totalFees", type: "uint256" }],
  },
] as const;

export interface EstimateBridgeFeeParams {
  wagmiConfig: Config;
  sourceChainId: SourceChainId;
  token: BridgeToken;
}

/**
 * Estimate the native fee (msg.value) required for a bridge deposit.
 * Calls getMinFees on the vault contract on the source chain.
 */
export async function estimateBridgeFee({
  wagmiConfig,
  sourceChainId,
  token,
}: EstimateBridgeFeeParams): Promise<bigint> {
  const config = getBridgeConfig(sourceChainId, token);
  if (!config) throw new Error(`No bridge config for ${token} on chain ${sourceChainId}`);

  const publicClient = getPublicClient(wagmiConfig, { chainId: sourceChainId });
  if (!publicClient) throw new Error(`No public client for chain ${sourceChainId}`);

  const fee = await publicClient.readContract({
    address: config.vault,
    abi: SOCKET_VAULT_ABI,
    functionName: "getMinFees",
    args: [config.connector, BRIDGE_MSG_GAS_LIMIT],
  });

  return fee;
}

export interface BridgeToDeriveParams {
  walletClient: WalletClient;
  wagmiConfig: Config;
  sourceChainId: SourceChainId;
  token: BridgeToken;
  /** Raw token amount (scaled to token decimals) */
  amount: bigint;
  /** Destination SCW address on Derive chain */
  scwAddress: `0x${string}`;
}

/**
 * Bridge tokens to Derive chain via Socket vault.
 * 1. Check and approve vault to spend token (if needed)
 * 2. Call depositToAppChain with native fee as msg.value
 * Returns the deposit transaction hash.
 */
export async function bridgeToDerive({
  walletClient,
  wagmiConfig,
  sourceChainId,
  token,
  amount,
  scwAddress,
}: BridgeToDeriveParams): Promise<Hex> {
  const config = getBridgeConfig(sourceChainId, token);
  if (!config) throw new Error(`No bridge config for ${token} on chain ${sourceChainId}`);

  const [account] = await walletClient.getAddresses();

  const { mainnet, optimism, arbitrum, base } = await import("wagmi/chains");
  const chainMap = { 1: mainnet, 10: optimism, 42161: arbitrum, 8453: base } as const;
  const chain = chainMap[sourceChainId];

  const publicClient = getPublicClient(wagmiConfig, { chainId: sourceChainId });
  if (!publicClient) throw new Error(`No public client for chain ${sourceChainId}`);

  // Check allowance and approve if needed
  const allowance = await publicClient.readContract({
    address: config.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, config.vault],
  });

  if (allowance < amount) {
    const approveTx = await walletClient.writeContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.vault, maxUint256],
      account,
      chain,
    });

    await waitForTransactionReceipt(wagmiConfig, { hash: approveTx, chainId: sourceChainId });
  }

  // Get bridge fee
  const fee = await publicClient.readContract({
    address: config.vault,
    abi: SOCKET_VAULT_ABI,
    functionName: "getMinFees",
    args: [config.connector, BRIDGE_MSG_GAS_LIMIT],
  });

  // Execute bridge deposit
  const txHash = await walletClient.writeContract({
    address: config.vault,
    abi: SOCKET_VAULT_ABI,
    functionName: "depositToAppChain",
    args: [scwAddress, amount, BRIDGE_MSG_GAS_LIMIT, config.connector],
    value: fee,
    account,
    chain,
  });

  return txHash;
}

export type BridgeMessageStatus = "PENDING" | "COMPLETED" | "UNKNOWN";

/**
 * Poll Socket API for bridge completion status.
 */
export async function getBridgeStatus(
  sourceChainId: SourceChainId,
  txHash: string,
): Promise<BridgeMessageStatus> {
  const url = `https://prod.dlapi.socket.tech/messages-from-tx?srcChainSlug=${sourceChainId}&srcTxHash=${txHash}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return "UNKNOWN";

    const data = await res.json();
    if (!data?.messages?.length) return "PENDING";

    const msg = data.messages[0];
    if (msg.status === "COMPLETED" || msg.executionStatus === "SUCCESS") {
      return "COMPLETED";
    }
    return "PENDING";
  } catch {
    return "UNKNOWN";
  }
}
