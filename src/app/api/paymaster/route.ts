import { NextRequest, NextResponse } from "next/server";

const DERIVE_PAYMASTER_SECRET = process.env.DERIVE_PAYMASTER_SECRET;

// Paymaster endpoints per environment
const PAYMASTER_URLS: Record<string, string> = {
  testnet: "https://testnet.derive.xyz/api/paymaster",
  mainnet: "https://app.derive.xyz/api/paymaster",
};

export async function POST(req: NextRequest) {
  if (!DERIVE_PAYMASTER_SECRET) {
    return NextResponse.json(
      { error: "Paymaster not configured" },
      { status: 503 },
    );
  }

  const env = process.env.NEXT_PUBLIC_DERIVE_ENV || "mainnet";
  const paymasterUrl = PAYMASTER_URLS[env] ?? PAYMASTER_URLS.mainnet;

  try {
    const body = await req.json();

    const res = await fetch(paymasterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        secret: DERIVE_PAYMASTER_SECRET,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Paymaster error: ${text}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: `Paymaster proxy error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
