import { NextResponse } from "next/server";
import { recoverMessageAddress } from "viem";

/**
 * Debug endpoint: Tests Derive API auth from the server side.
 * Call with POST body: { wallet, timestamp, signature, eoa }
 *
 * 1. Does ecrecover on the signature to verify it matches the EOA
 * 2. Forwards to Derive API to test auth
 */
export async function POST(request: Request) {
  const { wallet, timestamp, signature, eoa } = await request.json();

  // Step 1: Verify the signature locally via ecrecover
  let recoveredAddress: string | null = null;
  let ecrecoverError: string | null = null;
  try {
    // Derive expects personal_sign of the timestamp string (EIP-191)
    // The signature we receive may or may not have 0x prefix
    const sigHex = signature.startsWith("0x") ? signature : `0x${signature}`;
    recoveredAddress = await recoverMessageAddress({
      message: timestamp,
      signature: sigHex as `0x${string}`,
    });
  } catch (err) {
    ecrecoverError = (err as Error).message;
  }

  // Step 2: Forward to Derive API
  const DERIVE_API_URL = "https://api.lyra.finance";
  const url = `${DERIVE_API_URL}/private/get_account`;

  // Ensure signature has no 0x prefix for Derive
  const sigNoPrefix = signature.startsWith("0x") ? signature.slice(2) : signature;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-LyraWallet": wallet,
    "X-LyraTimestamp": timestamp,
    "X-LyraSignature": sigNoPrefix,
  };

  console.log("[test-auth] Local ecrecover:", {
    recovered: recoveredAddress,
    expected_eoa: eoa,
    match: recoveredAddress?.toLowerCase() === eoa?.toLowerCase(),
    ecrecoverError,
  });

  console.log("[test-auth] Sending to Derive:", {
    url,
    wallet,
    timestamp,
    sig_len: sigNoPrefix.length,
    sig_starts: sigNoPrefix.slice(0, 20),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ wallet }),
    });

    const text = await res.text();
    console.log("[test-auth] Response:", res.status, text.slice(0, 300));

    return NextResponse.json({
      // Ecrecover results
      ecrecover: {
        recovered_address: recoveredAddress,
        expected_eoa: eoa,
        match: recoveredAddress?.toLowerCase() === eoa?.toLowerCase(),
        error: ecrecoverError,
      },
      // Derive API results
      derive: {
        status: res.status,
        is_html: text.startsWith("<"),
        response: text.slice(0, 500),
      },
      // What was sent
      headers_sent: {
        wallet,
        timestamp,
        sig_len: sigNoPrefix.length,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ecrecover: {
        recovered_address: recoveredAddress,
        expected_eoa: eoa,
        match: recoveredAddress?.toLowerCase() === eoa?.toLowerCase(),
        error: ecrecoverError,
      },
      derive_error: (err as Error).message,
    }, { status: 500 });
  }
}
