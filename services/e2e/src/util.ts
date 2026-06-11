import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export { sleep };

// ---------------------------------------------------------------------------
// Child-process management — every process we start is tracked and killed.
// ---------------------------------------------------------------------------

export interface Proc {
  name: string;
  child: ChildProcess;
  /** captured stdout+stderr lines */
  lines: string[];
  exited: Promise<number | null>;
}

export class ProcManager {
  readonly procs: Proc[] = [];
  private readonly quietPatterns: RegExp[] = [];

  spawnProc(
    name: string,
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {},
  ): Proc {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines: string[] = [];
    const onData = (d: Buffer) => {
      for (const l of d.toString().split("\n")) {
        const t = l.trimEnd();
        if (!t) continue;
        lines.push(t);
        if (!opts.quiet) console.log(`  | [${name}] ${t}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", () => resolve(null));
    });
    const proc: Proc = { name, child, lines, exited };
    this.procs.push(proc);
    console.log(`[e2e] started ${name} (pid ${child.pid}): ${cmd} ${args.join(" ")}`);
    return proc;
  }

  /** Run to completion; throw on non-zero exit. */
  async run(
    name: string,
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean; timeoutMs?: number } = {},
  ): Promise<Proc> {
    const proc = this.spawnProc(name, cmd, args, opts);
    const code = await Promise.race([
      proc.exited,
      sleep(opts.timeoutMs ?? 300_000).then(() => "timeout" as const),
    ]);
    if (code === "timeout") {
      proc.child.kill("SIGKILL");
      throw new Error(`${name} timed out after ${(opts.timeoutMs ?? 300_000) / 1000}s`);
    }
    if (code !== 0) {
      throw new Error(`${name} exited with code ${code}\nlast output:\n${proc.lines.slice(-20).join("\n")}`);
    }
    return proc;
  }

  /** Stop only the named processes (e.g. services, keeping anvil alive). */
  async stop(names: string[]): Promise<void> {
    await this.killProcs(this.procs.filter((p) => names.includes(p.name)));
  }

  async killAll(): Promise<void> {
    await this.killProcs(this.procs);
  }

  private async killProcs(procs: Proc[]): Promise<void> {
    for (const proc of [...procs].reverse()) {
      if (proc.child.exitCode !== null || proc.child.signalCode !== null) continue;
      console.log(`[e2e] stopping ${proc.name} (pid ${proc.child.pid})`);
      proc.child.kill("SIGTERM");
      const code = await Promise.race([proc.exited, sleep(3000).then(() => "timeout" as const)]);
      if (code === "timeout") {
        console.log(`[e2e] SIGKILL ${proc.name}`);
        proc.child.kill("SIGKILL");
        await Promise.race([proc.exited, sleep(2000)]);
      }
    }
  }

  /** PIDs of children still running (should be empty after killAll). */
  alivePids(): number[] {
    return this.procs
      .filter((p) => p.child.exitCode === null && p.child.signalCode === null && p.child.pid)
      .map((p) => p.child.pid!);
  }
}

// ---------------------------------------------------------------------------
// Polling helpers
// ---------------------------------------------------------------------------

export async function waitFor(
  what: string,
  fn: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 250;
  const start = Date.now();
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      // keep polling
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(intervalMs);
  }
}

export async function httpJson<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T;
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export class AssertionError extends Error {}

export function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new AssertionError(`ASSERT FAILED: ${msg}`);
}

export function assertEq(actual: bigint, expected: bigint, label: string): void {
  assert(
    actual === expected,
    `${label}: expected ${expected.toString()}, got ${actual.toString()}`,
  );
}

/** |actual - expected| <= tol */
export function assertApprox(actual: bigint, expected: bigint, tol: bigint, label: string): void {
  const diff = actual > expected ? actual - expected : expected - actual;
  assert(
    diff <= tol,
    `${label}: expected ~${expected.toString()} (tol ${tol.toString()}), got ${actual.toString()} (diff ${diff.toString()})`,
  );
}

// ---------------------------------------------------------------------------
// Markdown report builder (written to protocol/E2E.md)
// ---------------------------------------------------------------------------

export interface StageLog {
  title: string;
  status: "passed" | "failed" | "skipped";
  lines: string[];
  note(text: string): void;
  tx(label: string, hash: string): void;
  table(header: string[], rows: string[][]): void;
}

export class Report {
  readonly stages: StageLog[] = [];
  meta: Record<string, string> = {};

  stage(title: string): StageLog {
    const stage: StageLog = {
      title,
      status: "failed",
      lines: [],
      note(text: string) {
        this.lines.push(text);
        console.log(`[e2e]   ${text.replaceAll("`", "")}`);
      },
      tx(label: string, hash: string) {
        this.lines.push(`- ${label}: tx \`${hash}\``);
        console.log(`[e2e]   ${label}: tx ${hash}`);
      },
      table(header: string[], rows: string[][]) {
        this.lines.push("");
        this.lines.push(`| ${header.join(" | ")} |`);
        this.lines.push(`| ${header.map(() => "---").join(" | ")} |`);
        for (const row of rows) this.lines.push(`| ${row.join(" | ")} |`);
        this.lines.push("");
      },
    };
    this.stages.push(stage);
    console.log(`\n[e2e] ===== STAGE: ${title} =====`);
    return stage;
  }

  render(overall: "PASSED" | "FAILED"): string {
    const out: string[] = [];
    out.push("# sats-options E2E acceptance run");
    out.push("");
    out.push(`**Result: ${overall}**`);
    out.push("");
    for (const [k, v] of Object.entries(this.meta)) out.push(`- ${k}: ${v}`);
    out.push("");
    for (const [i, s] of this.stages.entries()) {
      const icon = s.status === "passed" ? "PASS" : s.status === "skipped" ? "SKIP" : "FAIL";
      out.push(`## Stage ${i + 1}: ${s.title} — ${icon}`);
      out.push("");
      out.push(...s.lines);
      out.push("");
    }
    return out.join("\n");
  }
}
