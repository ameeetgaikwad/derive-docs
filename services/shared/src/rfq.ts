import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { buildAction, type Action } from "./actions.js";

/**
 * RFQ encodings, verified against
 * protocol/lib/v2-matching/src/interfaces/IRfqModule.sol and RfqModule.sol.
 *
 * Roles (per RfqModule.executeAction):
 *   actions[0] = MAKER  — signs RfqOrder { maxFee, trades[] }; receives every
 *                         `trades[i].amount` and pays `price * amount` cash.
 *   actions[1] = TAKER  — signs TakerOrder { orderHash, maxFee } where
 *                         orderHash = keccak256(abi.encode(makerOrder.trades)).
 *
 * For our covered call: the maker (market maker) BUYS the call, so the trade
 * amount is positive (+1 option to maker) and cash flows maker -> taker
 * (premium to the seller).
 */

export interface RfqTradeData {
  asset: Address;
  subId: bigint;
  /** Mark price for the asset traded, 18dp. Always positive (uint). */
  price: bigint;
  /** int256: positive = maker receives the asset, negative = maker delivers. */
  amount: bigint;
}

export interface RfqOrder {
  maxFee: bigint;
  trades: RfqTradeData[];
}

export interface TakerOrder {
  orderHash: Hex;
  maxFee: bigint;
}

export interface RfqFillData {
  makerAccount: bigint;
  makerFee: bigint;
  takerAccount: bigint;
  takerFee: bigint;
  managerData: Hex;
}

const TRADE_DATA_COMPONENTS = [
  { name: "asset", type: "address" },
  { name: "subId", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "amount", type: "int256" },
] as const;

/** abi.encode(RfqOrder) — the maker action's `data`. */
export function encodeRfqOrder(order: RfqOrder): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "maxFee", type: "uint256" },
          { name: "trades", type: "tuple[]", components: [...TRADE_DATA_COMPONENTS] },
        ],
      },
    ],
    [order],
  );
}

/**
 * keccak256(abi.encode(makerOrder.trades)) — must match RfqModule's
 * `takerOrder.orderHash != keccak256(abi.encode(makerOrder.trades))` check.
 */
export function hashRfqTrades(trades: RfqTradeData[]): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "tuple[]", components: [...TRADE_DATA_COMPONENTS] }],
      [trades],
    ),
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
    [order],
  );
}

/** abi.encode(FillData) — executor-supplied actionData for verifyAndMatch. */
export function encodeRfqFillData(fill: RfqFillData): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "makerAccount", type: "uint256" },
          { name: "makerFee", type: "uint256" },
          { name: "takerAccount", type: "uint256" },
          { name: "takerFee", type: "uint256" },
          { name: "managerData", type: "bytes" },
        ],
      },
    ],
    [fill],
  );
}

/**
 * Build the maker+taker Action pair for RfqModule, in the exact order the
 * module expects: [makerAction, takerAction]. Both must be signed and passed
 * to Matching.verifyAndMatch alongside encodeRfqFillData(...).
 */
export function buildRfqActionPair(params: {
  rfqModule: Address;
  trades: RfqTradeData[];
  maker: {
    subaccountId: bigint;
    owner: Address;
    signer?: Address;
    maxFee?: bigint;
    nonce?: bigint;
    expiry?: bigint;
  };
  taker: {
    subaccountId: bigint;
    owner: Address;
    signer?: Address;
    maxFee?: bigint;
    nonce?: bigint;
    expiry?: bigint;
  };
}): {
  makerAction: Action;
  takerAction: Action;
  makerOrder: RfqOrder;
  takerOrder: TakerOrder;
  orderHash: Hex;
} {
  const makerOrder: RfqOrder = {
    maxFee: params.maker.maxFee ?? 0n,
    trades: params.trades,
  };
  const orderHash = hashRfqTrades(params.trades);
  const takerOrder: TakerOrder = {
    orderHash,
    maxFee: params.taker.maxFee ?? 0n,
  };

  const makerAction = buildAction({
    subaccountId: params.maker.subaccountId,
    module: params.rfqModule,
    data: encodeRfqOrder(makerOrder),
    owner: params.maker.owner,
    signer: params.maker.signer,
    nonce: params.maker.nonce,
    expiry: params.maker.expiry,
  });

  const takerAction = buildAction({
    subaccountId: params.taker.subaccountId,
    module: params.rfqModule,
    data: encodeTakerOrder(takerOrder),
    owner: params.taker.owner,
    signer: params.taker.signer,
    nonce: params.taker.nonce,
    expiry: params.taker.expiry,
  });

  return { makerAction, takerAction, makerOrder, takerOrder, orderHash };
}
