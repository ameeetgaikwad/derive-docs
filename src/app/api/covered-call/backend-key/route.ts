import { NextRequest, NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// TODO: Replace with Vercel KV or encrypted persistent storage
const backendKeys = new Map<string, string>(); // deriveWallet -> privateKey

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { deriveWallet } = body as { deriveWallet: string };

  if (!deriveWallet) {
    return NextResponse.json({ error: "deriveWallet required" }, { status: 400 });
  }

  // Check if key already exists
  const existingKey = backendKeys.get(deriveWallet.toLowerCase());
  if (existingKey) {
    const account = privateKeyToAccount(existingKey as `0x${string}`);
    return NextResponse.json({ publicKey: account.address });
  }

  // Generate new key pair
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  // Store private key
  backendKeys.set(deriveWallet.toLowerCase(), privateKey);

  return NextResponse.json({ publicKey: account.address });
}

// GET endpoint to retrieve public key (for verification)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deriveWallet = searchParams.get("deriveWallet");

  if (!deriveWallet) {
    return NextResponse.json({ error: "deriveWallet required" }, { status: 400 });
  }

  const privateKey = backendKeys.get(deriveWallet.toLowerCase());
  if (!privateKey) {
    return NextResponse.json({ error: "No backend key found" }, { status: 404 });
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return NextResponse.json({ publicKey: account.address });
}
