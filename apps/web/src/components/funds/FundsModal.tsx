"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCoveredCallSubaccount } from "@/hooks/protocol/useCoveredCallSubaccount";
import { bufferedRepayTokenUnits, useRepayCash } from "@/hooks/protocol/useRepayCash";
import { useSubaccountAssets } from "@/hooks/protocol/useSubaccountAssets";
import { useWithdraw, type WithdrawalFormSnapshot } from "@/hooks/protocol/useWithdraw";
import { useNetwork } from "@/hooks/protocol/useNetwork";
import { displayAmount18ToNative, formatDecimalUnits, nativeAmountToBalance18, parseDecimalUnits, withdrawableDisplayBalance18, type WithdrawableAsset } from "@/lib/protocol/withdrawal-assets";

const ONE_18 = 10n ** 18n;
type FundsMode = "withdraw" | "repay";

function displayNativeAmount(native: bigint, tokenDecimals: number, multiplier: bigint | null): string {
  const raw18 = nativeAmountToBalance18(native, tokenDecimals);
  return formatDecimalUnits(withdrawableDisplayBalance18(raw18, multiplier), 18);
}

function formSnapshot(value: string, asset: WithdrawableAsset): WithdrawalFormSnapshot {
  if (!asset.conversionReady) throw new Error("The live conversion rate is unavailable");
  const tokenUnits = asset.multiplier === null
    ? parseDecimalUnits(value, asset.tokenDecimals)
    : displayAmount18ToNative(parseDecimalUnits(value, 18), asset.tokenDecimals, asset.multiplier);
  if (tokenUnits <= 0n) throw new Error("Amount must be greater than zero");
  return {
    displayAmount: displayNativeAmount(tokenUnits, asset.tokenDecimals, asset.multiplier),
    tokenUnits,
    tokenDecimals: asset.tokenDecimals,
    multiplier: (asset.multiplier ?? ONE_18).toString(),
  };
}

