import { NextRequest, NextResponse } from "next/server";
import { submitOrder } from "@/lib/derive/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const wallet = req.headers.get("x-lyrawallet");
    const timestamp = req.headers.get("x-lyratimestamp");
    const signature = req.headers.get("x-lyrasignature");
    if (!wallet || !timestamp || !signature) {
      return NextResponse.json({ error: "Auth headers required (x-lyrawallet, x-lyratimestamp, x-lyrasignature)" }, { status: 401 });
    }
    const result = await submitOrder(body, { wallet, timestamp, signature });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
