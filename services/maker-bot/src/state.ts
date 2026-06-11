import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";

/** Persisted by --setup, read on normal start. */
export interface MakerState {
  chainId: number;
  owner: Address;
  subaccountId: string; // bigint as string
}

export function stateFilePath(file: string): string {
  return resolve(process.cwd(), file);
}

export function readState(file: string): MakerState | null {
  const p = stateFilePath(file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as MakerState;
}

export function writeState(file: string, state: MakerState): string {
  const p = stateFilePath(file);
  writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
  return p;
}
