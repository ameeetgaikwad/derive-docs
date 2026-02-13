import { UNIT, getConfig } from "./constants";
import { encodeAbiParameters, parseAbiParameters, getAddress, type Hex } from "viem";

/**
 * Convert a decimal string to 18-decimal bigint.
 * e.g., "1.5" → 1500000000000000000n
 */
export function toBN(value: string | number): bigint {
  const str = typeof value === "number" ? value.toString() : value;
  const [intPart, decPart = ""] = str.split(".");
  const paddedDec = decPart.padEnd(18, "0").slice(0, 18);
  const negative = intPart.startsWith("-");
  const absInt = negative ? intPart.slice(1) : intPart;
  const raw = BigInt(absInt) * UNIT + BigInt(paddedDec);
  return negative ? -raw : raw;
}

/**
 * Convert an 18-decimal bigint to human-readable string.
 * e.g., 1500000000000000000n → "1.5"
 */
export function fromBN(value: bigint, decimals = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const intPart = abs / UNIT;
  const decPart = abs % UNIT;
  const decStr = decPart.toString().padStart(18, "0").slice(0, decimals);
  const result = decimals > 0 ? `${intPart}.${decStr}` : `${intPart}`;
  return negative ? `-${result}` : result;
}

/**
 * Parse instrument name into components.
 * e.g., "ETH-20240628-3500-C" → { currency: "ETH", expiry: "20240628", strike: "3500", optionType: "C" }
 */
export function parseInstrumentName(name: string) {
  const parts = name.split("-");
  if (parts.length === 4) {
    return {
      currency: parts[0],
      expiry: parts[1],
      strike: parts[2],
      optionType: parts[3] as "C" | "P",
    };
  }
  if (parts.length === 2) {
    return {
      currency: parts[0],
      type: parts[1], // "PERP" or asset name
    };
  }
  return { raw: name };
}

/**
 * Format instrument name for display.
 * e.g., "ETH-20240628-3500-C" → "ETH $3,500 Call Jun 28"
 */
export function formatInstrumentName(name: string): string {
  const parsed = parseInstrumentName(name);
  if ("optionType" in parsed && parsed.optionType) {
    const strike = Number(parsed.strike).toLocaleString();
    const date = formatExpiryDate(parsed.expiry!);
    const type = parsed.optionType === "C" ? "Call" : "Put";
    return `${parsed.currency} $${strike} ${type} ${date}`;
  }
  if ("type" in parsed && parsed.type === "PERP") {
    return `${parsed.currency} Perpetual`;
  }
  return name;
}

/**
 * Format expiry string "20240628" → "Jun 28"
 */
export function formatExpiryDate(expiry: string): string {
  const year = expiry.slice(0, 4);
  const month = expiry.slice(4, 6);
  const day = expiry.slice(6, 8);
  const date = new Date(`${year}-${month}-${day}`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format expiry timestamp to readable string.
 */
export function formatExpiryTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Calculate days until expiry.
 */
export function daysUntilExpiry(expiryTimestamp: number): number {
  const now = Date.now() / 1000;
  const diff = expiryTimestamp - now;
  return Math.max(0, Math.ceil(diff / 86400));
}

/**
 * Format a USD price string for display.
 * Auto-selects decimal precision based on magnitude:
 *   >= $1      → 2 decimals  ($12.50)
 *   >= $0.01   → 4 decimals  ($0.1500)
 *   < $0.01    → 6 decimals  ($0.004500)
 * Pass explicit `decimals` to override.
 */
export function formatUsd(value: string | number, decimals?: number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const abs = Math.abs(num);
  const d = decimals ?? (abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6);
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/**
 * Format a token amount for display.
 */
export function formatAmount(value: string | number, decimals = 4): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Resolve the Derive smart contract wallet address from an EOA.
 * Calls LightAccountFactory.getAddress(owner, salt=0) on the Derive chain.
 * The address is deterministic (CREATE2) so this works even for wallets that
 * haven't been deployed yet.
 */
export async function resolveDeriveSCW(eoa: `0x${string}`): Promise<`0x${string}`> {
  const config = getConfig();
  const factory = config.lightAccountFactory;

  // Encode getAddress(address,uint256) call data
  // Function selector: 0x8cb84e18
  const params = encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [eoa, 0n]
  );
  const callData = ("0x8cb84e18" + params.slice(2)) as Hex;

  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: factory, data: callData }, "latest"],
      id: 1,
    }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  // Result is abi-encoded address (32 bytes, address in last 20)
  const hex = json.result as string;
  const rawAddr = ("0x" + hex.slice(26)) as `0x${string}`;
  // Checksum the address for consistent comparison
  return getAddress(rawAddr);
}
