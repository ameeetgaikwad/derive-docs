import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { DynamoDbSubaccountDirectoryStore } from "../src/dynamodb-subaccount-directory.js";
import type { DirectoryEvent, DirectoryNetwork } from "../src/subaccount-directory.js";

const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const HASH = `0x${"aa".repeat(32)}` as Hex;
const TX_HASH = `0x${"11".repeat(32)}` as Hex;
const NETWORK: DirectoryNetwork = { chainId: 31337, matching: MATCHING, deploymentBlock: 10n };

function event(
  type: "deposited" | "withdrew",
  accountId: bigint,
  blockNumber: bigint,
): DirectoryEvent {
  const position = {
    accountId,
    blockNumber,
    transactionIndex: 0,
    logIndex: 0,
    transactionHash: TX_HASH,
  };
  return type === "deposited"
    ? { ...position, type, owner: OWNER }
    : { ...position, type };
}

type Item = Record<string, AttributeValue>;

class FakeDynamoClient {
  private readonly items = new Map<string, Item>();
  readonly operations: string[] = [];

  private key(item: Item): string {
    return `${item.networkKey?.S ?? ""}:${item.entityKey?.S ?? ""}`;
  }

  async send(command: object): Promise<Record<string, unknown>> {
    if (command instanceof PutItemCommand) {
      this.operations.push("put");
      const item = command.input.Item as Item;
      this.items.set(this.key(item), structuredClone(item));
      return {};
    }
    if (command instanceof DeleteItemCommand) {
      this.operations.push(`delete:${command.input.Key?.entityKey?.S ?? "unknown"}`);
      this.items.delete(this.key(command.input.Key as Item));
      return {};
    }
    if (command instanceof GetItemCommand) {
      this.operations.push("get");
      const item = this.items.get(this.key(command.input.Key as Item));
      return item ? { Item: structuredClone(item) } : {};
    }
    if (command instanceof QueryCommand) {
      this.operations.push("query");
      const values = command.input.ExpressionAttributeValues as Item;
      const rows = [...this.items.values()].filter((item) => {
        if (command.input.IndexName) {
          return item.ownerActiveKey?.S === values[":ownerActive"]?.S;
        }
        return item.networkKey?.S === values[":network"]?.S;
      });
      return { Items: structuredClone(rows) };
    }
    if (command instanceof BatchWriteItemCommand) {
      this.operations.push("batch-delete");
      for (const request of Object.values(command.input.RequestItems ?? {}).flat()) {
        if (request.DeleteRequest?.Key) this.items.delete(this.key(request.DeleteRequest.Key));
      }
      return { UnprocessedItems: {} };
    }
    throw new Error(`unsupported command ${command.constructor.name}`);
  }
}

describe("DynamoDbSubaccountDirectoryStore", () => {
  it("persists active-owner projection, checkpoint, and network reset", async () => {
    const client = new FakeDynamoClient();
    const store = new DynamoDbSubaccountDirectoryStore("directory-table", client as never);

    await store.applyEvent(NETWORK, event("deposited", 42n, 11n));
    await store.applyEvent(NETWORK, event("deposited", 57n, 12n));
    await store.applyEvent(NETWORK, event("withdrew", 42n, 13n));
    await store.setCheckpoint(NETWORK, {
      blockNumber: 15n,
      blockHash: HASH,
      ready: true,
    });

    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([57n]);
    await expect(store.getCheckpoint(NETWORK)).resolves.toEqual({
      blockNumber: 15n,
      blockHash: HASH,
      ready: true,
    });

    const resetOperation = client.operations.length;
    await store.reset(NETWORK);
    expect(client.operations.slice(resetOperation, resetOperation + 2)).toEqual([
      "delete:checkpoint",
      "query",
    ]);
    await expect(store.listActiveAccountIds(NETWORK, OWNER)).resolves.toEqual([]);
    await expect(store.getCheckpoint(NETWORK)).resolves.toBeNull();
  });
});
