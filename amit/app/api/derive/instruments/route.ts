import { NextRequest, NextResponse } from "next/server";
import { getInstruments } from "@/lib/derive/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await getInstruments({
      currency: body.currency || "ETH",
      instrument_type: body.instrument_type,
      expired: body.expired ?? false,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
