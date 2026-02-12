export type DeriveEnv = "testnet" | "mainnet";

interface DeriveConfig {
  chainId: number;
  restUrl: string;
  wsUrl: string;
  rpcUrl: string;
  tradeModule: `0x${string}`;
  standardManager: `0x${string}`;
  srmSubaccountCreator: `0x${string}`;
  depositModule: `0x${string}`;
  withdrawalModule: `0x${string}`;
  usdcAddress: `0x${string}`;
  matching: `0x${string}`;
  subaccount: `0x${string}`;
  domainSeparator: `0x${string}`;
  lightAccountFactory: `0x${string}`;
}

export const DERIVE_CONFIG: Record<DeriveEnv, DeriveConfig> = {
  testnet: {
    chainId: 901,
    restUrl: "https://api-demo.lyra.finance",
    wsUrl: "wss://api-demo.lyra.finance/ws",
    rpcUrl: "https://rpc-prod-testnet-0eakp60405.t.conduit.xyz",
    tradeModule: "0x87F2863866D85E3192a35A73b388BD625D83f2be",
    standardManager: "0x28bE681F7bEa6f465cbcA1D25A2125fe7533391C",
    srmSubaccountCreator: "0xEFC0F82f49FaaDDC8838c4640850b8dEe3b961b7",
    depositModule: "0x43223Db33AdA0575D2E100829543f8B04A37a1ec",
    withdrawalModule: "0xe850641C5207dc5E9423fB15f89ae6031A05fd92",
    usdcAddress: "0xe80F2a02398BBf1ab2C9cc52caD1978159c215BD",
    matching: "0x3cc154e220c2197c5337b7Bd13363DD127Bc0C6E",
    subaccount: "0xb9ed1cc0c50bca7a391a6819e9cAb466f5501d73",
    domainSeparator: "0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105",
    lightAccountFactory: "0x000000893a26168158fbeadd9335be5bc96592e2",
  },
  mainnet: {
    chainId: 957,
    restUrl: "https://api.lyra.finance",
    wsUrl: "wss://api.lyra.finance/ws",
    rpcUrl: "https://rpc.derive.xyz",
    tradeModule: "0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b",
    standardManager: "0x28c9ddF9A3B29c2E6a561c1BC520954e5A33de5D",
    srmSubaccountCreator: "0x6AeeF401e07F8a1b2949fe7620Af219b9258d149",
    depositModule: "0x9B3FE5E5a3bcEa5df4E08c41Ce89C4e3Ff01Ace3",
    withdrawalModule: "0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083",
    usdcAddress: "0x6879287835A86F50f784313dBEd5E5cCC5bb8481",
    matching: "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD",
    subaccount: "0xE7603DF191D699d8BD9891b821347dbAb889E5a5",
    domainSeparator: "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b",
    lightAccountFactory: "0x000000893a26168158fbeadd9335be5bc96592e2",
  },
};

// EIP-712 type hash for Derive actions
// keccak256("Action(uint256 subaccountId,uint256 nonce,uint256 module,bytes data,uint256 expiry,address owner,address signer)")
export const ACTION_TYPEHASH =
  "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17" as `0x${string}`;

// Trade module action type
export const TRADE_ACTION_TYPE = 0;
// Session key registration action type
export const SESSION_KEY_ACTION_TYPE = 1;

// Max uint256 for max expiry
export const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// 18-decimal scale factor
export const UNIT = BigInt("1000000000000000000"); // 10^18

export function getConfig(env?: DeriveEnv): DeriveConfig {
  const e = env ?? ((process.env.NEXT_PUBLIC_DERIVE_ENV as DeriveEnv) || "mainnet");
  return DERIVE_CONFIG[e];
}
