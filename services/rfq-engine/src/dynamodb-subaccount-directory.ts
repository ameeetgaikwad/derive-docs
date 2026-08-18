import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  type AttributeValue,
  type WriteRequest,
} from "@aws-sdk/client-dynamodb";
import type { Address, Hex } from "viem";
import type {
  DirectoryCheckpoint,
  DirectoryEvent,
  DirectoryNetwork,
  SubaccountDirectoryStore,
} from "./subaccount-directory.js";

export const SUBACCOUNT_OWNER_INDEX = "owner-active-index";

type Item = Record<string, AttributeValue>;

function networkKey(network: DirectoryNetwork): string {
  return `network#${network.chainId}#${network.matching.toLowerCase()}`;
}

function accountKey(accountId: bigint): string {
  return `account#${accountId}`;
}

function ownerActiveKey(network: DirectoryNetwork, owner: Address): string {
  return `${networkKey(network)}#owner#${owner.toLowerCase()}#active`;
}

function requireString(item: Item, name: string): string {
  const value = item[name]?.S;
  if (value === undefined) throw new Error(`directory item is missing string ${name}`);
  return value;
}

function requireNumber(item: Item, name: string): bigint {
  const value = item[name]?.N;
  if (value === undefined) throw new Error(`directory item is missing number ${name}`);
  return BigInt(value);
}

function existingPosition(item: Item): {
  blockNumber: bigint;
  transactionIndex: number;
  logIndex: number;
} {
  return {
    blockNumber: requireNumber(item, "updatedBlock"),
    transactionIndex: Number(requireNumber(item, "updatedTransactionIndex")),
    logIndex: Number(requireNumber(item, "updatedLogIndex")),
  };
}

function isNewer(event: DirectoryEvent, item: Item): boolean {
  const current = existingPosition(item);
  if (event.blockNumber !== current.blockNumber) return event.blockNumber > current.blockNumber;
  if (event.transactionIndex !== current.transactionIndex) {
    return event.transactionIndex > current.transactionIndex;
  }
  return event.logIndex > current.logIndex;
}

function isConditionalFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function newerCondition(requireExisting: boolean): string {
  const newer = [
    "#updatedBlock < :updatedBlock",
    "(#updatedBlock = :updatedBlock AND #updatedTransactionIndex < :updatedTransactionIndex)",
    "(#updatedBlock = :updatedBlock AND #updatedTransactionIndex = :updatedTransactionIndex AND #updatedLogIndex < :updatedLogIndex)",
  ].join(" OR ");
  return requireExisting
    ? `attribute_exists(#updatedBlock) AND (${newer})`
    : `attribute_not_exists(#updatedBlock) OR ${newer}`;
}

/** DynamoDB adapter for the durable subaccount projection and checkpoint. */
export class DynamoDbSubaccountDirectoryStore implements SubaccountDirectoryStore {
  constructor(
    private readonly tableName: string,
    private readonly client: Pick<DynamoDBClient, "send"> = new DynamoDBClient({}),
  ) {
    if (!tableName.trim()) throw new Error("subaccount directory table name is required");
  }

