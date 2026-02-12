import { type NextRequest, NextResponse } from "next/server";

const DERIVE_ENV = process.env.NEXT_PUBLIC_DERIVE_ENV ?? "mainnet";
const DERIVE_API_URL =
  DERIVE_ENV === "mainnet"
    ? "https://api.lyra.finance"
    : "https://api-demo.lyra.finance";

/**
 * Transparent proxy to Derive API.
 * Explicitly forwards X-Lyra* auth headers that Next.js rewrites may strip.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const derivePath = path.join("/");
  const url = `${DERIVE_API_URL}/${derivePath}`;

  // Read request body
  const body = await request.text();

  // Build outgoing headers — forward auth headers explicitly
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const lyraWallet = request.headers.get("X-LyraWallet") ?? request.headers.get("x-lyrawallet");
  const lyraTimestamp = request.headers.get("X-LyraTimestamp") ?? request.headers.get("x-lyratimestamp");
  const lyraSignature = request.headers.get("X-LyraSignature") ?? request.headers.get("x-lyrasignature");

  if (lyraWallet) headers["X-LyraWallet"] = lyraWallet;
  if (lyraTimestamp) headers["X-LyraTimestamp"] = lyraTimestamp;
  if (lyraSignature) headers["X-LyraSignature"] = lyraSignature;

  // Server-side debug logging
  if (derivePath.startsWith("private/")) {
    console.log(`[Derive Proxy] ${derivePath} — forwarding auth:`, {
      wallet: lyraWallet,
      timestamp: lyraTimestamp,
      sig_len: lyraSignature?.length,
      sig_prefix: lyraSignature?.slice(0, 10),
      url,
    });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    const responseBody = await res.text();

    return new NextResponse(responseBody, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (err) {
    console.error(`[Derive Proxy] ${derivePath} failed:`, err);
    return NextResponse.json(
      { error: { code: -1, message: `Proxy error: ${(err as Error).message}` } },
      { status: 502 }
    );
  }
}
