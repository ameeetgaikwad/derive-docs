import { NextRequest, NextResponse } from "next/server";
import { getOrderBook } from "@/lib/derive/client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.instrument_name) {
      return NextResponse.json(
        { error: "instrument_name required" },
        { status: 400 }
      );
    }
    const raw = await getOrderBook({
      instrument_name: body.instrument_name,
      depth: body.depth || 10,
    });

    // Transform [price, amount] tuples into objects
    const result = {
      bids: (raw.bids || []).map(([price, amount]: [string, string]) => ({
        price,
        amount,
      })),
      asks: (raw.asks || []).map(([price, amount]: [string, string]) => ({
        price,
        amount,
      })),
    };

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Orderbook API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
