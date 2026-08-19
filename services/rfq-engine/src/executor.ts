import { keccak256, type Hex } from "viem";
import { encodeRfqFillData, type Action } from "@hedge/shared";
import {
  UNKNOWN_BROADCAST_OPERATION,
  buildVerifyAndMatchCalldata,
  type TxSubmitter,
  type VerifyAndMatchReconciliation,
} from "./chain.js";
import type {
  ExecutionResult,
  FillSummary,
  Quote,
  Rfq,
  RfqActionIdentity,
  RfqExecutionIntent,
} from "./types.js";

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

  /** Rebuild the shared executor latch for a durable, unresolved RFQ. */
  pauseForUnknownExecution(rfqId: string): void {
    this.submitter.pauseForUnknownOperation?.(`rfq:${rfqId}`);
  }

  async createExecutionIntent(plan: RfqExecutionPlan): Promise<RfqExecutionIntent> {
    const identity = (action: Action): RfqActionIdentity => ({
      subaccountId: action.subaccountId,
      nonce: action.nonce,
      module: action.module,
      expiry: action.expiry,
      owner: action.owner,
      signer: action.signer,
      dataHash: keccak256(action.data),
    });
    return {
      actions: [identity(plan.actions[0]), identity(plan.actions[1])],
      calldataHash: keccak256(plan.calldata),
      fromBlock: await (this.submitter.currentBlockNumber?.() ?? Promise.resolve(0n)),
      txHash: null,
      fill: plan.fill,
    };
  }

  armExecutionRecovery(rfqId: string, txHash: Hex | null): void {
    this.pauseForUnknownExecution(rfqId);
    if (txHash) this.submitter.adoptUnresolvedTransaction?.(txHash);
  }

  async reconcileExecution(intent: RfqExecutionIntent): Promise<VerifyAndMatchReconciliation> {
    return this.submitter.reconcileVerifyAndMatch?.({
      txHash: intent.txHash,
      calldataHash: intent.calldataHash,
      actions: intent.actions,
      fromBlock: intent.fromBlock,
    }) ?? { state: "pending" };
  }

  /** Call only after the RFQ terminal state has been durably persisted. */
  clearExecutionRecovery(rfqId: string, txHash: Hex | null, wasHashless: boolean): void {
    this.submitter.clearUnknownOperation?.(`rfq:${rfqId}`);
    if (txHash) this.submitter.clearUnresolvedTransaction?.(txHash);
    if (wasHashless) this.submitter.clearUnknownOperation?.(UNKNOWN_BROADCAST_OPERATION);
  }

  async execute(
    plan: RfqExecutionPlan,
    onSubmitted?: (txHash: Hex) => Promise<void>,
  ): Promise<ExecutionResult> {
    const result = await this.submitter.submitVerifyAndMatch(
      plan.actions,
      plan.signatures,
      plan.actionData,
      onSubmitted,
    );
    return {
      txHash: result.txHash,
      status: result.status,
      blockNumber: result.blockNumber,
      fill: plan.fill,
    };
  }
}
