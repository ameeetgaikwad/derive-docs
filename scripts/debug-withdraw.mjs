/**
 * Debug script: Recompute all intermediate withdrawal hashes
 * and verify signature recovery using the exact values from the console log.
 *
 * Usage: node scripts/debug-withdraw.mjs
 */
import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters, encodePacked, recoverAddress } from "viem";

// ===== Values from the user's console log =====
const SUBACCOUNT_ID = 61900n;
const NONCE = 1770955727627114n;
const SIGNATURE_EXPIRY_SEC = 1770956327n;
const SIGNER = "0x339e6B900391B0996A9ffc64F75F0034581D715c";
const WALLET = "0x6c808Eadd7745ef9dFa66d22C13A6a7DA09dbd9A"; // owner = SCW
const AMOUNT_HUMAN = "1"; // 1 USDC
const SIGNATURE = "0xe03f64291c0603ce4e61508766b9348a62aa521fd3313d2cf39264ee73f0a96c6cfd636f46189b9109a8ab28913264d93e2551e53b4e36723f61410eff6fd3b71c";

// ===== Mainnet constants =====
const WITHDRAWAL_MODULE = "0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083";
const USDC_ADDRESS = "0x6879287835A86F50f784313dBEd5E5cCC5bb8481";
const DOMAIN_SEPARATOR = "0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b";
const ACTION_TYPEHASH = "0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17";

// ===== USDC has 6 decimals =====
const USDC_DECIMALS = 6;

function toTokenAmount(value, decimals) {
  const [intPart, decPart = ""] = value.split(".");
  const paddedDec = decPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intPart) * BigInt(10 ** decimals) + BigInt(paddedDec);
}

// Step 1: Encode withdraw data
const scaledAmount = toTokenAmount(AMOUNT_HUMAN, USDC_DECIMALS);
console.log("=== Step 1: Encode Withdraw Data ===");
console.log("Scaled amount:", scaledAmount.toString(), `(${AMOUNT_HUMAN} USDC * 10^${USDC_DECIMALS})`);
console.log("USDC address:", USDC_ADDRESS);

const withdrawData = encodeAbiParameters(
  parseAbiParameters("address, uint256"),
  [USDC_ADDRESS, scaledAmount]
);
console.log("Encoded withdraw data:", withdrawData);

// Step 2: Hash the encoded data
const dataHash = keccak256(withdrawData);
console.log("\n=== Step 2: Hash Encoded Data ===");
console.log("keccak256(withdrawData):", dataHash);

// Step 3: Compute action hash
console.log("\n=== Step 3: Compute Action Hash ===");
console.log("ACTION_TYPEHASH:", ACTION_TYPEHASH);
console.log("subaccountId:", SUBACCOUNT_ID.toString());
console.log("nonce:", NONCE.toString());
console.log("module:", WITHDRAWAL_MODULE);
console.log("dataHash:", dataHash);
console.log("expiry:", SIGNATURE_EXPIRY_SEC.toString());
console.log("owner:", WALLET);
console.log("signer:", SIGNER);

const actionHashInput = encodeAbiParameters(
  parseAbiParameters("bytes32, uint256, uint256, address, bytes32, uint256, address, address"),
  [
    ACTION_TYPEHASH,
    SUBACCOUNT_ID,
    NONCE,
    WITHDRAWAL_MODULE,
    dataHash,
    SIGNATURE_EXPIRY_SEC,
    WALLET,
    SIGNER,
  ]
);
const actionHash = keccak256(actionHashInput);
console.log("Action hash:", actionHash);

// Step 4: Compute typed data hash
console.log("\n=== Step 4: Compute Typed Data Hash ===");
console.log("DOMAIN_SEPARATOR:", DOMAIN_SEPARATOR);
const typedDataHash = keccak256(
  encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", DOMAIN_SEPARATOR, actionHash])
);
console.log("Typed data hash:", typedDataHash);

// Step 5: Recover signer from signature
console.log("\n=== Step 5: Verify Signature ===");
console.log("Signature (with 0x):", SIGNATURE);
console.log("Signature length:", SIGNATURE.length - 2, "hex chars");

try {
  const recovered = await recoverAddress({
    hash: typedDataHash,
    signature: SIGNATURE,
  });
  console.log("Recovered address:", recovered);
  console.log("Expected signer:", SIGNER);
  console.log("MATCH:", recovered.toLowerCase() === SIGNER.toLowerCase());
} catch (e) {
  console.error("Recovery failed:", e.message);
}

// Step 6: Also try with "uint" instead of "uint256" (Python SDK uses "uint")
console.log("\n=== Step 6: Alternative Encoding (uint vs uint256) ===");
// In ABI encoding, uint and uint256 are identical. But let's verify.
const withdrawDataAlt = encodeAbiParameters(
  parseAbiParameters("address, uint256"),
  [USDC_ADDRESS, scaledAmount]
);
console.log("Same encoding (uint = uint256):", withdrawData === withdrawDataAlt);

// Step 7: Try WITHOUT scaling (raw "1" as amount) to see what happens
console.log("\n=== Step 7: Try Without Scaling (amount=1 raw) ===");
const withdrawDataNoScale = encodeAbiParameters(
  parseAbiParameters("address, uint256"),
  [USDC_ADDRESS, 1n]
);
const dataHashNoScale = keccak256(withdrawDataNoScale);
const actionHashNoScale = keccak256(
  encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint256, address, bytes32, uint256, address, address"),
    [ACTION_TYPEHASH, SUBACCOUNT_ID, NONCE, WITHDRAWAL_MODULE, dataHashNoScale, SIGNATURE_EXPIRY_SEC, WALLET, SIGNER]
  )
);
const typedDataHashNoScale = keccak256(
  encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", DOMAIN_SEPARATOR, actionHashNoScale])
);
try {
  const recoveredNoScale = await recoverAddress({ hash: typedDataHashNoScale, signature: SIGNATURE });
  console.log("Without scaling - recovered:", recoveredNoScale);
  console.log("Without scaling - MATCH:", recoveredNoScale.toLowerCase() === SIGNER.toLowerCase());
} catch (e) {
  console.log("Without scaling - recovery failed:", e.message);
}

// Step 8: Try with 18 decimals (WAD) instead of 6
console.log("\n=== Step 8: Try With 18 Decimals ===");
const scaledAmount18 = toTokenAmount(AMOUNT_HUMAN, 18);
console.log("Scaled amount (18 dec):", scaledAmount18.toString());
const withdrawData18 = encodeAbiParameters(
  parseAbiParameters("address, uint256"),
  [USDC_ADDRESS, scaledAmount18]
);
const dataHash18 = keccak256(withdrawData18);
const actionHash18 = keccak256(
  encodeAbiParameters(
    parseAbiParameters("bytes32, uint256, uint256, address, bytes32, uint256, address, address"),
    [ACTION_TYPEHASH, SUBACCOUNT_ID, NONCE, WITHDRAWAL_MODULE, dataHash18, SIGNATURE_EXPIRY_SEC, WALLET, SIGNER]
  )
);
const typedDataHash18 = keccak256(
  encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", DOMAIN_SEPARATOR, actionHash18])
);
try {
  const recovered18 = await recoverAddress({ hash: typedDataHash18, signature: SIGNATURE });
  console.log("18 decimals - recovered:", recovered18);
  console.log("18 decimals - MATCH:", recovered18.toLowerCase() === SIGNER.toLowerCase());
} catch (e) {
  console.log("18 decimals - recovery failed:", e.message);
}
