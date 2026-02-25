import { describe, it, expect } from "vitest";
import {
  getConfig,
  getAssetConfig,
  DERIVE_CONFIG,
  ACTION_TYPEHASH,
  USDC_DECIMALS,
  WBTC_DECIMALS,
  UNIT,
  MAX_UINT256,
} from "../constants";

describe("getConfig", () => {
  it("returns testnet config with chainId 901", () => {
    const config = getConfig("testnet");
    expect(config.chainId).toBe(901);
    expect(config.restUrl).toBe("https://api-demo.lyra.finance");
  });

  it("returns mainnet config with chainId 957", () => {
    const config = getConfig("mainnet");
    expect(config.chainId).toBe(957);
    expect(config.restUrl).toBe("https://api.lyra.finance");
  });

  it("falls back to env variable", () => {
    const original = process.env.NEXT_PUBLIC_DERIVE_ENV;
    process.env.NEXT_PUBLIC_DERIVE_ENV = "testnet";
    try {
      const config = getConfig();
      expect(config.chainId).toBe(901);
    } finally {
      process.env.NEXT_PUBLIC_DERIVE_ENV = original;
    }
  });

  it("defaults to mainnet when no env set", () => {
    const original = process.env.NEXT_PUBLIC_DERIVE_ENV;
    delete process.env.NEXT_PUBLIC_DERIVE_ENV;
    try {
      const config = getConfig();
      expect(config.chainId).toBe(957);
    } finally {
      if (original !== undefined) {
        process.env.NEXT_PUBLIC_DERIVE_ENV = original;
      }
    }
  });
});

describe("getAssetConfig", () => {
  it("returns USDC config with 6 decimals", () => {
    const config = getAssetConfig("USDC", "testnet");
    expect(config.assetName).toBe("USDC");
    expect(config.decimals).toBe(6);
    expect(config.tokenAddress).toBe(DERIVE_CONFIG.testnet.usdcAddress);
    expect(config.cashAsset).toBe(DERIVE_CONFIG.testnet.usdcCashAsset);
  });

  it("returns WBTC config with 8 decimals", () => {
    const config = getAssetConfig("WBTC", "testnet");
    expect(config.assetName).toBe("WBTC");
    expect(config.decimals).toBe(8);
    expect(config.tokenAddress).toBe(DERIVE_CONFIG.testnet.wbtcAddress);
    expect(config.cashAsset).toBe(DERIVE_CONFIG.testnet.wbtcCashAsset);
  });

  it("returns correct mainnet USDC addresses", () => {
    const config = getAssetConfig("USDC", "mainnet");
    expect(config.tokenAddress).toBe(DERIVE_CONFIG.mainnet.usdcAddress);
    expect(config.cashAsset).toBe(DERIVE_CONFIG.mainnet.usdcCashAsset);
  });

  it("returns correct mainnet WBTC addresses", () => {
    const config = getAssetConfig("WBTC", "mainnet");
    expect(config.tokenAddress).toBe(DERIVE_CONFIG.mainnet.wbtcAddress);
  });
});

describe("config address validity", () => {
  for (const env of ["testnet", "mainnet"] as const) {
    it(`${env} config has valid hex addresses`, () => {
      const config = DERIVE_CONFIG[env];
      const addressFields = [
        "tradeModule",
        "standardManager",
        "depositModule",
        "withdrawalModule",
        "withdrawWrapper",
        "usdcAddress",
        "usdcCashAsset",
        "matching",
        "subaccount",
        "lightAccountFactory",
        "entrypoint",
        "paymaster",
      ] as const;

      for (const field of addressFields) {
        const addr = config[field];
        expect(addr, `${env}.${field}`).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    });

    it(`${env} domain separator is valid 32-byte hex`, () => {
      const config = DERIVE_CONFIG[env];
      expect(config.domainSeparator).toMatch(/^0x[0-9a-fA-F]{64}$/);
    });
  }
});

describe("constants values", () => {
  it("ACTION_TYPEHASH is correct", () => {
    expect(ACTION_TYPEHASH).toBe(
      "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17"
    );
  });

  it("USDC_DECIMALS is 6", () => {
    expect(USDC_DECIMALS).toBe(6);
  });

  it("WBTC_DECIMALS is 8", () => {
    expect(WBTC_DECIMALS).toBe(8);
  });

  it("UNIT is 10^18", () => {
    expect(UNIT).toBe(10n ** 18n);
  });

  it("MAX_UINT256 is 2^256 - 1", () => {
    expect(MAX_UINT256).toBe(2n ** 256n - 1n);
  });
});
