import type { Hex } from "viem";
import { encodeRfqFillData, type Action } from "@sats-options/shared";
import { buildVerifyAndMatchCalldata, type TxSubmitter } from "./chain.js";
import type { ExecutionResult, FillSummary, Quote, Rfq } from "./types.js";

export interface RfqExecutionPlan {
  /** [makerAction, takerAction] — RfqModule.executeAction expects exactly this order */
  actions: [Action, Action];
  signatures: [Hex, Hex];
  /** abi.encode(IRfqModule.FillData) */
  actionData: Hex;
  /** full Matching.verifyAndMatch calldata */
  calldata: Hex;
  fill: FillSummary;
}

/**
 * Build the exact verifyAndMatch submission for a matched RFQ, per
 * protocol/lib/v2-matching/src/modules/RfqModule.sol semantics:
 *
 *   - actions[0] = maker (signed RfqOrder { maxFee, trades[] })
 *   - actions[1] = taker (signed TakerOrder { orderHash, maxFee })
 *   - actionData = FillData { makerAccount, makerFee, takerAccount, takerFee, managerData }
 *
 * v1 charges no engine fees (makerFee = takerFee = 0, both under the signed
 * maxFee caps) and posts no managerData (oracle-feeds keeps feeds fresh
 * out-of-band).
 */
export function buildRfqExecution(params: {
  rfq: Rfq;
  quote: Quote;
  takerAction: Action;
  takerSignature: Hex;
  makerFee?: bigint;
  takerFee?: bigint;
  managerData?: Hex;
}): RfqExecutionPlan {
  const { rfq, quote, takerAction, takerSignature } = params;
  const makerFee = params.makerFee ?? 0n;
  const takerFee = params.takerFee ?? 0n;

  const actionData = encodeRfqFillData({
    makerAccount: quote.action.subaccountId,
    makerFee,
    takerAccount: takerAction.subaccountId,
    takerFee,
    managerData: params.managerData ?? "0x",
  });

  const actions: [Action, Action] = [quote.action, takerAction];
  const signatures: [Hex, Hex] = [quote.signature, takerSignature];

  return {
    actions,
    signatures,
    actionData,
    calldata: buildVerifyAndMatchCalldata(actions, signatures, actionData),
    fill: {
      rfqId: rfq.id,
      quoteId: quote.id,
      instrument: rfq.instrument.name,
      maker: quote.maker,
      makerSubaccountId: quote.action.subaccountId,
      takerSubaccountId: takerAction.subaccountId,
      amount: rfq.amount,
      premium: quote.premium,
      totalPremium: quote.totalPremium,
      makerFee,
      takerFee,
    },
  };
}

export class Executor {
  constructor(private readonly submitter: TxSubmitter) {}

  get executorAddress() {
    return this.submitter.executorAddress;
  }

  async execute(plan: RfqExecutionPlan): Promise<ExecutionResult> {
    const result = await this.submitter.submitVerifyAndMatch(
      plan.actions,
      plan.signatures,
      plan.actionData,
    );
    return {
      txHash: result.txHash,
      status: result.status,
      blockNumber: result.blockNumber,
      fill: plan.fill,
    };
  }
}
