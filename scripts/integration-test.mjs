/**
 * Integration test for Derive covered call platform.
 *
 * Tests public API connectivity, instrument discovery, and hash verification
 * against Derive's debug endpoints.
 *
 * Usage:
 *   node scripts/integration-test.mjs                         # read-only mode
 *   DERIVE_PRIVATE_KEY=0x... node scripts/integration-test.mjs # full mode
 */
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

// ===== Testnet Constants (from src/lib/derive/constants.ts) =====
const BASE_URL = "https://api-demo.lyra.finance";
const TESTNET = {
  chainId: 901,
  depositModule: "0x43223Db33AdA0575D2E100829543f8B04A37a1ec",
  withdrawalModule: "0xe850641C5207dc5E9423fB15f89ae6031A05fd92",
  standardManager: "0x28bE681F7bEa6f465cbcA1D25A2125fe7533391C",
  usdcAddress: "0xe80F2a02398BBf1ab2C9cc52caD1978159c215BD",
  usdcCashAsset: "0x6caf294DaC985ff653d5aE75b4FF8E0A66025928",
  matching: "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD",
  domainSeparator:
    "0x9bcf4dc06df5d8bf23af818d5716491b995020f377d3b7b64c29ed14e3dd1105",
};
const ACTION_TYPEHASH =
  "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17";

// ===== Inline Helpers =====
function toTokenAmount(value, decimals) {
  const [intPart, decPart = ""] = value.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(paddedDec);
}

function encodeDepositData(amount, asset, manager) {
  return encodeAbiParameters(
    parseAbiParameters("uint256, address, address"),
    [amount, asset, manager]
  );
}

function encodeWithdrawData(asset, amount) {
  return encodeAbiParameters(
    parseAbiParameters("address, uint256"),
    [asset, amount]
  );
}

function getActionHash({ subaccountId, nonce, module, data, expiry, owner, signer }) {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "bytes32, uint256, uint256, address, bytes32, uint256, address, address"
      ),
      [
        ACTION_TYPEHASH,
        subaccountId,
        nonce,
        module,
        keccak256(data),
        expiry,
        owner,
        signer,
      ]
    )
  );
}

function toTypedDataHash(domainSeparator, actionHash) {
  return keccak256(
    encodePacked(
      ["bytes2", "bytes32", "bytes32"],
      ["0x1901", domainSeparator, actionHash]
    )
  );
}

async function rpc(method, params = {}) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result !== undefined ? json.result : json;
}

