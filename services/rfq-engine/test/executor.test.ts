import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbiItem,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  buildAction,
  encodeRfqOrder,
  encodeTakerOrder,
  hashRfqTrades,
  matchingAbi,
  signAction,
  toUnit,
  type Action,
  type RfqTradeData,
} from "@hedge/shared";
import { buildRfqExecution } from "../src/executor.js";
import type { Quote, Rfq } from "../src/types.js";

/**
 * Fixture derived from protocol/lib/v2-matching source at the pin:
 *
 *  - Matching.sol:    verifyAndMatch(Action[] actions, bytes[] signatures, bytes actionData)
 *  - RfqModule.sol:   actions[0] = maker RfqOrder, actions[1] = taker TakerOrder,
 *                     actionData = abi.encode(FillData), and
 *                     takerOrder.orderHash == keccak256(abi.encode(makerOrder.trades))
 *  - IRfqModule.sol:  RfqOrder { uint maxFee; TradeData[] trades }
 *                     TradeData { address asset; uint subId; uint price; int amount }
 *                     TakerOrder { bytes32 orderHash; uint maxFee }
 *                     FillData { uint makerAccount; uint makerFee; uint takerAccount;
 *                                uint takerFee; bytes managerData }
 *
 * All expected encodings below are re-derived with raw viem ABI primitives —
 * independently of the shared helpers under test.
 */

const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const RFQ_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OPTION_ASSET = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;

const maker = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // anvil #1
);
const taker = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // anvil #3
);

const MAKER_SUBACC = 11n;
const TAKER_SUBACC = 33n;
const EXPIRY = 1800000000n; // fits uint32
const STRIKE = toUnit("110000");
const SUB_ID = EXPIRY | ((STRIKE / 10_000_000_000n) << 32n) | (1n << 95n); // OptionEncoding, call
const AMOUNT = toUnit("1");
const PREMIUM = toUnit("1500");

const TRADES: RfqTradeData[] = [
  { asset: OPTION_ASSET, subId: SUB_ID, price: PREMIUM, amount: AMOUNT },
];

// Fixed nonces/expiries so the whole submission is deterministic (RFC6979 sigs)
const ACTION_EXPIRY = 2000000000n;
const MAKER_NONCE = 1n;
const TAKER_NONCE = 2n;

// Raw struct components per IRfqModule.sol
const TRADE_DATA = [
  { name: "asset", type: "address" },
  { name: "subId", type: "uint256" },
  { name: "price", type: "uint256" },
  { name: "amount", type: "int256" },
] as const;

async function buildFixture() {
  const makerAction = buildAction({
    subaccountId: MAKER_SUBACC,
    module: RFQ_MODULE,
    data: encodeRfqOrder({ maxFee: 0n, trades: TRADES }),
    owner: maker.address,
    nonce: MAKER_NONCE,
    expiry: ACTION_EXPIRY,
  });
  const makerSignature = await signAction({
    action: makerAction,
    signer: maker,
    chainId: CHAIN_ID,
    matchingAddress: MATCHING,
  });

  const orderHash = hashRfqTrades(TRADES);
  const takerAction = buildAction({
    subaccountId: TAKER_SUBACC,
    module: RFQ_MODULE,
    data: encodeTakerOrder({ orderHash, maxFee: 0n }),
    owner: taker.address,
    nonce: TAKER_NONCE,
    expiry: ACTION_EXPIRY,
  });
  const takerSignature = await signAction({
    action: takerAction,
    signer: taker,
    chainId: CHAIN_ID,
    matchingAddress: MATCHING,
  });

  const rfq: Rfq = {
    id: "rfq-fixture",
    takerSubaccountId: TAKER_SUBACC,
    instrument: {
      currency: "BTC",
      optionAsset: OPTION_ASSET,
      expiry: EXPIRY,
      strike: STRIKE,
      isCall: true,
      subId: SUB_ID,
      name: "BTC-20270115-110000-C",
    },
    amount: AMOUNT,
    direction: "sell",
    createdAt: 0,
    auctionEndsAt: 0,
    acceptDeadlineAt: null,
    status: "closed",
    bestQuoteId: "quote-fixture",
    execution: null,
    error: null,
  };
  const quote: Quote = {
    id: "quote-fixture",
    rfqId: rfq.id,
    maker: maker.address,
    makerSubaccountId: MAKER_SUBACC,
    premium: PREMIUM,
    totalPremium: (PREMIUM * AMOUNT) / 10n ** 18n,
    trades: TRADES,
    orderHash,
    action: makerAction,
    signature: makerSignature,
    receivedAt: 0,
    reservedCash: (PREMIUM * AMOUNT) / 10n ** 18n,
  };

  return { rfq, quote, makerAction, makerSignature, takerAction, takerSignature, orderHash };
}

