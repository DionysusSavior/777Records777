import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AdminState, AdminStore } from "./admins.ts";

export const dynamoAdminStore = (
  tableName: string,
  client = DynamoDBDocumentClient.from(new DynamoDBClient({}))
): AdminStore => ({
  async read() {
    const { Item } = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: "admin-roster" },
        ConsistentRead: true,
      })
    );
    return Item ? (Item.state as AdminState) : null;
  },
  async write(expected, state) {
    try {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: "admin-roster",
            version: state.version,
            subs: state.members.map((member) => member.sub),
            state,
          },
          ConditionExpression:
            expected === null
              ? "attribute_not_exists(pk)"
              : "#version = :expected",
          ...(expected === null
            ? {}
            : {
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: { ":expected": expected },
              }),
        })
      );
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ConditionalCheckFailedException"
      )
        return false;
      throw error;
    }
  },
});
