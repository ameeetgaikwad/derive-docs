import { decodeAbiParameters, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { signAction } from "../src/actions.js";
import {
  buildRfqActionPair,
  encodeRfqFillData,
  encodeRfqOrder,
  hashRfqTrades,
  type RfqTradeData,
} from "../src/rfq.js";
import { encodeOptionSubId } from "../src/instruments.js";
import { toUnit } from "../src/units.js";

const maker = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d7838d2bb7f51347dba71d4462a13a86df0bf032",
);
const taker = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const RFQ_MODULE = "0x00000000000000000000000000000000000000ee" as const;
const OPTION_ASSET = "0x00000000000000000000000000000000000000ff" as const;

describe("RfqModule encodings", () => {
  const subId = encodeOptionSubId({
    expiry: 1781712000n,
    strike: toUnit("110000"),
    isCall: true,
  });

  // Covered call: maker (MM) buys 1 call from taker at a $1.5k premium.
  const trades: RfqTradeData[] = [
    { asset: OPTION_ASSET, subId, price: toUnit("1500"), amount: toUnit("1") },
  ];

  it("orderHash = keccak256(abi.encode(trades)) and is embedded in the taker order", () => {
    const { takerOrder, orderHash, makerOrder } = buildRfqActionPair({
      rfqModule: RFQ_MODULE,
      trades,
      maker: { subaccountId: 1n, owner: maker.address, maxFee: toUnit("1") },
      taker: { subaccountId: 2n, owner: taker.address, maxFee: toUnit("1") },
    });
    expect(takerOrder.orderHash).toBe(hashRfqTrades(trades));
    expect(orderHash).toBe(takerOrder.orderHash);

    // RfqModule check: takerOrder.orderHash == keccak256(abi.encode(makerOrder.trades))
    const encodedTradesOnly = hashRfqTrades(makerOrder.trades);
    expect(takerOrder.orderHash).toBe(encodedTradesOnly);
  });

  it("maker order decodes back per IRfqModule.RfqOrder", () => {
    const encoded = encodeRfqOrder({ maxFee: 123n, trades });
    const [decoded] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "maxFee", type: "uint256" },
            {
              name: "trades",
              type: "tuple[]",
              components: [
                { name: "asset", type: "address" },
                { name: "subId", type: "uint256" },
                { name: "price", type: "uint256" },
                { name: "amount", type: "int256" },
              ],
            },
          ],
        },
      ],
      encoded,
    );
    expect(decoded.maxFee).toBe(123n);
    expect(decoded.trades[0]?.subId).toBe(subId);
    expect(decoded.trades[0]?.amount).toBe(toUnit("1"));
  });

  it("builds and signs the maker+taker action pair", async () => {
    const { makerAction, takerAction } = buildRfqActionPair({
      rfqModule: RFQ_MODULE,
      trades,
      maker: { subaccountId: 1n, owner: maker.address },
      taker: { subaccountId: 2n, owner: taker.address },
    });

    expect(makerAction.module).toBe(RFQ_MODULE);
    expect(takerAction.module).toBe(RFQ_MODULE);
    expect(makerAction.signer).toBe(maker.address);

    const sigM = await signAction({
      action: makerAction,
      signer: maker,
      chainId: 31337,
      matchingAddress: "0x00000000000000000000000000000000000000aa",
    });
    const sigT = await signAction({
      action: takerAction,
      signer: taker,
      chainId: 31337,
      matchingAddress: "0x00000000000000000000000000000000000000aa",
    });
    expect(sigM).toMatch(/^0x[0-9a-f]{130}$/);
    expect(sigT).toMatch(/^0x[0-9a-f]{130}$/);
    expect(sigM).not.toBe(sigT);
  });

  it("fill data encodes per IRfqModule.FillData", () => {
    const encoded = encodeRfqFillData({
      makerAccount: 1n,
      makerFee: 0n,
      takerAccount: 2n,
      takerFee: 0n,
      managerData: "0x",
    });
    const [decoded] = decodeAbiParameters(
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
      encoded,
    );
    expect(decoded.takerAccount).toBe(2n);
    expect(keccak256(encoded)).toMatch(/^0x/);
  });
});
