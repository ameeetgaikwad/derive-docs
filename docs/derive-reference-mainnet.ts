import {
  Abi, Chain, concat, createPublicClient, createWalletClient, custom,
  defineChain, encodeAbiParameters, encodeFunctionData, formatUnits,
  http, isHex, parseAbi, toHex, Transport, zeroAddress,
} from 'viem';
import {
  ClientMiddlewareFn, createBundlerClient, createSmartAccountClientFromExisting,
  deepHexlify, defaultFeeEstimator, getEntryPoint, PromiseOrValue,
  resolveProperties, SmartAccountSigner, UserOperationStruct_v6,
  WalletClientSigner, BigNumberish
} from '@alchemy/aa-core';
import { createLightAccount, LightAccount } from '@alchemy/aa-accounts';
import { privateKeyToAccount } from 'viem/accounts';

//////////////
// Settings //
//////////////

const pk = `0xaa4b0d438e2edd73b27d28f4372444ba4002f7ccf5ec3c027efd196cc46d36ba`
const addr = "0xd4183ab2835c7e87af711a92eecd8a676db5e188";
const API_KEY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

///////////////
// Constants //
///////////////

const MAINNET_BUNDLER_URL = `https://bundler-lyra-mainnet-0.t.conduit.xyz`
const MAINNET_RPC_URL = 'https://rpc.derive.xyz'
const MAINNET_BLOCK_EXPLORER_URL = 'https://explorer.derive.xyz'

const mainnetChain: Chain = defineChain({
  id: 957,
  name: 'Derive',
  network: 'derive',
  nativeCurrency: { decimals: 18, name: 'Ethers', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [MAINNET_RPC_URL], webSocket: [MAINNET_RPC_URL.replace('http', 'ws')] },
    public: { http: [MAINNET_RPC_URL], webSocket: [MAINNET_RPC_URL.replace('http', 'ws')] },
  },
  blockExplorers: { default: { name: 'Blockscout', url: MAINNET_BLOCK_EXPLORER_URL } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  testnet: false,
})

const PARAMS = {
  RPC: MAINNET_RPC_URL,
  bundler: MAINNET_BUNDLER_URL,
  DepositModule: '0x9B3FE5E5a3bcEa5df4E08c41Ce89C4e3Ff01Ace3',
  USDC: '0x6879287835A86F50f784313dBEd5E5cCC5bb8481',
  paymaster: '0xa179c3b32d3eE58353d3F277b32D1e03DD33fFCA',
  entrypoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  accountFactory: '0x000000893A26168158fbeaDD9335Be5bC96592E2',
  chain: mainnetChain,
};

const bundlerRpcMethods = new Set([
  'eth_estimateUserOperationGas',
  'eth_sendUserOperation',
  'eth_getUserOperationByHash',
  'eth_getUserOperationReceipt',
  'eth_supportedEntryPoints',
])

const client = createPublicClient({
  chain: PARAMS.chain,
  transport: http(PARAMS.RPC),
});

async function callWeb3(
  to: string, method: string, params: any[], types: string[]
): Promise<any> {
  const abi = parseAbi([`function ${method} external view returns (${types.join(',')})` as string]) as Abi
  return await client.readContract({
    address: to as `0x${string}`,
    abi,
    functionName: method.split('(')[0] as string,
    args: params,
  })
}

function getCalldata(signature: string, args: unknown[]) {
  const abi = parseAbi([`function ${signature}` as string]) as Abi
  const fnName = signature.split('(')[0]
  return encodeFunctionData({ abi, functionName: fnName, args })
}
