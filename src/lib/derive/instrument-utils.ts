import type { Instrument, OptionType, Ticker } from "./types";
import { daysUntilExpiry } from "./utils";

export interface ExpiryGroup {
  expiry: number; // Unix timestamp
  expiryLabel: string; // "20240628"
  daysUntil: number;
  instruments: Instrument[];
  callCount: number;
  putCount: number;
}

export interface OptionChainRow {
  strike: number;
  call?: Instrument;
  put?: Instrument;
  callTicker?: Ticker;
  putTicker?: Ticker;
}

/**
 * Group instruments by expiry date.
 * Uses the nested option_details from the actual API response.
 */
export function groupByExpiry(instruments: Instrument[]): ExpiryGroup[] {
  const groups = new Map<number, ExpiryGroup>();

  for (const inst of instruments) {
    if (!inst.option_details || !inst.is_active) continue;

    const expiry = inst.option_details.expiry;
    const isCall = inst.option_details.option_type === "C";
    const isPut = inst.option_details.option_type === "P";

    const existing = groups.get(expiry);
    if (existing) {
      existing.instruments.push(inst);
      if (isCall) existing.callCount++;
      if (isPut) existing.putCount++;
    } else {
      groups.set(expiry, {
        expiry,
        expiryLabel: inst.instrument_name.split("-")[1] ?? "",
        daysUntil: daysUntilExpiry(expiry),
        instruments: [inst],
        callCount: isCall ? 1 : 0,
        putCount: isPut ? 1 : 0,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.expiry - b.expiry);
}

/**
 * Group instruments by strike for a given expiry.
 * Uses the nested option_details from the actual API response.
 */
export function groupByStrike(instruments: Instrument[]): Map<number, { call?: Instrument; put?: Instrument }> {
  const strikes = new Map<number, { call?: Instrument; put?: Instrument }>();

  for (const inst of instruments) {
    if (!inst.option_details) continue;
    const strike = parseFloat(inst.option_details.strike);
    const existing = strikes.get(strike) ?? {};
    if (inst.option_details.option_type === "C") existing.call = inst;
    if (inst.option_details.option_type === "P") existing.put = inst;
    strikes.set(strike, existing);
  }

  return strikes;
}

/**
 * Build an option chain for a specific expiry.
 */
export function buildOptionChain(
  instruments: Instrument[],
  tickers?: Map<string, Ticker>
): OptionChainRow[] {
  const strikes = groupByStrike(instruments);
  const rows: OptionChainRow[] = [];

  for (const [strike, { call, put }] of strikes) {
    rows.push({
      strike,
      call,
      put,
      callTicker: call && tickers?.get(call.instrument_name),
      putTicker: put && tickers?.get(put.instrument_name),
    });
  }

  return rows.sort((a, b) => a.strike - b.strike);
}

/**
 * Determine moneyness relative to spot price.
 */
export function getMoneyness(
  strike: number,
  spotPrice: number,
  optionType: OptionType
): "ITM" | "ATM" | "OTM" {
  const diff = Math.abs(strike - spotPrice) / spotPrice;
  if (diff < 0.02) return "ATM";
  if (optionType === "C") {
    return strike < spotPrice ? "ITM" : "OTM";
  }
  return strike > spotPrice ? "ITM" : "OTM";
}

/**
 * Find the closest ATM strike.
 */
export function findAtmStrike(strikes: number[], spotPrice: number): number {
  return strikes.reduce((closest, strike) =>
    Math.abs(strike - spotPrice) < Math.abs(closest - spotPrice)
      ? strike
      : closest
  );
}

/**
 * Filter instruments to a specific expiry timestamp.
 */
export function filterByExpiry(instruments: Instrument[], expiry: number): Instrument[] {
  return instruments.filter((i) => i.option_details?.expiry === expiry);
}
