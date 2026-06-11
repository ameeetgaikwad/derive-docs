import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";

/**
 * Loosely-typed deployment file: protocol/deployments/<chainId>.json.
 * Written by the contracts track's deploy scripts — shape may evolve, so we
 * only assume "string keys, mostly addresses, possibly nested".
 */
export type DeploymentsFile = {
  chainId?: number | string;
  [key: string]: unknown;
};

function candidateDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.SATS_DEPLOYMENTS_DIR) dirs.push(process.env.SATS_DEPLOYMENTS_DIR);

  // Walk up from both this module and cwd looking for protocol/deployments.
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      dirs.push(join(dir, "protocol", "deployments"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return dirs;
}

export function deploymentsPath(chainId: number): string | null {
  for (const dir of candidateDirs()) {
    const p = join(dir, `${chainId}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read protocol/deployments/<chainId>.json. Returns null if the file does not
 * exist yet (the contracts track may not have run).
 */
export function readDeployments(chainId: number): DeploymentsFile | null {
  const p = deploymentsPath(chainId);
  if (!p) return null;
  return JSON.parse(readFileSync(p, "utf8")) as DeploymentsFile;
}

/** Like readDeployments but throws a descriptive error when missing. */
export function requireDeployments(chainId: number): DeploymentsFile {
  const d = readDeployments(chainId);
  if (!d) {
    throw new Error(
      `No deployments file for chain ${chainId} (looked for protocol/deployments/${chainId}.json; ` +
        `set SATS_DEPLOYMENTS_DIR to override). Run the deploy script first.`,
    );
  }
  return d;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pull an address out of a deployments file by key, searching nested objects
 * one level deep (e.g. { matching: { matching: "0x..", rfqModule: "0x.." } }).
 */
export function getDeployedAddress(deployments: DeploymentsFile, key: string): Address {
  const direct = deployments[key];
  if (typeof direct === "string" && ADDRESS_RE.test(direct)) return direct as Address;

  for (const value of Object.values(deployments)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = (value as Record<string, unknown>)[key];
      if (typeof nested === "string" && ADDRESS_RE.test(nested)) return nested as Address;
    }
  }
  throw new Error(`Address "${key}" not found in deployments file`);
}
