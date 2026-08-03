/**
 * Build a feed snapshot from Deribit's live BTC option surface.
 *
 * Deribit is the reference vol market for BTC options. For each requested
 * expiry we take Deribit's per-strike mark IV, fit a raw-SVI curve
 * (the shape LyraVolFeed stores), and produce a SnapshotParams the poster
 * posts verbatim — so the on-chain surface and the maker-bot's quotes both
 * reflect real market vol instead of a flat guess.
 *
 * Spot = Deribit BTC index; per-expiry forward = Deribit's underlying/forward
 * for that expiry. Expiries Deribit does not list (or that fail to fit) fall
 * back to the flat-IV path (svi left undefined, iv defaulted downstream).
 */
import {
  DeribitClient,
  fitSvi,
  sviParamsToUnits,
  toUnit,
  type DeribitBoard,
  type DeribitExpirySlice,
} from "@hedge/shared";
import type { SnapshotExpiryParams, SnapshotParams } from "./poster.js";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** Match a requested expiry to a Deribit slice: exact timestamp, else nearest within tolerance. */
function matchSlice(
  board: DeribitBoard,
  expiry: number,
  toleranceSec: number,
): DeribitExpirySlice | null {
  let best: DeribitExpirySlice | null = null;
  let bestDelta = Infinity;
  for (const slice of board.expiries) {
    const delta = Math.abs(slice.expiry - expiry);
    if (delta < bestDelta) {
      best = slice;
      bestDelta = delta;
    }
  }
  if (best && bestDelta <= toleranceSec) return best;
  return null;
}

export interface DeribitSnapshotOptions {
  /** Requested expiries (unix seconds). */
  expiries: bigint[];
  /** Chain time (unix seconds) — SVI tau is measured from here. */
  now: number;
  /** 18dp annualized rate to post per expiry (Deribit doesn't publish one). */
  rate?: bigint;
  /** Max seconds between a requested expiry and a Deribit expiry to reuse its curve. Default 0 (exact). */
  toleranceSec?: number;
  client?: DeribitClient;
  /** Minimum fittable points per expiry; below this we fall back to flat. Default 4. */
  minPoints?: number;
}

export interface DeribitSnapshotResult {
  snapshot: SnapshotParams;
  /** Per-expiry: whether a fitted Deribit SVI was used (vs flat fallback). */
  fitted: { expiry: bigint; used: boolean; note: string }[];
  indexPrice: number;
}

/**
 * Fetch the Deribit board once and build a SnapshotParams: spot (index),
 * and per requested expiry a forward + fitted SVI (or flat fallback).
 */
export async function buildDeribitSnapshot(
  opts: DeribitSnapshotOptions,
): Promise<DeribitSnapshotResult> {
  const client = opts.client ?? new DeribitClient();
  const minPoints = opts.minPoints ?? 4;
  const toleranceSec = opts.toleranceSec ?? 0;
  const board = await client.getBoard("BTC", opts.now);

  const spot = toUnit(board.indexPrice.toString());
  const expiryParams: SnapshotExpiryParams[] = [];
  const fitted: DeribitSnapshotResult["fitted"] = [];

  for (const expiry of opts.expiries) {
    const expiryNum = Number(expiry);
    const tau = (expiryNum - opts.now) / SECONDS_PER_YEAR;
    if (tau <= 0) {
      fitted.push({ expiry, used: false, note: "expiry in the past — skipped" });
      continue;
    }

    const slice = matchSlice(board, expiryNum, toleranceSec);
    const forward = slice ? toUnit(slice.forward.toString()) : spot;
    const base: SnapshotExpiryParams = { expiry, forwardPrice: forward, rate: opts.rate };

    const points =
      slice?.options
        .filter((o) => o.markIv != null && o.strike > 0)
        .map((o) => ({ strike: o.strike, iv: o.markIv as number })) ?? [];

    if (!slice || points.length < minPoints) {
      expiryParams.push(base); // flat fallback
      fitted.push({
        expiry,
        used: false,
        note: slice
          ? `only ${points.length} Deribit points (< ${minPoints}) — flat fallback`
          : "no Deribit expiry within tolerance — flat fallback",
      });
      continue;
    }

    try {
      const fit = fitSvi({ forward: slice.forward, tau, points });
      const svi = sviParamsToUnits(fit.params, slice.forward, tau);
      expiryParams.push({ ...base, svi });
      fitted.push({
        expiry,
        used: true,
        note: `fitted ${fit.n} pts, rmseVol=${(fit.rmseVol * 100).toFixed(2)}%`,
      });
    } catch (err) {
      expiryParams.push(base); // flat fallback on fit failure
      fitted.push({ expiry, used: false, note: `fit failed: ${(err as Error).message}` });
    }
  }

  return {
    snapshot: { spot, expiries: expiryParams },
    fitted,
    indexPrice: board.indexPrice,
  };
}
