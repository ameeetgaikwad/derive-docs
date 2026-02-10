import { NextRequest, NextResponse } from "next/server";
import { DERIVE_API_URL } from "@/lib/derive/constants";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet } = body;
    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }

    const res = await fetch(`${DERIVE_API_URL}/public/create_account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
