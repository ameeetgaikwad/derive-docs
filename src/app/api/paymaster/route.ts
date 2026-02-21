// Edge runtime avoids Vercel serverless IP blocking issues
export const runtime = "edge";

const DERIVE_PAYMASTER_SECRET = process.env.DERIVE_PAYMASTER_SECRET;

const PAYMASTER_URLS: Record<string, string> = {
  testnet: "https://testnet.derive.xyz/api/paymaster",
  mainnet: "https://app.derive.xyz/api/paymaster",
};

export async function POST(req: Request) {
  if (!DERIVE_PAYMASTER_SECRET) {
    return Response.json(
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
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        ...body,
        secret: DERIVE_PAYMASTER_SECRET,
      }),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error("[Paymaster] Derive returned error:", res.status, text);
      return Response.json(
        { error: `Paymaster error (${res.status}): ${text}` },
        { status: res.status },
      );
    }

    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Paymaster] Proxy error:", err);
    return Response.json(
      { error: `Paymaster proxy error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
