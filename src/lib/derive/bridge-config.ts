/**
 * Socket bridge configuration for bridging tokens to Derive Chain.
 * Addresses sourced from SocketDotTech/socket-plugs prod_lyra_addresses.json
 */

export type BridgeToken = "USDC" | "WETH" | "WBTC" | "CBBTC";

export type SourceChainId = 1 | 10 | 42161 | 8453;

export interface BridgeTokenConfig {
  token: `0x${string}`;
  vault: `0x${string}`;
  connector: `0x${string}`;
  decimals: number;
}

export interface SourceChain {
  id: SourceChainId;
  name: string;
}

const SOURCE_CHAINS: SourceChain[] = [
  { id: 1, name: "Ethereum" },
  { id: 42161, name: "Arbitrum" },
  { id: 8453, name: "Base" },
  { id: 10, name: "Optimism" },
];

/**
 * Bridge registry: sourceChainId → token → config
 * Vault = contract on source chain where depositToAppChain is called
 * Connector = FAST connector address passed as parameter
 */
const BRIDGE_REGISTRY: Record<SourceChainId, Partial<Record<BridgeToken, BridgeTokenConfig>>> = {
  // Ethereum Mainnet
  1: {
    USDC: {
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      vault: "0x6D303CEE7959f814042D31E0624fB88Ec6fbcC1d",
      connector: "0x200AF8FCdD5246D70B369A98143Ac8930A077B7A",
      decimals: 6,
    },
    WETH: {
      token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      vault: "0xD4efe33C66B8CdE33B8896a2126E41e5dB571b7e",
      connector: "0xCf814e58f1649F94d37E51f730D6bF72409fA09c",
      decimals: 18,
    },
    WBTC: {
      token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      vault: "0x3Eec7c855aF33280F1eD38b93059F5aa5862E3ab",
      connector: "0xA621Bc5A9d13D39eb098865B723CEee71BB5C181",
      decimals: 8,
    },
  },
  // Optimism
  10: {
    USDC: {
      token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
      vault: "0xDEf0bfBdf7530C75AB3C73f8d2F64d9eaA7aA98e",
      connector: "0xfd76d8b79C2E2c86EA0814e92D5cA0e4E8096c13",
      decimals: 6,
    },
    WETH: {
      token: "0x4200000000000000000000000000000000000006",
      vault: "0xdD4c717a69763176d8B7A687728e228597eAB86d",
      connector: "0x27f4B23944e2bb59b1E276aff22FD2Be45658F64",
      decimals: 18,
    },
    WBTC: {
      token: "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
      vault: "0xE5967877065f111a556850d8f05b8DaD88edCEc9",
      connector: "0x906A44Daa8bdA5599a384264e3811b9BeA1109b4",
      decimals: 8,
    },
  },
  // Arbitrum
  42161: {
    USDC: {
      token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      vault: "0x5e027ad442e031424b5a2C0ad6f656662Be32882",
      connector: "0x17Fc4c7ea8267044b6D0ACC17a6C049Bed6F8B21",
      decimals: 6,
    },
    WETH: {
      token: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      vault: "0x8e9f58E6c206CB9C98aBb9F235E0f02D65dFc922",
      connector: "0x3809150509df79D96334c4EB6Ba1c386827C3c67",
      decimals: 18,
    },
    WBTC: {
      token: "0x2f2a2543B76A4166549F7aaB2e75Bef0aeFc5B0f",
      vault: "0x3D20c6A2b719129af175E0ff7B1875DEb360896f",
      connector: "0x42c846313c37845B9d67BB5c1F4F48E528234Afc",
      decimals: 8,
    },
  },
  // Base
  8453: {
    USDC: {
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      vault: "0x4e798659b9846F1da7B6D6B5d09d581270aB6FEC",
      connector: "0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b",
      decimals: 6,
    },
    WETH: {
      token: "0x4200000000000000000000000000000000000006",
      vault: "0xBd282333710B9C7e33E8a37d027885A7C079Ae23",
      connector: "0xbE9DBda519e15a1c0d238cEa0b3daD47a484A6Ff",
      decimals: 18,
    },
    CBBTC: {
      token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      vault: "0x76624ff43D610F64177Bb9c194A2503642e9B803",
      connector: "0x457379de638CAFeB1759a22457fe893b288E2e89",
      decimals: 8,
    },
  },
};

export function getBridgeConfig(
  sourceChainId: SourceChainId,
  token: BridgeToken,
): BridgeTokenConfig | null {
  return BRIDGE_REGISTRY[sourceChainId]?.[token] ?? null;
}

export function getSupportedTokens(sourceChainId: SourceChainId): BridgeToken[] {
  const chain = BRIDGE_REGISTRY[sourceChainId];
  if (!chain) return [];
  return Object.keys(chain) as BridgeToken[];
}

export function getSupportedChains(): SourceChain[] {
  return SOURCE_CHAINS;
}

/** Standard gas limit for Socket bridge messages */
export const BRIDGE_MSG_GAS_LIMIT = 200_000n;
