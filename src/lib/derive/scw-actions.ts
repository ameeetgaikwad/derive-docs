import { encodeFunctionData, zeroAddress } from "viem";
import { getConfig } from "./constants";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

// Session key expiry: ~317 years from now (effectively never)
const SESSION_KEY_EXPIRY = 9999999999n;

/**
 * Encode registerSessionKey(address,uint256) calldata.
 * Registers the given address (typically EOA) as a session key on the Matching contract.
 */
export function encodeRegisterSessionKey(sessionKeyAddress: `0x${string}`) {
  const config = getConfig();
  return {
    target: config.matching as `0x${string}`,
    value: 0n,
    data: encodeFunctionData({
      abi: [{
        name: "registerSessionKey",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "sessionKey", type: "address" },
          { name: "expiry", type: "uint256" },
        ],
        outputs: [],
      }],
      functionName: "registerSessionKey",
      args: [sessionKeyAddress, SESSION_KEY_EXPIRY],
    }),
  };
}

/**
 * Encode ERC-20 approve(address,uint256) calldata for a token.
 */
function encodeApprove(token: `0x${string}`, spender: `0x${string}`) {
  return {
    target: token,
    value: 0n,
    data: encodeFunctionData({
      abi: [{
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
      }],
      functionName: "approve",
      args: [spender, MAX_UINT256],
    }),
  };
}

/**
 * Encode createAndDepositSubAccount(address,uint256,address) calldata.
 * Creates a new subaccount with no initial deposit.
 */
export function encodeCreateSubaccount() {
  const config = getConfig();
  return {
    target: config.subaccountCreator as `0x${string}`,
    value: 0n,
    data: encodeFunctionData({
      abi: [{
        name: "createAndDepositSubAccount",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "manager", type: "address" },
        ],
        outputs: [],
      }],
      functionName: "createAndDepositSubAccount",
      args: [zeroAddress, 0n, config.standardManager],
    }),
  };
}

export type ScwAction = { target: `0x${string}`; value: bigint; data: `0x${string}` };

/**
 * Build the full bundle of SCW actions for onboarding:
 * 1. Register EOA as session key
 * 2. Approve deposit module for USDC
 * 3. Approve withdraw wrapper for USDC
 * 4. Create subaccount
 */
export function buildOnboardingActions(eoaAddress: `0x${string}`): ScwAction[] {
  const config = getConfig();
  return [
    encodeRegisterSessionKey(eoaAddress),
    encodeApprove(config.usdcAddress, config.depositModule),
    encodeApprove(config.usdcAddress, config.withdrawWrapper),
    encodeCreateSubaccount(),
  ];
}
