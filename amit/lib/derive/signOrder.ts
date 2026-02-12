import { type WalletClient, encodePacked, encodeAbiParameters, parseUnits, keccak256 } from "viem";
import { DERIVE_CHAIN_ID, TRADE_MODULE_ADDRESS, DEPOSIT_MODULE_ADDRESS, STANDARD_RISK_MANAGER_ADDRESS, USDC_ADDRESS } from "./constants";

export function generateNonce(): bigint {
  return BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
}

export function getExpiryTimestamp(minutesFromNow: number = 30): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutesFromNow * 60);
}

export function encodeTradeData(params: {
  instrument_name: string;
  direction: "buy" | "sell";
  limit_price: string;
  amount: string;
  max_fee: string;
  order_type: "limit" | "market";
}): `0x${string}` {
  const isBuy = params.direction === "buy";
  const limitPrice = parseUnits(params.limit_price, 18);
  const amount = parseUnits(params.amount, 18);
  const maxFee = parseUnits(params.max_fee, 18);

  return encodeAbiParameters(
    [
      { type: "string" },
      { type: "bool" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "string" },
      { type: "bool" },
    ],
    [
      params.instrument_name,
      isBuy,
      limitPrice,
      amount,
      maxFee,
      params.order_type,
      false, // mmp
    ]
  );
}

export async function signOrderViem(
  walletClient: WalletClient,
  params: {
    subaccount_id: number;
    instrument_name: string;
    direction: "buy" | "sell";
    limit_price: string;
    amount: string;
    max_fee: string;
    order_type: "limit" | "market";
    owner: string;
  }
): Promise<{
  signature: string;
  nonce: string;
  signature_expiry_sec: number;
  signer: string;
}> {
  const nonce = generateNonce();
  const expiry = getExpiryTimestamp(30);
  const account = walletClient.account;
  if (!account) throw new Error("No account on wallet client");

  const tradeData = encodeTradeData({
    instrument_name: params.instrument_name,
    direction: params.direction,
    limit_price: params.limit_price,
    amount: params.amount,
    max_fee: params.max_fee,
    order_type: params.order_type,
  });

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "Derive",
      version: "1",
      chainId: DERIVE_CHAIN_ID,
    },
    types: {
      Action: [
        { name: "subaccountId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "module", type: "address" },
        { name: "data", type: "bytes" },
        { name: "expiry", type: "uint256" },
        { name: "owner", type: "address" },
        { name: "signer", type: "address" },
      ],
    },
    primaryType: "Action",
    message: {
      subaccountId: BigInt(params.subaccount_id),
      nonce,
      module: TRADE_MODULE_ADDRESS as `0x${string}`,
      data: tradeData,
      expiry,
      owner: params.owner as `0x${string}`,
      signer: account.address,
    },
  });

  return {
    signature,
    nonce: nonce.toString(),
    signature_expiry_sec: Number(expiry),
    signer: account.address,
  };
}

/**
 * Sign a create-subaccount action (with 0 deposit) for Derive.
 * This creates a new empty subaccount under the wallet.
 */
export async function signCreateSubaccount(
  walletClient: WalletClient,
  params: { owner: string }
): Promise<{
  signature: string;
  nonce: string;
  signature_expiry_sec: number;
  signer: string;
}> {
  const nonce = generateNonce();
  const expiry = getExpiryTimestamp(30);
  const account = walletClient.account;
  if (!account) throw new Error("No account on wallet client");

  // Encode DepositModuleData: amount=0, asset=USDC, manager=StandardRiskManager
  const depositData = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
    ],
    [
      BigInt(0), // 0 deposit for empty subaccount
      USDC_ADDRESS as `0x${string}`,
      STANDARD_RISK_MANAGER_ADDRESS as `0x${string}`,
    ]
  );

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "Derive",
      version: "1",
      chainId: DERIVE_CHAIN_ID,
    },
    types: {
      Action: [
        { name: "subaccountId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "module", type: "address" },
        { name: "data", type: "bytes" },
        { name: "expiry", type: "uint256" },
        { name: "owner", type: "address" },
        { name: "signer", type: "address" },
      ],
    },
    primaryType: "Action",
    message: {
      subaccountId: BigInt(0), // 0 = create new
      nonce,
      module: DEPOSIT_MODULE_ADDRESS as `0x${string}`,
      data: keccak256(depositData),
      expiry,
      owner: params.owner as `0x${string}`,
      signer: account.address,
    },
  });

  return {
    signature,
    nonce: nonce.toString(),
    signature_expiry_sec: Number(expiry),
    signer: account.address,
  };
}