describe("buildRfqExecution — exact verifyAndMatch submission", () => {
  it("produces calldata matching RfqModule.sol / Matching.sol semantics byte-for-byte", async () => {
    const f = await buildFixture();
    const plan = buildRfqExecution({
      rfq: f.rfq,
      quote: f.quote,
      takerAction: f.takerAction,
      takerSignature: f.takerSignature,
    });

    // --- action ordering: [maker, taker], signatures aligned ---
    expect(plan.actions).toEqual([f.makerAction, f.takerAction]);
    expect(plan.signatures).toEqual([f.makerSignature, f.takerSignature]);

    // --- maker action data == abi.encode(RfqOrder{maxFee, trades}) (raw re-derivation) ---
    const expectedMakerData = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "maxFee", type: "uint256" },
            { name: "trades", type: "tuple[]", components: [...TRADE_DATA] },
          ],
        },
      ],
      [{ maxFee: 0n, trades: TRADES }],
    );
    expect(plan.actions[0].data).toBe(expectedMakerData);

    // --- taker orderHash == keccak256(abi.encode(makerOrder.trades)) (RFQM_InvalidTakerHash) ---
    const expectedOrderHash = keccak256(
      encodeAbiParameters([{ type: "tuple[]", components: [...TRADE_DATA] }], [TRADES]),
    );
    expect(f.orderHash).toBe(expectedOrderHash);
    const expectedTakerData = encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "orderHash", type: "bytes32" },
            { name: "maxFee", type: "uint256" },
          ],
        },
      ],
      [{ orderHash: expectedOrderHash, maxFee: 0n }],
    );
    expect(plan.actions[1].data).toBe(expectedTakerData);

    // --- actionData == abi.encode(FillData) with fill accounts matching the
    //     signed subaccounts (RFQM_SignedAccountMismatch) and zero fees ---
    const expectedFillData = encodeAbiParameters(
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
      [
        {
          makerAccount: MAKER_SUBACC,
          makerFee: 0n,
          takerAccount: TAKER_SUBACC,
          takerFee: 0n,
          managerData: "0x",
        },
      ],
    );
    expect(plan.actionData).toBe(expectedFillData);

    // --- full calldata equals verifyAndMatch encoded against the function
    //     signature transcribed from Matching.sol / IActionVerifier.sol ---
    const verifyAndMatchAbi = parseAbiItem(
      "function verifyAndMatch((uint256 subaccountId, uint256 nonce, address module, bytes data, uint256 expiry, address owner, address signer)[] actions, bytes[] signatures, bytes actionData)",
    );
    const expectedCalldata = encodeFunctionData({
      abi: [verifyAndMatchAbi],
      args: [
        [f.makerAction, f.takerAction],
        [f.makerSignature, f.takerSignature],
        expectedFillData,
      ],
    });
    expect(plan.calldata).toBe(expectedCalldata);

    // selector sanity: 4-byte selector of the Matching.sol signature
    expect(plan.calldata.slice(0, 10)).toBe(expectedCalldata.slice(0, 10));

    // --- decodes cleanly with the vendored-artifact ABI ---
    const decoded = decodeFunctionData({ abi: matchingAbi, data: plan.calldata });
    expect(decoded.functionName).toBe("verifyAndMatch");
    const [actions, signatures, actionData] = decoded.args as [
      readonly Action[],
      readonly Hex[],
      Hex,
    ];
    expect(actions).toHaveLength(2);
    expect(actions[0]!.subaccountId).toBe(MAKER_SUBACC);
    expect(actions[0]!.nonce).toBe(MAKER_NONCE);
    expect(actions[0]!.module.toLowerCase()).toBe(RFQ_MODULE.toLowerCase());
    expect(actions[0]!.owner.toLowerCase()).toBe(maker.address.toLowerCase());
    expect(actions[0]!.signer.toLowerCase()).toBe(maker.address.toLowerCase());
    expect(actions[0]!.expiry).toBe(ACTION_EXPIRY);
    expect(actions[1]!.subaccountId).toBe(TAKER_SUBACC);
    expect(actions[1]!.owner.toLowerCase()).toBe(taker.address.toLowerCase());
    expect(signatures).toEqual([f.makerSignature, f.takerSignature]);
    expect(actionData).toBe(expectedFillData);

    // --- signatures recover to the signers under the Matching EIP-712 domain
    //     (ActionVerifier: EIP712("Matching","1.0"), Action typehash) ---
    for (const [action, signature, expected] of [
      [f.makerAction, f.makerSignature, maker.address],
      [f.takerAction, f.takerSignature, taker.address],
    ] as const) {
      const recovered = await recoverTypedDataAddress({
        domain: {
          name: "Matching",
          version: "1.0",
          chainId: CHAIN_ID,
          verifyingContract: MATCHING,
        },
        types: ACTION_TYPES,
        primaryType: "Action",
        message: action,
        signature,
      });
      expect(recovered.toLowerCase()).toBe(expected.toLowerCase());
    }

    // --- fill summary ---
    expect(plan.fill).toMatchObject({
      makerSubaccountId: MAKER_SUBACC,
      takerSubaccountId: TAKER_SUBACC,
      amount: AMOUNT,
      premium: PREMIUM,
      totalPremium: toUnit("1500"),
      makerFee: 0n,
      takerFee: 0n,
    });

    // --- frozen fixture: the entire deterministic submission, pinned ---
    // (fixed keys + nonces + expiries => deterministic RFC6979 signatures)
    expect(keccak256(plan.calldata)).toBe(
      "0xa5e0b86fc2eb83798458feace5a79704e3602ba6e90afefe74c6e70f6a1f3977",
    );
  });

  it("honors fee and managerData overrides within the signed maxFee caps", async () => {
    const f = await buildFixture();
    const plan = buildRfqExecution({
      rfq: f.rfq,
      quote: f.quote,
      takerAction: f.takerAction,
      takerSignature: f.takerSignature,
      makerFee: 5n,
      takerFee: 7n,
      managerData: "0x1234",
    });
    const decoded = decodeFunctionData({ abi: matchingAbi, data: plan.calldata });
    const [, , actionData] = decoded.args as [unknown, unknown, Hex];
    const expected = encodeAbiParameters(
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
      [
        {
          makerAccount: MAKER_SUBACC,
          makerFee: 5n,
          takerAccount: TAKER_SUBACC,
          takerFee: 7n,
          managerData: "0x1234",
        },
      ],
    );
    expect(actionData).toBe(expected);
    expect(plan.fill.makerFee).toBe(5n);
    expect(plan.fill.takerFee).toBe(7n);
  });
});
