import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SETTLEMENT_TWAP_DURATION } from "./poster.js";

const STATE_VERSION = 1;
const AGGREGATE_BASELINE = 1n;

interface SeriesState {
  expiry: string;
  lastTimestamp: string;
  lastPrice: string;
  integral: string;
  lateStart: boolean;
}

interface TwapState {
  version: typeof STATE_VERSION;
  chainId: number;
  series: SeriesState[];
}

export interface SettlementAggregates {
  settlementStartAggregate: bigint;
  currentSpotAggregate: bigint;
  /** True when the process started after the TWAP window and had to backfill. */
  lateStart: boolean;
}

/**
 * Persists the trapezoidal BTC spot integral required by LyraForwardFeed in
 * the final 30 minutes before expiry. The anchored settlement oracle remains
 * authoritative for final settlement; this tracker keeps pre-expiry margin
 * valuation live and continuous.
 */
export class SettlementTwapTracker {
  private readonly statePath: string;
  private readonly chainId: number;
  private readonly log: (message: string) => void;
  private state: TwapState | null = null;

  constructor(options: {
    chainId: number;
    statePath?: string;
    marketId?: string;
    log?: (message: string) => void;
  }) {
    this.chainId = options.chainId;
    this.log = options.log ?? (() => undefined);
    const marketId = options.marketId ?? "BTC";
    this.statePath =
      options.statePath ??
      resolve(
        fileURLToPath(new URL("../.data", import.meta.url)),
        marketId === "BTC"
          ? `settlement-twap.${options.chainId}.json`
          : `settlement-twap.${options.chainId}.${marketId}.json`,
      );
  }

  /** Record a spot observation and return aggregate fields when inside the TWAP window. */
  async observe(expiry: bigint, timestamp: bigint, spot: bigint): Promise<SettlementAggregates | null> {
    if (spot <= 0n) throw new Error(`TWAP spot must be positive (received ${spot})`);
    const start = expiry - SETTLEMENT_TWAP_DURATION;
    if (timestamp > expiry) throw new Error(`TWAP observation ${timestamp} is past expiry ${expiry}`);
    await this.ensureLoaded();

    const state = this.requireState();
    let series = state.series.find((entry) => entry.expiry === expiry.toString());
    if (!series) {
      series = {
        expiry: expiry.toString(),
        lastTimestamp: timestamp.toString(),
        lastPrice: spot.toString(),
        integral: "0",
        lateStart: timestamp > start,
      };
      state.series.push(series);
      await this.save();
      if (timestamp < start) return null;
      const integral = spot * (timestamp - start);
      series.integral = integral.toString();
      await this.save();
      return aggregates(integral, series.lateStart);
    }

    const previousTimestamp = BigInt(series.lastTimestamp);
    const previousPrice = BigInt(series.lastPrice);
    let integral = BigInt(series.integral);
    if (timestamp <= previousTimestamp) {
      if (timestamp < start) return null;
      return aggregates(integral, series.lateStart);
    }

    if (timestamp < start) {
      series.lastTimestamp = timestamp.toString();
      series.lastPrice = spot.toString();
      series.integral = "0";
      await this.save();
      return null;
    }

    const segmentStart = previousTimestamp < start ? start : previousTimestamp;
    let priceAtSegmentStart = previousPrice;
    let lateStart = false;
    if (previousTimestamp < start) {
      // Interpolate the boundary observation between the last pre-window price
      // and this price. This avoids a discontinuity when the daemon was healthy.
      priceAtSegmentStart = interpolate(previousTimestamp, previousPrice, timestamp, spot, start);
    } else if (previousTimestamp > start && integral === 0n) {
      // State was first created after the window began. Backfill the missing
      // interval with the first observed price and surface that fact in logs.
      integral = previousPrice * (previousTimestamp - start);
      lateStart = true;
      series.lateStart = true;
    }
    integral += trapezoid(priceAtSegmentStart, spot, timestamp - segmentStart);

    series.lastTimestamp = timestamp.toString();
    series.lastPrice = spot.toString();
    series.integral = integral.toString();
    state.series = state.series.filter((entry) => BigInt(entry.expiry) >= timestamp);
    await this.save();
    return aggregates(integral, series.lateStart || lateStart);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.state) return;
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as TwapState;
      if (parsed.version !== STATE_VERSION || parsed.chainId !== this.chainId || !Array.isArray(parsed.series)) {
        throw new Error("incompatible TWAP state");
      }
      for (const series of parsed.series) {
        BigInt(series.expiry);
        BigInt(series.lastTimestamp);
        BigInt(series.lastPrice);
        BigInt(series.integral);
        series.lateStart ??= false;
      }
      this.state = parsed;
      this.log(`settlement TWAP state loaded path=${this.statePath} series=${parsed.series.length}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`cannot load settlement TWAP state: ${(error as Error).message}`);
      }
      this.state = { version: STATE_VERSION, chainId: this.chainId, series: [] };
      this.log(`settlement TWAP state initialized path=${this.statePath} series=0`);
    }
  }

  private async save(): Promise<void> {
    const state = this.requireState();
    state.series.sort((a, b) => {
      const left = BigInt(a.expiry);
      const right = BigInt(b.expiry);
      return left < right ? -1 : left > right ? 1 : 0;
    });
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.statePath);
  }

  private requireState(): TwapState {
    if (!this.state) throw new Error("settlement TWAP tracker is not initialized");
    return this.state;
  }
}

function aggregates(integral: bigint, lateStart: boolean): SettlementAggregates {
  return {
    settlementStartAggregate: AGGREGATE_BASELINE,
    // LyraForwardFeed requires current > start even at the exact first second.
    currentSpotAggregate: AGGREGATE_BASELINE + (integral > 0n ? integral : 1n),
    lateStart,
  };
}

function trapezoid(leftPrice: bigint, rightPrice: bigint, duration: bigint): bigint {
  if (duration <= 0n) return 0n;
  return ((leftPrice + rightPrice) * duration) / 2n;
}

function interpolate(
  leftTime: bigint,
  leftPrice: bigint,
  rightTime: bigint,
  rightPrice: bigint,
  targetTime: bigint,
): bigint {
  const duration = rightTime - leftTime;
  if (duration <= 0n) return rightPrice;
  return leftPrice + ((rightPrice - leftPrice) * (targetTime - leftTime)) / duration;
}