export function FundsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { address } = useAccount();
  const { explorerUrl } = useNetwork();
  const { accounts, subaccountId: globalAccountId, isLoading: accountsLoading } = useCoveredCallSubaccount();
  const [accountChoice, setAccountChoice] = useState<bigint | null>(null);
  const accountId = accountChoice !== null && accounts.some((account) => account.accountId === accountChoice)
    ? accountChoice
    : globalAccountId !== null && accounts.some((account) => account.accountId === globalAccountId)
      ? globalAccountId
      : accounts[0]?.accountId ?? null;
  const [mode, setMode] = useState<FundsMode>("withdraw");
  const accountAssets = useSubaccountAssets(accountId);
  const withdraw = useWithdraw();
  const repay = useRepayCash();
  const [assetChoice, setAssetChoice] = useState<string>("cash");
  const [amountDraft, setAmountDraft] = useState({ scope: "", value: "" });
  const [flowScope, setFlowScope] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const selectedAsset = useMemo(() => accountAssets.assets.find((asset) => asset.assetId === assetChoice) ?? accountAssets.assets[0] ?? null, [accountAssets.assets, assetChoice]);
  const scope = accountId !== null && selectedAsset ? `${accountId.toString()}:${selectedAsset.assetId}` : "";
  const amount = amountDraft.scope === scope ? amountDraft.value : "";
  const flowCurrent = scope !== "" && flowScope === scope;
  const currentPreview = flowCurrent ? withdraw.preview : null;

  const hasDebt = accountAssets.cashDebt18 > 0n;
  const busy = withdraw.isBusy || ["approving", "repaying", "confirming"].includes(repay.phase);
  const fundsLocked = busy || withdraw.phase === "unknown" || repay.phase === "unknown";
  const recommendedRepay = () => {
    if (repay.tokenDecimals === null) return 0n;
    const target = bufferedRepayTokenUnits(accountAssets.cashDebt18, repay.tokenDecimals);
    return target < repay.walletBalance ? target : repay.walletBalance;
  };
  const chooseMode = (next: FundsMode) => {
    if (fundsLocked) return;
    setMode(next); setLocalError(null); withdraw.reset(); repay.reset();
    setFlowScope("");
    setAmountDraft({
      scope,
      value: next === "repay" && repay.tokenDecimals !== null
        ? formatDecimalUnits(recommendedRepay(), repay.tokenDecimals)
        : "",
    });
  };

  const fillMaximum = async () => {
    setLocalError(null);
    if (mode === "repay") {
      if (repay.tokenDecimals !== null) {
        setAmountDraft({ scope, value: formatDecimalUnits(recommendedRepay(), repay.tokenDecimals) });
      }
      return;
    }
    if (accountId === null || !selectedAsset) return;
    try {
      setFlowScope(scope);
      const preview = await withdraw.requestPreview({
        subaccountId: accountId,
        assetId: selectedAsset.assetId,
        protocolAsset: selectedAsset.protocolAsset,
        tokenAddress: selectedAsset.tokenAddress,
      });
      if (preview.blocker) throw new Error(preview.blocker.message);
      const liveMultiplier = BigInt(preview.multiplier) === ONE_18 ? null : BigInt(preview.multiplier);
      setAmountDraft({
        scope,
        value: displayNativeAmount(BigInt(preview.recommendedMaxTokenUnits), preview.asset.tokenDecimals, liveMultiplier),
      });
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const review = async () => {
    if (accountId === null || !selectedAsset) return;
    setLocalError(null);
    try {
      const snapshot = formSnapshot(amount, selectedAsset);
      setFlowScope(scope);
      const preview = await withdraw.requestPreview({
        subaccountId: accountId,
        assetId: selectedAsset.assetId,
        protocolAsset: selectedAsset.protocolAsset,
        tokenAddress: selectedAsset.tokenAddress,
        formSnapshot: snapshot,
      });
      if (snapshot.tokenUnits > BigInt(preview.protocolMaxTokenUnits)) throw new Error("Amount exceeds the protocol's current withdrawal maximum");
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const prepare = async () => {
    if (!selectedAsset) return;
    setLocalError(null);
    try { await withdraw.prepare(formSnapshot(amount, selectedAsset)); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const repayDebt = async () => {
    if (accountId === null || repay.tokenDecimals === null) return;
    setLocalError(null);
    try {
      const units = parseDecimalUnits(amount, repay.tokenDecimals);
      if (units <= 0n) throw new Error("Amount must be greater than zero");
      await repay.repay(accountId, units);
    } catch (caught) { setLocalError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const close = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setAccountChoice(null); setAssetChoice("cash"); setMode("withdraw");
      setAmountDraft({ scope: "", value: "" }); setFlowScope(""); setLocalError(null);
      if (withdraw.phase !== "unknown") withdraw.reset();
      repay.reset();
    }
  };
  const amountChanged = (value: string) => {
    setAmountDraft({ scope, value }); setLocalError(null);
    setFlowScope("");
    if (withdraw.isAmountReviewed) withdraw.reset();
  };
  const accountChanged = (value: string) => {
    setAccountChoice(value ? BigInt(value) : null);
    setAssetChoice("cash"); setAmountDraft({ scope: "", value: "" }); setFlowScope(""); setLocalError(null);
    withdraw.reset(); repay.reset();
  };
  const assetChanged = (value: string) => {
    setAssetChoice(value); setAmountDraft({ scope: "", value: "" }); setFlowScope(""); setLocalError(null);
    withdraw.reset(); repay.reset();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onEscapeKeyDown={(event) => busy && event.preventDefault()} onPointerDownOutside={(event) => busy && event.preventDefault()}>
        <DialogTitle className="pr-10 font-heading text-2xl font-bold tracking-[-0.035em] text-zinc-950">Manage funds</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-zinc-500">Withdraw through the executor, or repay negative USDT directly from your wallet.</DialogDescription>
        {!address ? <p role="alert" className="mt-6 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Connect your wallet to manage funds.</p> : (
          <div className="mt-6 space-y-5">
            {hasDebt && <div role="tablist" aria-label="Funds action" className="grid grid-cols-2 border border-zinc-200 p-1">
              <button role="tab" aria-selected={mode === "withdraw"} disabled={fundsLocked} type="button" onClick={() => chooseMode("withdraw")} className={`min-h-10 font-mono text-xs font-semibold uppercase disabled:opacity-50 ${mode === "withdraw" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}>Withdraw</button>
              <button role="tab" aria-selected={mode === "repay"} disabled={fundsLocked} type="button" onClick={() => chooseMode("repay")} className={`min-h-10 font-mono text-xs font-semibold uppercase disabled:opacity-50 ${mode === "repay" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}>Repay USDT</button>
            </div>}
            <label className="block"><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Account</span>
              <select aria-label="Funds account" value={accountId?.toString() ?? ""} disabled={fundsLocked || accountsLoading} onChange={(event) => accountChanged(event.target.value)} className="mt-2 h-11 w-full border border-zinc-200 bg-white px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-orange-500">
                {accounts.length === 0 && <option value="">No validated account</option>}{accounts.map((account) => <option key={account.accountId.toString()} value={account.accountId.toString()}>Account #{account.accountId.toString()}</option>)}
              </select>
            </label>
            {mode === "withdraw" && <label className="block"><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Asset</span>
              <select aria-label="Withdrawal asset" value={selectedAsset?.assetId ?? ""} disabled={fundsLocked || accountAssets.isLoading} onChange={(event) => assetChanged(event.target.value)} className="mt-2 h-11 w-full border border-zinc-200 bg-white px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-orange-500">
                {accountAssets.assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.symbol}{asset.exitOnly ? " (exit only)" : ""} · {asset.displayBalance18 === null ? "rate unavailable" : formatDecimalUnits(asset.displayBalance18, 18)}</option>)}
              </select>
            </label>}
            {mode === "withdraw" && hasDebt && <p className="border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">This account has {formatDecimalUnits(accountAssets.cashDebt18, 18)} USDT of interest-adjusted cash debt. Withdrawal remains available when the protocol preview allows it; repaying may increase the safe amount.</p>}
            {mode === "withdraw" && accountAssets.hasOptionPositions && !currentPreview && <p className="border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">This account has option positions. The live preview calculates the safe amount; positions may reduce it to zero.</p>}
            {mode === "repay" && <p className="border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">The recommended repayment includes a 0.01% buffer for interest drift. Any excess becomes positive USDT cash in this account.</p>}
            <div><div className="flex items-center justify-between"><label htmlFor="funds-amount" className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Amount</label><button type="button" onClick={() => void fillMaximum()} disabled={fundsLocked || (mode === "withdraw" && !selectedAsset?.conversionReady)} className="min-h-9 px-2 font-mono text-[10px] font-semibold uppercase text-orange-700 disabled:text-zinc-400">{mode === "repay" ? "Recommended" : "Max"}</button></div>
              <div className="relative"><Input id="funds-amount" inputMode="decimal" value={amount} disabled={fundsLocked || (flowCurrent && withdraw.phase === "ready")} onChange={(event) => amountChanged(event.target.value)} placeholder="0.00" className="h-12 rounded-none border border-zinc-200 pr-20" /><span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-zinc-500">{mode === "repay" ? "USDT" : selectedAsset?.symbol ?? ""}</span></div>
              {mode === "repay" && repay.tokenDecimals !== null && <p className="mt-2 text-xs text-zinc-500">Interest-adjusted debt: {formatDecimalUnits(accountAssets.cashDebt18, 18)} USDT · Wallet: {formatDecimalUnits(repay.walletBalance, repay.tokenDecimals)} USDT</p>}
            </div>
            {currentPreview && mode === "withdraw" && <div className="border-y border-zinc-200 py-3 text-xs text-zinc-600">
              <div className="flex justify-between gap-4"><span>Protocol maximum</span><span className="font-mono text-zinc-950">{displayNativeAmount(BigInt(currentPreview.protocolMaxTokenUnits), currentPreview.asset.tokenDecimals, BigInt(currentPreview.multiplier) === ONE_18 ? null : BigInt(currentPreview.multiplier))} {currentPreview.asset.symbol}</span></div>
              <div className="mt-2 flex justify-between gap-4"><span>Recommended Max</span><span className="font-mono text-zinc-950">{displayNativeAmount(BigInt(currentPreview.recommendedMaxTokenUnits), currentPreview.asset.tokenDecimals, BigInt(currentPreview.multiplier) === ONE_18 ? null : BigInt(currentPreview.multiplier))} {currentPreview.asset.symbol}</span></div>
              <div className="mt-2 flex justify-between gap-4"><span>Max snapshot</span><span className="font-mono text-zinc-950">Block #{currentPreview.blockNumber}</span></div>
              {withdraw.preparedReview && <div className="mt-2 flex justify-between gap-4"><span>Prepared snapshot</span><span className="font-mono text-zinc-950">Block #{withdraw.preparedReview.preparedBlockNumber}</span></div>}
              {withdraw.isAmountReviewed && <div className="mt-2 flex justify-between gap-4"><span>Destination</span><span className="max-w-[15rem] truncate font-mono text-zinc-950" title={address}>{address}</span></div>}
              {currentPreview.blocker && <p role="alert" className="mt-3 text-red-700">{currentPreview.blocker.message}</p>}
            </div>}
            {(localError || withdraw.error || repay.error || accountAssets.error) && <div role="alert" className="flex gap-2 border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{localError ?? withdraw.error?.message ?? repay.error ?? accountAssets.error?.message}</span></div>}
            {(withdraw.phase === "done" || repay.phase === "done") && <div role="status" className="flex gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>{repay.phase === "done" ? (repay.error ? "Repayment confirmed; refresh balances before withdrawing." : "Repayment confirmed and balances refreshed.") : "Withdrawal confirmed and balances refreshed."}</span></div>}
            {withdraw.phase === "unknown" && <div role="status" className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Submission status is unknown. Do not create another withdrawal; use Check status to reconcile it.</div>}
            {repay.phase === "unknown" && <div role="status" className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{repay.confirmedAwaitingRefresh ? "Repayment is confirmed, but authoritative balances have not refreshed. Do not repay again; use Check status to finish reconciliation." : repay.txHash ? "Repayment was broadcast but is not yet confirmed. Do not repay again; use Check status to reconcile it." : "Your wallet did not return a transaction hash. The repayment may still have been broadcast. Verify wallet activity and the account debt before allowing another repayment."}</div>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {(withdraw.withdrawal?.txHash ?? repay.txHash) && <Button asChild variant="outline"><a href={`${explorerUrl}/tx/${withdraw.withdrawal?.txHash ?? repay.txHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink className="size-3.5" /></a></Button>}
              {withdraw.phase === "unknown" && <Button variant="outline" onClick={() => void withdraw.reconcile()}><RefreshCw className="size-3.5" /> Check status</Button>}
              {repay.phase === "unknown" && repay.txHash && <Button variant="outline" onClick={() => void repay.reconcile()}><RefreshCw className="size-3.5" /> Check status</Button>}
              {repay.phase === "unknown" && !repay.txHash && <Button variant="outline" onClick={repay.acknowledgeNoTransaction}>I verified no transaction</Button>}
              {mode === "repay" ? (repay.phase === "done" ? <Button variant="accent" onClick={() => chooseMode("withdraw")}>Continue to withdraw</Button> : <Button variant="accent" disabled={fundsLocked || !amount || accountId === null || repay.tokenDecimals === null} onClick={() => void repayDebt()}>{repay.phase === "approving" ? "Approve USDT…" : ["repaying", "confirming"].includes(repay.phase) ? "Repaying…" : "Repay USDT"}</Button>) : flowCurrent && withdraw.phase === "review" && withdraw.isAmountReviewed ? <Button variant="accent" disabled={!!currentPreview?.blocker} onClick={() => void prepare()}>Prepare withdrawal</Button> : flowCurrent && withdraw.phase === "ready" ? <Button variant="accent" onClick={() => void withdraw.signAndSubmit()}>Sign and withdraw</Button> : withdraw.phase === "done" ? <Button variant="outline" onClick={() => close(false)}>Done</Button> : <Button variant="accent" disabled={fundsLocked || !amount || accountId === null || !selectedAsset?.conversionReady} onClick={() => void review()}>{flowCurrent && withdraw.phase === "previewing" ? "Checking…" : "Review withdrawal"}</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
