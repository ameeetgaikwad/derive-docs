import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
        Options trading,
        <br />
        <span className="text-primary">simplified.</span>
      </h1>
      <p className="mt-6 max-w-md text-lg text-muted-foreground">
        Trade ETH options with strategies that make sense. Powered by Derive.
      </p>
      <div className="mt-10 flex items-center gap-4">
        <Link
          href="/trade"
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Start Trading
        </Link>
        <Link
          href="/strategies"
          className="inline-flex h-11 items-center justify-center rounded-md border border-border px-8 text-sm font-medium transition-colors hover:bg-secondary"
        >
          View Strategies
        </Link>
      </div>
    </div>
  );
}
