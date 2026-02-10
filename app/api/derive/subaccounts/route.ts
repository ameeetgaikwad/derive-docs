import { NextRequest, NextResponse } from "next/server";
import { DERIVE_API_URL } from "@/lib/derive/constants";

export async function POST(req: NextRequest) {
  try {
    const wallet = req.headers.get("x-lyrawallet");
    const timestamp = req.headers.get("x-lyratimestamp");
    const signature = req.headers.get("x-lyrasignature");
    if (!wallet || !timestamp || !signature) {
      return NextResponse.json({ error: "Auth headers required" }, { status: 401 });
    }

    const res = await fetch(`${DERIVE_API_URL}/private/get_subaccounts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LyraWallet": wallet,
        "X-LyraTimestamp": timestamp,
        "X-LyraSignature": signature,
      },
      body: JSON.stringify({ wallet }),
    });

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json(
        { error: `Derive API returned non-JSON (status ${res.status})`, status: res.status },
        { status: res.status }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
