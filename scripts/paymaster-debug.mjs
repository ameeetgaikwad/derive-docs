import {
  concat,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isHex,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
import {
  createBundlerClient,
  createSmartAccountClientFromExisting,
  defaultFeeEstimator,
  getEntryPoint,
  WalletClientSigner,
} from "@alchemy/aa-core";
import { createLightAccount } from "@alchemy/aa-accounts";
import { privateKeyToAccount } from "viem/accounts";

const isMainnet = process.env.DERIVE_ENV !== "testnet";

const MAINNET_RPC_URL = "https://rpc.derive.xyz";
const TESTNET_RPC_URL = "https://rpc-prod-testnet-0eakp60405.t.conduit.xyz";
const MAINNET_BUNDLER_URL = "https://bundler-lyra-mainnet-0.t.conduit.xyz";
const TESTNET_BUNDLER_URL = "https://bundler-prod-testnet-0eakp60405.t.conduit.xyz";

const chain = defineChain({
  id: isMainnet ? 957 : 901,
  name: "Derive",
  network: "derive",
  nativeCurrency: { decimals: 18, name: "Ethers", symbol: "ETH" },
  rpcUrls: {
    default: { http: [isMainnet ? MAINNET_RPC_URL : TESTNET_RPC_URL] },
    public: { http: [isMainnet ? MAINNET_RPC_URL : TESTNET_RPC_URL] },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: !isMainnet,
});

const config = isMainnet
  ? {
      rpc: MAINNET_RPC_URL,
      bundler: MAINNET_BUNDLER_URL,
      entrypoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      accountFactory: "0x000000893A26168158fbeaDD9335Be5bC96592E2",
      paymaster: "0xa179c3b32d3eE58353d3F277b32D1e03DD33fFCA",
      usdc: "0x6879287835A86F50f784313dBEd5E5cCC5bb8481",
      depositModule: "0x9B3FE5E5a3bcEa5df4E08c41Ce89C4e3Ff01Ace3",
      paymasterUrl:
        process.env.PAYMASTER_URL ??
        "https://pro.derive.xyz/api/public/paymaster",
    }
  : {
      rpc: TESTNET_RPC_URL,
      bundler: TESTNET_BUNDLER_URL,
      entrypoint: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
      accountFactory: "0x000000893A26168158fbeaDD9335Be5bC96592E2",
      paymaster: "0x5a6499b442711feeA0Aa73C6574042EC5E2e5945",
      usdc: "0xe80F2a02398BBf1ab2C9cc52caD1978159c215BD",
      depositModule: "0x43223Db33AdA0575D2E100829543f8B04A37a1ec",
      paymasterUrl:
        process.env.PAYMASTER_URL ??
        "https://testnet.derive.xyz/api/public/paymaster",
    };

const eoaPk = process.env.PK;
if (!eoaPk) {
  throw new Error("Missing PK env var");
}
const apiKey = process.env.DERIVE_API_KEY;
if (!apiKey) {
  throw new Error("Missing DERIVE_API_KEY env var");
}

const bundlerRpcMethods = new Set([
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "eth_supportedEntryPoints",
]);

const toHexOrString = (input) => (isHex(input) ? input : toHex(input));

const nodeTransport = http(config.rpc);
const bundlerTransport = http(config.bundler);
const combinedTransport = custom({
  async request({ method, params }) {
    if (bundlerRpcMethods.has(method)) {
      return bundlerTransport({ chain }).request({ method, params });
    }
    return nodeTransport({ chain }).request({ method, params });
  },
});

const bundlerClient = createBundlerClient({
  chain,
  transport: combinedTransport,
  cacheTime: 1000,
});

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpc),
});

const eoa = privateKeyToAccount(eoaPk);
console.log("EOA:", eoa.address);

const signerClient = createWalletClient({
  account: eoa,
  chain,
  transport: combinedTransport,
});
const signer = new WalletClientSigner(signerClient, signerClient.type);
const entryPoint = getEntryPoint(chain, {
  version: "0.6.0",
  addressOverride: config.entrypoint,
});

const account = await createLightAccount({
  transport: combinedTransport,
  chain,
  signer,
  entryPoint,
  factoryAddress: config.accountFactory,
  version: "v1.1.0",
});

const scw = account.address ?? (await account.getAccountAddress?.()) ?? null;
if (!scw) {
  throw new Error("Could not determine SCW address from light account");
}
console.log("SCW:", scw);

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const balance = await publicClient.readContract({
  address: config.usdc,
  abi: erc20Abi,
  functionName: "balanceOf",
  args: [scw],
});
console.log("USDC balance:", balance.toString());

const approveBytes = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [config.depositModule, balance],
});

const dummyPaymasterAndData = () => {
  const validUntil = BigInt(Math.floor(Date.now() / 1000 + 120));
  const validAfter = 0n;
  const encodedPaymasterData = encodeAbiParameters(
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
    encodedPaymasterData,
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb1c",
  ]);
};

const paymasterMiddleware = async (uo) => {
  const payload = {
    userOp: {
      callData: await uo.callData,
      sender: await uo.sender,
      nonce: toHex((await uo.nonce) ?? 0n),
      initCode: "initCode" in uo ? await uo.initCode : undefined,
      callGasLimit: toHexOrString(await uo.callGasLimit),
      verificationGasLimit: toHexOrString(await uo.verificationGasLimit),
      preVerificationGas: toHexOrString(await uo.preVerificationGas),
      maxFeePerGas: toHexOrString(await uo.maxFeePerGas),
      maxPriorityFeePerGas: toHexOrString(await uo.maxPriorityFeePerGas),
      paymasterAndData:
        "paymasterAndData" in uo ? await uo.paymasterAndData : undefined,
      signature: await uo.signature,
    },
  };

  const res = await fetch(config.paymasterUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await res.text();
  const ct = res.headers.get("content-type");
  console.log("Paymaster status:", res.status, "content-type:", ct);
  console.log("Paymaster snippet:", text.slice(0, 180).replace(/\s+/g, " "));

  if (!res.ok) {
    throw new Error(`paymaster failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text);
  return { ...uo, paymasterAndData: json.paymasterAndData };
};

const feeEstimator = async (uo, options) =>
  defaultFeeEstimator(bundlerClient)(uo, options);

const customMiddleware = async (uo) => ({
  ...uo,
  nonce: await account.getNonce(),
  ...(!isMainnet && {
    preVerificationGas: BigInt((await uo.preVerificationGas)?.toString() ?? 0) * 2n,
  }),
});

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

console.log("Building userOp...");
const uoStruct = await scwClient.buildUserOperation({
  ...account,
  uo: [{ target: config.usdc, value: 0n, data: approveBytes }],
});
console.log("Built userOp with paymasterAndData length:", uoStruct.paymasterAndData?.length);
console.log("Not sending transaction in debug mode.");
