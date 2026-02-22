export const runtime = "edge";

const DERIVE_API_KEY = process.env.DERIVE_API_KEY;

const CREATE_ACCOUNT_URLS: Record<string, string> = {
  testnet: "https://testnet.derive.xyz/api/public/create-account",
  mainnet: "https://app.derive.xyz/api/public/create-account",
};

export async function POST(req: Request) {
  if (!DERIVE_API_KEY) {
    return Response.json(
      { error: "API key not configured" },
      { status: 503 },
    );
  }

  try {
    const { address } = await req.json();

    if (!address) {
      return Response.json(
        { error: "address is required" },
        { status: 400 },
      );
    }

    const env = process.env.NEXT_PUBLIC_DERIVE_ENV || "mainnet";
    const createAccountUrl = CREATE_ACCOUNT_URLS[env] ?? CREATE_ACCOUNT_URLS.mainnet;

    console.log(`[CreateAccount] POST ${createAccountUrl} for ${address}`);
    const res = await fetch(createAccountUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        Authorization: `Bearer ${DERIVE_API_KEY}`,
      },
      body: JSON.stringify({ address }),
    });

    const text = await res.text();
    console.log(`[CreateAccount] ${createAccountUrl} → ${res.status} body=${text.slice(0, 500)}`);

    if (!res.ok) {
      return Response.json(
        { error: `Create account failed: ${text}` },
        { status: res.status },
      );
    }

    const data = JSON.parse(text);
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: `Create account proxy error: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
