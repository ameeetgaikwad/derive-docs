import { NextRequest, NextResponse } from "next/server";
import { getTradeHistory } from "@/lib/derive/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.instrument_name) {
      return NextResponse.json(
        { error: "instrument_name required" },
        { status: 400 }
      );
    }
    const result = await getTradeHistory({
      instrument_name: body.instrument_name,
      count: body.count || 100,
    });
    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Trades API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
