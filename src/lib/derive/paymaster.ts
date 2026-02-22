import {
  type Chain,
  concat,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  http,
  isHex,
  toHex,
  zeroAddress,
} from "viem";
import type { WalletClient } from "viem";
import {
  createBundlerClient,
  createSmartAccountClientFromExisting,
  deepHexlify,
  defaultFeeEstimator,
  getEntryPoint,
  resolveProperties,
  WalletClientSigner,
  type ClientMiddlewareFn,
  type SmartAccountSigner,
  type UserOperationStruct_v6,
} from "@alchemy/aa-core";
import { createLightAccount, type LightAccount } from "@alchemy/aa-accounts";
import { getConfig, type DeriveEnv } from "./constants";
import type { ScwAction } from "./scw-actions";

// Bundler RPC methods that should be routed to the bundler endpoint
const BUNDLER_RPC_METHODS = new Set([
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "eth_supportedEntryPoints",
]);

function getDeriveChain(env?: DeriveEnv): Chain {
  const config = getConfig(env);
  const isTestnet = config.chainId === 901;
  return defineChain({
    id: config.chainId,
    name: "Derive",
    network: "derive",
    nativeCurrency: { decimals: 18, name: "Ethers", symbol: "ETH" },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
      public: { http: [config.rpcUrl] },
    },
    contracts: {
      multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    },
    testnet: isTestnet,
  });
}

function toHexOrString(input: unknown): `0x${string}` {
  if (isHex(input)) return input;
  return toHex(input as bigint);
}

/**
 * Build and send a paymaster-sponsored UserOperation for a bundle of SCW actions.
 *
 * This uses the Alchemy Light Account abstraction to:
 * 1. Build a UserOperation from the action bundle
 * 2. Get paymaster sponsorship via our /api/paymaster proxy
 * 3. Have the user sign the UserOp (1 wallet popup)
 * 4. Submit via the bundler
 *
 * @param walletClient - Browser wallet client from wagmi
 * @param actions - Array of SCW actions (target, value, data)
 * @returns Transaction hash of the mined UserOperation
 */
export async function sendSponsoredUserOp(
  walletClient: WalletClient,
  actions: ScwAction[],
): Promise<`0x${string}`> {
  const config = getConfig();
  const chain = getDeriveChain();

  const nodeTransport = http(config.rpcUrl);
  const bundlerTransport = http(config.bundlerUrl);

  // Route bundler-specific RPC methods to the bundler, everything else to the node
  const combinedTransport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (BUNDLER_RPC_METHODS.has(method)) {
        return bundlerTransport({ chain }).request({ method, params } as any);
      }
      return nodeTransport({ chain }).request({ method, params } as any);
    },
  });

  const bundlerClient = createBundlerClient({
    chain,
    transport: combinedTransport,
    cacheTime: 1000,
  });

  const feeEstimator: ClientMiddlewareFn = async (uo, options) => {
    return await defaultFeeEstimator(bundlerClient)(uo, options);
  };

  // Create signer from browser wallet
  const signer = new WalletClientSigner(walletClient as any, "wallet");

  const deriveEntrypoint = getEntryPoint(chain, {
    version: "0.6.0",
    addressOverride: config.entrypoint,
  });

  // Create Light Account instance (this resolves the SCW address deterministically)
  const account = await createLightAccount({
    transport: combinedTransport,
    chain,
    signer: signer as SmartAccountSigner,
    entryPoint: deriveEntrypoint,
    factoryAddress: config.lightAccountFactory,
    version: "v1.1.0",
  });

  const isTestnet = config.chainId === 901;

  // Custom middleware: nonce + testnet gas bump
  const customMiddleware: ClientMiddlewareFn = async (uo) => ({
    ...uo,
    nonce: await account.getNonce(),
    ...(isTestnet && {
      preVerificationGas:
        BigInt((await uo.preVerificationGas)?.toString() ?? 0) * 2n,
    }),
  });

  // Dummy paymaster data for gas estimation
  const dummyPaymasterAndData = (): `0x${string}` => {
    const validUntil = BigInt(Math.floor(Date.now() / 1000 + 120));
    const validAfter = 0n;
    const encodedData = encodeAbiParameters(
      [
        { type: "uint64", name: "validUntil" },
        { type: "uint64", name: "validAfter" },
        { type: "address", name: "erc20" },
        { type: "uint64", name: "fee" },
      ],
      [validUntil, validAfter, zeroAddress, 0n],
    );
    return concat([
      config.paymaster,
      encodedData,
      "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb1c",
    ]) as `0x${string}`;
  };

  // Paymaster middleware: proxied through local tunnel
  const deriveProxy = process.env.NEXT_PUBLIC_DERIVE_PROXY || "";
  const paymasterMiddleware: ClientMiddlewareFn = async (uo) => {
    const res = await fetch(`${deriveProxy}/api/public/paymaster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userOp: {
          callData: await uo.callData,
          sender: await uo.sender,
          nonce: toHex((await uo.nonce) as bigint),
          initCode: "initCode" in uo ? await uo.initCode : undefined,
          callGasLimit: toHexOrString(uo.callGasLimit),
          verificationGasLimit: toHexOrString(uo.verificationGasLimit),
          preVerificationGas: toHexOrString(uo.preVerificationGas),
          maxFeePerGas: toHexOrString(uo.maxFeePerGas),
          maxPriorityFeePerGas: toHexOrString(uo.maxPriorityFeePerGas),
          paymasterAndData:
            "paymasterAndData" in uo ? await uo.paymasterAndData : undefined,
          signature: await uo.signature,
        },
      }),
    });

    if (!res.ok) {
      throw new Error("Paymaster request failed: " + (await res.text()));
    }

    const { paymasterAndData }: { paymasterAndData: `0x${string}` } =
      await res.json();
    return { ...uo, paymasterAndData };
  };

  // Create smart account client with paymaster
  const scwClient = createSmartAccountClientFromExisting({
    client: bundlerClient,
    account,
    paymasterAndData: {
      dummyPaymasterAndData,
      paymasterAndData: paymasterMiddleware,
    },
    customMiddleware,
    feeEstimator,
  });

  // Build the UserOperation from the action bundle
  const uoData = actions.map((a) => ({
    target: a.target,
    value: a.value,
    data: a.data,
  }));

  const uoStruct = (await scwClient.buildUserOperation({
    ...account,
    uo: uoData,
  })) as UserOperationStruct_v6;

  const resolvedStruct =
    await resolveProperties<UserOperationStruct_v6>(uoStruct);

  console.log("[Paymaster] UserOp built, requesting signature...");

  // Sign the UserOperation (1 wallet popup)
  const signedRequest = await scwClient.signUserOperation({ uoStruct });

  console.log("[Paymaster] Signed, submitting to bundler...");

  // Submit to bundler
  const uoHash = await scwClient.sendRawUserOperation(
    signedRequest,
    config.entrypoint,
  );

  console.log("[Paymaster] UserOp hash:", uoHash);

  // Wait for the transaction to be mined
  const txHash = await scwClient.waitForUserOperationTransaction({
    hash: uoHash,
  });

  console.log("[Paymaster] Transaction mined:", txHash);

  // Verify success
  const receipt = await scwClient.getUserOperationReceipt(uoHash);
  if (!receipt || !receipt.success) {
    throw new Error(`UserOperation failed: ${txHash}`);
  }

  return txHash;
}