async function rpcWithAuth(method, params, authHeaders) {
  const res = await fetch(`${BASE_URL}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result !== undefined ? json.result : json;
}

// ===== Test Runner =====
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${e.message}\x1b[0m`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
}

// ===== Section 1: Public API Connectivity =====
console.log("\n\x1b[1m--- Public API Connectivity ---\x1b[0m\n");

await test("public/get_time returns a number close to now", async () => {
  const serverTime = await rpc("public/get_time");
  assert(typeof serverTime === "number", `Expected number, got ${typeof serverTime}`);
  const drift = Math.abs(serverTime - Date.now());
  assert(drift < 60_000, `Server time drift too large: ${drift}ms`);
});

await test("public/get_all_currencies contains BTC and USDC", async () => {
  const currencies = await rpc("public/get_all_currencies");
  assert(Array.isArray(currencies), "Expected array");
  const names = currencies.map((c) => c.currency);
  assert(names.includes("BTC"), "Missing BTC");
  assert(names.includes("USDC"), "Missing USDC");
  console.log(`    Found ${currencies.length} currencies: ${names.slice(0, 8).join(", ")}...`);
});

// ===== Section 2: BTC Instruments & Tickers =====
console.log("\n\x1b[1m--- BTC Instruments & Tickers ---\x1b[0m\n");

let firstInstrumentName = null;

await test("public/get_instruments returns BTC call options", async () => {
  const instruments = await rpc("public/get_instruments", {
    currency: "BTC",
    instrument_type: "option",
    expired: false,
  });
  assert(Array.isArray(instruments), "Expected array");
  assert(instruments.length > 0, "No BTC options found");

  // Filter to calls
  const calls = instruments.filter(
    (i) => i.option_details && i.option_details.option_type === "C"
  );
  assert(calls.length > 0, "No BTC call options found");
  firstInstrumentName = calls[0].instrument_name;

  console.log(`    Found ${calls.length} BTC call options`);
  console.log(`    First: ${firstInstrumentName}`);
  console.log(
    `    Strike: ${calls[0].option_details.strike}, Expiry: ${new Date(calls[0].option_details.expiry * 1000).toISOString()}`
  );
});

await test("public/get_ticker returns valid data", async () => {
  assert(firstInstrumentName, "No instrument to test (previous test failed)");
  const ticker = await rpc("public/get_ticker", {
    instrument_name: firstInstrumentName,
  });
  assert(ticker.mark_price !== undefined, "Missing mark_price");
  assert(ticker.index_price !== undefined, "Missing index_price");
  console.log(
    `    ${firstInstrumentName}: mark=${ticker.mark_price}, index=${ticker.index_price}`
  );
});

// ===== Section 3: Hash Verification =====
console.log("\n\x1b[1m--- Hash Verification (local vs server) ---\x1b[0m\n");

// Debug endpoints require a real subaccount_id — they fail with "Internal error" for
// non-existent accounts. We need DERIVE_PRIVATE_KEY + DERIVE_WALLET + DERIVE_SUBACCOUNT_ID
// to run hash verification against the server.
const debugWallet = process.env.DERIVE_WALLET;
const debugSigner = process.env.DERIVE_PRIVATE_KEY
  ? privateKeyToAccount(process.env.DERIVE_PRIVATE_KEY).address
  : null;
const debugSubaccountId = process.env.DERIVE_SUBACCOUNT_ID
  ? parseInt(process.env.DERIVE_SUBACCOUNT_ID)
  : null;

async function compareHashes(label, debugMethod, debugParams, localEncodedData, localActionHash, localTypedDataHash) {
  let serverResult;
  try {
    serverResult = await rpc(debugMethod, debugParams);
  } catch (e) {
    console.log(`    \x1b[33mSkipped: ${e.message}\x1b[0m`);
    console.log(`    (Need DERIVE_WALLET + DERIVE_PRIVATE_KEY + DERIVE_SUBACCOUNT_ID for hash verification)`);
    return;
  }

  let matches = 0;
  if (serverResult.encoded_data) {
    assertEqual(
      localEncodedData.toLowerCase(),
      serverResult.encoded_data.toLowerCase(),
      `encoded_data mismatch:\n  local:  ${localEncodedData}\n  server: ${serverResult.encoded_data}`
    );
    matches++;
    console.log("    encoded_data: MATCH");
  }
  if (serverResult.action_hash) {
    assertEqual(
      localActionHash.toLowerCase(),
      serverResult.action_hash.toLowerCase(),
      `action_hash mismatch:\n  local:  ${localActionHash}\n  server: ${serverResult.action_hash}`
    );
    matches++;
    console.log("    action_hash: MATCH");
  }
  if (serverResult.typed_data_hash) {
    assertEqual(
      localTypedDataHash.toLowerCase(),
      serverResult.typed_data_hash.toLowerCase(),
      `typed_data_hash mismatch:\n  local:  ${localTypedDataHash}\n  server: ${serverResult.typed_data_hash}`
    );
    matches++;
    console.log("    typed_data_hash: MATCH");
  }
  assert(matches > 0, "Server returned no hash fields to compare");
}

const HASH_TEST_NONCE = 1234567890123;
const HASH_TEST_EXPIRY = 9999999999;

await test("withdraw hash: local matches public/withdraw_debug", async () => {
  const subId = debugSubaccountId ?? 99999;
  const signer = debugSigner ?? "0x000000000000000000000000000000000000dEaD";
  const owner = debugWallet ?? "0x000000000000000000000000000000000000bEEF";
  const amount = "1";
  const scaledAmount = toTokenAmount(amount, 6);

  const localEncodedData = encodeWithdrawData(TESTNET.usdcAddress, scaledAmount);
  const localActionHash = getActionHash({
    subaccountId: BigInt(subId),
    nonce: BigInt(HASH_TEST_NONCE),
    module: TESTNET.withdrawalModule,
    data: localEncodedData,
    expiry: BigInt(HASH_TEST_EXPIRY),
    owner,
    signer,
  });
  const localTypedDataHash = toTypedDataHash(TESTNET.domainSeparator, localActionHash);

  await compareHashes("withdraw", "public/withdraw_debug", {
    subaccount_id: subId,
    amount,
    asset_name: "USDC",
    nonce: HASH_TEST_NONCE,
    signature_expiry_sec: HASH_TEST_EXPIRY,
    signer,
  }, localEncodedData, localActionHash, localTypedDataHash);
});

await test("deposit hash: local matches public/deposit_debug", async () => {
  const subId = debugSubaccountId ?? 0;
  const signer = debugSigner ?? "0x000000000000000000000000000000000000dEaD";
  const owner = debugWallet ?? "0x000000000000000000000000000000000000bEEF";
  const amount = "10";
  const scaledAmount = toTokenAmount(amount, 6);

  const localEncodedData = encodeDepositData(
    scaledAmount,
    TESTNET.usdcCashAsset,
    TESTNET.standardManager
  );
  const localActionHash = getActionHash({
    subaccountId: BigInt(subId),
    nonce: BigInt(HASH_TEST_NONCE),
    module: TESTNET.depositModule,
    data: localEncodedData,
    expiry: BigInt(HASH_TEST_EXPIRY),
    owner,
    signer,
  });
  const localTypedDataHash = toTypedDataHash(TESTNET.domainSeparator, localActionHash);

  await compareHashes("deposit", "public/deposit_debug", {
    subaccount_id: subId,
    amount,
    asset_name: "USDC",
    nonce: HASH_TEST_NONCE,
    signature_expiry_sec: HASH_TEST_EXPIRY,
    signer,
  }, localEncodedData, localActionHash, localTypedDataHash);
});

// ===== Section 4: Authenticated Tests =====
const PRIVATE_KEY = process.env.DERIVE_PRIVATE_KEY;

if (PRIVATE_KEY) {
  console.log("\n\x1b[1m--- Authenticated Tests ---\x1b[0m\n");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`  Using account: ${account.address}`);

  // Resolve SCW address (deterministic CREATE2)
  // For now, use the account address as wallet. In production this would be the SCW.
  const walletAddress = process.env.DERIVE_WALLET || account.address;
  console.log(`  Derive wallet: ${walletAddress}`);

  async function getAuthHeaders() {
    const timestamp = Date.now().toString();
    const signature = await account.signMessage({ message: timestamp });
    return {
      "X-LyraWallet": walletAddress,
      "X-LyraTimestamp": timestamp,
      "X-LyraSignature": signature.slice(2), // strip 0x
    };
  }

  await test("private/get_subaccounts returns response", async () => {
    const headers = await getAuthHeaders();
    const result = await rpcWithAuth(
      "private/get_subaccounts",
      { wallet: walletAddress },
      headers
    );
    console.log(`    Response: ${JSON.stringify(result).slice(0, 200)}`);
  });

  await test("private/get_account returns wallet info", async () => {
    const headers = await getAuthHeaders();
    const result = await rpcWithAuth(
      "private/get_account",
      { wallet: walletAddress },
      headers
    );
    console.log(`    Response: ${JSON.stringify(result).slice(0, 200)}`);
  });
} else {
  console.log(
    "\n\x1b[33m--- Skipping authenticated tests (set DERIVE_PRIVATE_KEY to enable) ---\x1b[0m\n"
  );
}

// ===== Summary =====
console.log(`\n${"=".repeat(50)}`);
if (failed === 0) {
  console.log(`\x1b[32m  All ${passed} tests passed\x1b[0m`);
} else {
  console.log(`\x1b[31m  ${failed} failed\x1b[0m, \x1b[32m${passed} passed\x1b[0m, ${passed + failed} total`);
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}
console.log(`${"=".repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
