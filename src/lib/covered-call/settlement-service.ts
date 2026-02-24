import { DeriveRestClient } from "@/lib/derive/client";
import {
  signAction,
  encodeTradeData,
  toTokenAmount,
  generateNonce,
  getSignatureExpiry,
} from "@/lib/derive/signing";
import { getConfig, getAssetConfig } from "@/lib/derive/constants";
import type { Hex } from "viem";

interface SettlementResult {
  subaccountId: number;
  outcome: "otm" | "itm" | "not_settled";
  usdcDeficit?: number;
  btcSold?: string;
  btcRemaining?: string;
}

/**
 * Check and process settlement for a single covered call position.
 */
export async function processSettlement(params: {
  restClient: DeriveRestClient;
  subaccountId: number;
  instrumentName: string;
  backendSessionKey: Hex;
  deriveWallet: Hex;
}): Promise<SettlementResult> {
  const { restClient, subaccountId, instrumentName, backendSessionKey, deriveWallet } = params;

  // 1. Check if option still exists in positions
  const positions = await restClient.getPositions(subaccountId);
  const optionPosition = positions.find(p => p.instrument_name === instrumentName);

  if (optionPosition) {
    return { subaccountId, outcome: "not_settled" };
  }

  // 2. Option has settled — check collaterals
  const collaterals = await restClient.getCollaterals(subaccountId);
  const usdcCollateral = collaterals.find(c => c.asset_name === "USDC");
  const btcCollateral = collaterals.find(c => c.asset_name === "WBTC");

  const usdcBalance = usdcCollateral ? parseFloat(usdcCollateral.amount) : 0;
  const btcBalance = btcCollateral ? parseFloat(btcCollateral.amount) : 0;

  // 3. OTM — no deficit
  if (usdcBalance >= 0) {
    return { subaccountId, outcome: "otm", btcRemaining: btcBalance.toString() };
  }

  // 4. ITM — need to auto-sell BTC to cover deficit
  const usdcDeficit = Math.abs(usdcBalance);
  const btcPrice = btcCollateral ? parseFloat(btcCollateral.mark_price) : 0;

  if (btcPrice <= 0) {
    console.error(`[Settlement] Cannot determine BTC price for subaccount ${subaccountId}`);
    return { subaccountId, outcome: "itm", usdcDeficit };
  }

  // Calculate BTC to sell (add 0.5% buffer for slippage)
  const btcToSell = (usdcDeficit / btcPrice) * 1.005;
  const btcToSellCapped = Math.min(btcToSell, btcBalance);

  // 5. Place spot market sell order
  const config = getConfig();
  const nonce = generateNonce();
  const signatureExpiry = getSignatureExpiry();

  // Encode trade data for selling BTC-USDC spot
  const tradeData = encodeTradeData({
    assetAddress: config.wbtcCashAsset ?? ("0x0000000000000000000000000000000000000000" as Hex),
    subId: 0n,
    limitPrice: 1n, // Market sell — use very low limit price
    amount: toTokenAmount(btcToSellCapped.toFixed(8), 18), // 18 decimals for Derive amounts
    maxFee: toTokenAmount("100", 18), // Max fee $100
    subaccountId: BigInt(subaccountId),
    isBid: false, // sell
  });

  const signature = await signAction({
    subaccountId: BigInt(subaccountId),
    nonce: BigInt(nonce),
    module: config.tradeModule,
    data: tradeData,
    expiry: BigInt(signatureExpiry),
    owner: deriveWallet,
    sessionPrivateKey: backendSessionKey,
  });

  try {
    await restClient.submitOrder({
      instrument_name: "BTC-USDC",
      direction: "sell",
      order_type: "market",
      amount: btcToSellCapped.toFixed(8),
      time_in_force: "ioc",
      subaccount_id: subaccountId,
      nonce,
      signature_expiry_sec: signatureExpiry,
      signer: "", // Will be derived from signature
      signature: signature.startsWith("0x") ? signature.slice(2) : signature,
      max_fee: "100",
    });

    const btcRemaining = btcBalance - btcToSellCapped;

    return {
      subaccountId,
      outcome: "itm",
      usdcDeficit,
      btcSold: btcToSellCapped.toFixed(8),
      btcRemaining: btcRemaining.toFixed(8),
    };
  } catch (error) {
    console.error(`[Settlement] Auto-sell failed for subaccount ${subaccountId}:`, error);
    return { subaccountId, outcome: "itm", usdcDeficit };
  }
}
