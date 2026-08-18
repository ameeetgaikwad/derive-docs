import {
  parseAbiItem,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { DirectoryChainReader, DirectoryEvent } from "./subaccount-directory.js";

const depositedSubaccountEvent = parseAbiItem(
  "event DepositedSubAccount(uint256 indexed accountId, address indexed owner)",
);
const withdrewSubaccountEvent = parseAbiItem(
  "event WithdrewSubAccount(uint256 indexed accountId)",
);

/** Read Matching directory events through a viem public client. */
export class ViemDirectoryChainReader implements DirectoryChainReader {
  constructor(
    private readonly publicClient: Pick<PublicClient, "getBlockNumber" | "getBlock" | "getLogs">,
    private readonly matching: Address,
  ) {}

  async getBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.publicClient.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`block ${blockNumber} has no hash`);
    return block.hash;
  }

  async getEvents(fromBlock: bigint, toBlock: bigint): Promise<DirectoryEvent[]> {
    const logs = await this.publicClient.getLogs({
      address: this.matching,
      events: [depositedSubaccountEvent, withdrewSubaccountEvent],
      fromBlock,
      toBlock,
      strict: true,
    });
    return logs.map((log) => {
      if (
        log.blockNumber === null ||
        log.transactionIndex === null ||
        log.logIndex === null ||
        log.transactionHash === null
      ) {
        throw new Error("pending Matching log cannot be indexed");
      }
      const position = {
        blockNumber: log.blockNumber,
        transactionIndex: log.transactionIndex,
        logIndex: log.logIndex,
        transactionHash: log.transactionHash,
      };
      if (log.eventName === "DepositedSubAccount") {
        return {
          ...position,
          type: "deposited" as const,
          accountId: log.args.accountId,
          owner: log.args.owner,
        };
      }
      return {
        ...position,
        type: "withdrew" as const,
        accountId: log.args.accountId,
      };
    });
  }
}