  async getCheckpoint(network: DirectoryNetwork): Promise<DirectoryCheckpoint | null> {
    const result = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: {
        networkKey: { S: networkKey(network) },
        entityKey: { S: "checkpoint" },
      },
      ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item) return null;
    return {
      blockNumber: requireNumber(item, "blockNumber"),
      blockHash: requireString(item, "blockHash") as Hex,
      ready: item.ready?.BOOL ?? false,
    };
  }

  async setCheckpoint(
    network: DirectoryNetwork,
    checkpoint: DirectoryCheckpoint,
  ): Promise<void> {
    try {
      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: {
          networkKey: { S: networkKey(network) },
          entityKey: { S: "checkpoint" },
          entity: { S: "checkpoint" },
          blockNumber: { N: checkpoint.blockNumber.toString() },
          blockHash: { S: checkpoint.blockHash },
          ready: { BOOL: checkpoint.ready },
        },
        ConditionExpression: "attribute_not_exists(#blockNumber) OR #blockNumber <= :blockNumber",
        ExpressionAttributeNames: { "#blockNumber": "blockNumber" },
        ExpressionAttributeValues: { ":blockNumber": { N: checkpoint.blockNumber.toString() } },
      }));
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }

  async applyEvent(network: DirectoryNetwork, event: DirectoryEvent): Promise<void> {
    const key = {
      networkKey: { S: networkKey(network) },
      entityKey: { S: accountKey(event.accountId) },
    } satisfies Item;
    const currentResult = await this.client.send(new GetItemCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: true,
    }));
    const current = currentResult.Item;
    if (current && !isNewer(event, current)) return;
    if (event.type === "withdrew" && !current) {
      throw new Error(`withdrawal for unknown subaccount ${event.accountId}`);
    }

    const owner = event.type === "deposited"
      ? event.owner
      : requireString(current as Item, "owner") as Address;
    const active = event.type === "deposited";
    const item: Item = {
      ...key,
      entity: { S: "account" },
      accountId: { N: event.accountId.toString() },
      owner: { S: owner.toLowerCase() },
      active: { BOOL: active },
      updatedBlock: { N: event.blockNumber.toString() },
      updatedTransactionIndex: { N: event.transactionIndex.toString() },
      updatedLogIndex: { N: event.logIndex.toString() },
      transactionHash: { S: event.transactionHash },
    };
    if (active) {
      item.ownerActiveKey = { S: ownerActiveKey(network, owner) };
    }

    try {
      await this.client.send(new PutItemCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: newerCondition(event.type === "withdrew"),
        ExpressionAttributeNames: {
          "#updatedBlock": "updatedBlock",
          "#updatedTransactionIndex": "updatedTransactionIndex",
          "#updatedLogIndex": "updatedLogIndex",
        },
        ExpressionAttributeValues: {
          ":updatedBlock": { N: event.blockNumber.toString() },
          ":updatedTransactionIndex": { N: event.transactionIndex.toString() },
          ":updatedLogIndex": { N: event.logIndex.toString() },
        },
      }));
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }

  async listActiveAccountIds(network: DirectoryNetwork, owner: Address): Promise<bigint[]> {
    const accountIds: bigint[] = [];
    let exclusiveStartKey: Item | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: SUBACCOUNT_OWNER_INDEX,
        KeyConditionExpression: "#ownerActiveKey = :ownerActive",
        ExpressionAttributeNames: { "#ownerActiveKey": "ownerActiveKey" },
        ExpressionAttributeValues: {
          ":ownerActive": { S: ownerActiveKey(network, owner) },
        },
        ProjectionExpression: "accountId",
        ExclusiveStartKey: exclusiveStartKey,
      }));
      for (const item of result.Items ?? []) accountIds.push(requireNumber(item, "accountId"));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return accountIds.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  async reset(network: DirectoryNetwork): Promise<void> {
    await this.client.send(new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        networkKey: { S: networkKey(network) },
        entityKey: { S: "checkpoint" },
      },
    }));

    let exclusiveStartKey: Item | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "#networkKey = :network",
        ExpressionAttributeNames: { "#networkKey": "networkKey" },
        ExpressionAttributeValues: { ":network": { S: networkKey(network) } },
        ProjectionExpression: "networkKey, entityKey",
        ExclusiveStartKey: exclusiveStartKey,
      }));
      const deletes = (result.Items ?? []).map((item): WriteRequest => ({
        DeleteRequest: {
          Key: {
            networkKey: { S: requireString(item, "networkKey") },
            entityKey: { S: requireString(item, "entityKey") },
          },
        },
      }));
      for (let offset = 0; offset < deletes.length; offset += 25) {
        await this.deleteBatch(deletes.slice(offset, offset + 25));
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }

  private async deleteBatch(requests: WriteRequest[]): Promise<void> {
    let pending = requests;
    for (let attempt = 0; pending.length > 0 && attempt < 8; attempt += 1) {
      const result = await this.client.send(new BatchWriteItemCommand({
        RequestItems: { [this.tableName]: pending },
      }));
      pending = result.UnprocessedItems?.[this.tableName] ?? [];
    }
    if (pending.length > 0) {
      throw new Error(`failed to delete ${pending.length} directory items after retries`);
    }
  }
}
