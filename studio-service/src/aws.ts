import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb"
import type { ManifestStore } from "./catalogue.ts"
import { grantConflict, type GrantStore, type StudioGrant, type StudioInvite } from "./grants.ts"

/**
 * The grants table is the studio's. It is not the OM7 directory table.
 * A hash row points at a grant so a token can be checked without scanning,
 * and the raw token is never stored. `revokedAt` and a cleared token are
 * absent, not null, because the conditions use attribute_not_exists: a stored
 * null would still count as present and a revocation could not be expressed.
 */
export const dynamoGrantStore = (
  tableName: string,
  client: DynamoDBDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({})),
): GrantStore => {
  const inviteKey = (id: string) => ({ pk: `invite#${id}` })
  const grantKey = (id: string) => ({ pk: `grant#${id}` })
  const hashKey = (hash: string) => ({ pk: `hash#${hash}` })

  const canceled = (error: unknown) => {
    if (!(error instanceof Error) || error.name !== "TransactionCanceledException") return null
    return (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons ?? []
  }

  const asInvite = (item: Record<string, unknown> | undefined): StudioInvite | null => {
    if (!item || typeof item.id !== "string") return null
    return {
      id: item.id,
      destinationId: String(item.destinationId),
      recipientSub: String(item.recipientSub),
      expiresAt: Number(item.expiresAt),
      consumedAt: typeof item.consumedAt === "number" ? item.consumedAt : null,
    }
  }

  const asGrant = (item: Record<string, unknown> | undefined): StudioGrant | null => {
    if (!item || typeof item.id !== "string") return null
    return {
      id: item.id,
      destinationId: String(item.destinationId),
      principalSub: String(item.principalSub),
      tokenSha256: typeof item.tokenSha256 === "string" ? item.tokenSha256 : null,
      version: Number(item.version),
      revokedAt: typeof item.revokedAt === "number" ? item.revokedAt : null,
      reconnectRequired: item.reconnectRequired === true,
    }
  }

  const grantItem = (grant: StudioGrant) => {
    const item: Record<string, unknown> = {
      ...grantKey(grant.id),
      kind: "grant",
      id: grant.id,
      destinationId: grant.destinationId,
      principalSub: grant.principalSub,
      version: grant.version,
      reconnectRequired: grant.reconnectRequired,
    }
    if (grant.tokenSha256 !== null) item.tokenSha256 = grant.tokenSha256
    if (grant.revokedAt !== null) item.revokedAt = grant.revokedAt
    return item
  }

  const getGrant = async (id: string) => {
    const found = await client.send(new GetCommand({
      TableName: tableName,
      Key: grantKey(id),
      ConsistentRead: true,
    }))
    return asGrant(found.Item)
  }

  return {
    async putInvite(invite) {
      const item: Record<string, unknown> = { ...inviteKey(invite.id), ...invite, kind: "invite" }
      if (invite.consumedAt === null) delete item.consumedAt
      await client.send(new PutCommand({ TableName: tableName, Item: item }))
    },
    async getInvite(id) {
      const found = await client.send(new GetCommand({
        TableName: tableName,
        Key: inviteKey(id),
        ConsistentRead: true,
      }))
      return asInvite(found.Item)
    },
    async createGrantFromInvite(grant, consume) {
      const items: TransactWriteCommandInput["TransactItems"] = [
        {
          Update: {
            TableName: tableName,
            Key: inviteKey(consume.inviteId),
            ConditionExpression:
              "recipientSub = :sub AND attribute_not_exists(consumedAt) AND expiresAt > :now AND destinationId = :dest",
            UpdateExpression: "SET consumedAt = :now",
            ExpressionAttributeValues: {
              ":sub": consume.recipientSub,
              ":now": consume.now,
              ":dest": grant.destinationId,
            },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: grantItem(grant),
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: { ...hashKey(grant.tokenSha256 ?? ""), grantId: grant.id },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
      ]
      try {
        await client.send(new TransactWriteCommand({ TransactItems: items }))
        return grant
      } catch (error) {
        const reasons = canceled(error)
        if (!reasons) throw error
        if (reasons[0]?.Code === "ConditionalCheckFailed") return null
        throw grantConflict()
      }
    },
    getGrant,
    async getGrantByHash(tokenSha256) {
      const pointer = await client.send(new GetCommand({
        TableName: tableName,
        Key: hashKey(tokenSha256),
        ConsistentRead: true,
      }))
      const grantId = pointer.Item?.grantId
      if (typeof grantId !== "string") return null
      const grant = await getGrant(grantId)
      if (!grant || grant.revokedAt !== null || grant.tokenSha256 !== tokenSha256) return null
      return grant
    },
    async listGrants() {
      const grants: StudioGrant[] = []
      let start: Record<string, unknown> | undefined
      do {
        const found = await client.send(new QueryCommand({
          TableName: tableName,
          IndexName: "byKind",
          KeyConditionExpression: "kind = :kind",
          ExpressionAttributeValues: { ":kind": "grant" },
          ExclusiveStartKey: start,
        }))
        for (const item of found.Items ?? []) {
          const grant = asGrant(item)
          if (grant) grants.push(grant)
        }
        start = found.LastEvaluatedKey
      } while (start)
      return grants
    },
    async rotateGrant(expected, tokenSha256) {
      const items: TransactWriteCommandInput["TransactItems"] = [
        {
          Update: {
            TableName: tableName,
            Key: grantKey(expected.id),
            ConditionExpression: "version = :version AND attribute_not_exists(revokedAt)",
            UpdateExpression: "SET tokenSha256 = :hash, version = :next, reconnectRequired = :no",
            ExpressionAttributeValues: {
              ":version": expected.version,
              ":hash": tokenSha256,
              ":next": expected.version + 1,
              ":no": false,
            },
          },
        },
      ]
      if (expected.tokenSha256 !== null) {
        items.push({
          Delete: {
            TableName: tableName,
            Key: hashKey(expected.tokenSha256),
            ConditionExpression: "grantId = :id",
            ExpressionAttributeValues: { ":id": expected.id },
          },
        })
      }
      items.push({
        Put: {
          TableName: tableName,
          Item: { ...hashKey(tokenSha256), grantId: expected.id },
          ConditionExpression: "attribute_not_exists(pk)",
        },
      })
      try {
        await client.send(new TransactWriteCommand({ TransactItems: items }))
      } catch (error) {
        if (!canceled(error)) throw error
        throw grantConflict()
      }
      return {
        ...expected,
        tokenSha256,
        version: expected.version + 1,
        reconnectRequired: false,
      }
    },
    async forceReconnect(expected) {
      const items: TransactWriteCommandInput["TransactItems"] = [
        {
          Update: {
            TableName: tableName,
            Key: grantKey(expected.id),
            ConditionExpression: "version = :version AND attribute_not_exists(revokedAt)",
            UpdateExpression: "SET version = :next, reconnectRequired = :yes REMOVE tokenSha256",
            ExpressionAttributeValues: {
              ":version": expected.version,
              ":next": expected.version + 1,
              ":yes": true,
            },
          },
        },
      ]
      if (expected.tokenSha256 !== null) {
        items.push({
          Delete: {
            TableName: tableName,
            Key: hashKey(expected.tokenSha256),
            ConditionExpression: "grantId = :id",
            ExpressionAttributeValues: { ":id": expected.id },
          },
        })
      }
      try {
        await client.send(new TransactWriteCommand({ TransactItems: items }))
      } catch (error) {
        if (!canceled(error)) throw error
        throw grantConflict()
      }
      return {
        ...expected,
        tokenSha256: null,
        version: expected.version + 1,
        reconnectRequired: true,
      }
    },
    async revokeGrant(grantId, now) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const grant = await getGrant(grantId)
        if (!grant) return null
        if (grant.revokedAt !== null) return grant
        const items: TransactWriteCommandInput["TransactItems"] = [
          {
            Update: {
              TableName: tableName,
              Key: grantKey(grant.id),
              ConditionExpression: "version = :version AND attribute_not_exists(revokedAt)",
              UpdateExpression: "SET version = :next, revokedAt = :now REMOVE tokenSha256",
              ExpressionAttributeValues: {
                ":version": grant.version,
                ":next": grant.version + 1,
                ":now": now,
              },
            },
          },
        ]
        if (grant.tokenSha256 !== null) {
          items.push({
            Delete: {
              TableName: tableName,
              Key: hashKey(grant.tokenSha256),
              ConditionExpression: "grantId = :id",
              ExpressionAttributeValues: { ":id": grant.id },
            },
          })
        }
        try {
          await client.send(new TransactWriteCommand({ TransactItems: items }))
          return { ...grant, tokenSha256: null, version: grant.version + 1, revokedAt: now }
        } catch (error) {
          if (!canceled(error)) throw error
        }
      }
      throw grantConflict()
    },
    async noteBegin({ grantId, windowStart, limit, expiresAt }) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { pk: `begin#${grantId}#${windowStart}` },
          ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
          UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :exp, kind = :kind",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: {
            ":limit": limit,
            ":zero": 0,
            ":one": 1,
            ":exp": expiresAt,
            ":kind": "begin",
          },
        }))
        return true
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false
        throw error
      }
    },
  }
}

const textOf = async (body: unknown) => {
  if (!body) return ""
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8")
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * One manifest key, conditional write. No list and no delete: a failed
 * catalogue update leaves the previous object where it was.
 */
export const s3ManifestStore = (bucket: string, region: string): ManifestStore => {
  const client = new S3Client({ region })
  return {
    async read(key) {
      try {
        const found = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        return { body: await textOf(found.Body), etag: found.ETag ?? "" }
      } catch (error) {
        if (error instanceof NoSuchKey || (error instanceof Error && error.name === "NoSuchKey")) return null
        if (error instanceof Error && error.name === "NotFound") return null
        throw error
      }
    },
    async write(key, body, ifMatch) {
      try {
        const written = await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/json",
          CacheControl: "public, max-age=60, must-revalidate",
          ...(ifMatch === null ? { IfNoneMatch: "*" } : { IfMatch: ifMatch }),
        }))
        return { etag: written.ETag ?? "" }
      } catch (error) {
        if (error instanceof Error && (error.name === "PreconditionFailed" || error.name === "ConditionalRequestConflict")) {
          return { conflict: true }
        }
        throw error
      }
    },
  }
}
