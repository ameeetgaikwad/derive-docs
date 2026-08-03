import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * RFQ encodings, verified against
 * protocol/lib/v2-matching/src/interfaces/IRfqModule.sol (same definitions as
 * services/shared/src/rfq.ts).
 *
 * Roles (per RfqModule.executeAction):
 *   actions[0] = MAKER — signs RfqOrder { maxFee, trades[] }
 *   actions[1] = TAKER — signs TakerOrder { orderHash, maxFee } where
 *                        orderHash = keccak256(abi.encode(makerOrder.trades))
 *
 * The frontend only signs the taker side; the maker action comes from the
 * rfq-engine's winning quote.
 */

export interface RfqTradeData {
  asset: Address;
  subId: bigint;
  /** Mark price for the asset traded, 18dp. Always positive (uint). */
  price: bigint;
  /** int256: positive = maker receives the asset, negative = maker delivers. */
  amount: bigint;
}

export interface TakerOrder {
  orderHash: Hex;
  maxFee: bigint;
}

const TRADE_DATA_COMPONENTS = [
  { name: "asset", type: "address" },
  { name: "subId", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "amount", type: "int256" },
] as const;

/**
 * keccak256(abi.encode(makerOrder.trades)) — must match RfqModule's
 * `takerOrder.orderHash != keccak256(abi.encode(makerOrder.trades))` check.
 * Used to re-derive and verify the engine-provided orderHash before signing.
 */
export function hashRfqTrades(trades: RfqTradeData[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "tuple[]", components: [...TRADE_DATA_COMPONENTS] }],
      [trades]
    )
  );
}

/** abi.encode(TakerOrder) — the taker action's `data`. */
export function encodeTakerOrder(order: TakerOrder): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "orderHash", type: "bytes32" },
          { name: "maxFee", type: "uint256" },
        ],
      },
    ],
    [order]
  );
}
