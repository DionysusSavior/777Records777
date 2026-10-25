import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { ManifestStore } from "./catalogue.ts"
import type { GrantStore, StudioGrant, StudioInvite } from "./grants.ts"

/**
 * The grants table is the studio's. It is not the OM7 directory table.
 * A hash row points at a grant so a token can be checked without scanning,
 * and the raw token is never stored.
 */
export const dynamoGrantStore = (tableName: string): GrantStore => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}))
  const inviteKey = (id: string) => ({ pk: `invite#${id}` })
  const grantKey = (id: string) => ({ pk: `grant#${id}` })
  const hashKey = (hash: string) => ({ pk: `hash#${hash}` })

  return {
    async putInvite(invite) {
      const item: Record<string, unknown> = { ...inviteKey(invite.id), ...invite, kind: "invite" }
      if (invite.consumedAt === null) delete item.consumedAt
      await db.send(new PutCommand({ TableName: tableName, Item: item }))
    },
    async getInvite(id) {
      const found = await db.send(new GetCommand({ TableName: tableName, Key: inviteKey(id) }))
      return (found.Item as StudioInvite | undefined) ?? null
    },
    async consumeInvite(id, recipientSub, now) {
      try {
        const updated = await db.send(new UpdateCommand({
          TableName: tableName,
          Key: inviteKey(id),
          ConditionExpression: "recipientSub = :sub AND attribute_not_exists(consumedAt) AND expiresAt > :now",
          UpdateExpression: "SET consumedAt = :now",
          ExpressionAttributeValues: { ":sub": recipientSub, ":now": now },
          ReturnValues: "ALL_NEW",
        }))
        return (updated.Attributes as StudioInvite | undefined) ?? null
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return null
        throw error
      }
    },
    async putGrant(grant) {
      await db.send(new PutCommand({
        TableName: tableName,
        Item: { ...grantKey(grant.id), ...grant, kind: "grant" },
      }))
      if (grant.revokedAt === null) {
        await db.send(new PutCommand({
          TableName: tableName,
          Item: { ...hashKey(grant.tokenSha256), grantId: grant.id },
        }))
      }
    },
    async getGrant(id) {
      const found = await db.send(new GetCommand({ TableName: tableName, Key: grantKey(id) }))
      return (found.Item as StudioGrant | undefined) ?? null
    },
    async getGrantByHash(tokenSha256) {
      const pointer = await db.send(new GetCommand({ TableName: tableName, Key: hashKey(tokenSha256) }))
      const grantId = pointer.Item?.grantId
      if (typeof grantId !== "string") return null
      const grant = await this.getGrant(grantId)
      if (!grant || grant.revokedAt !== null || grant.tokenSha256 !== tokenSha256) return null
      return grant
    },
    async listGrants() {
      const found = await db.send(new QueryCommand({
        TableName: tableName,
        IndexName: "byKind",
        KeyConditionExpression: "kind = :kind",
        ExpressionAttributeValues: { ":kind": "grant" },
      }))
      return (found.Items ?? []) as StudioGrant[]
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
