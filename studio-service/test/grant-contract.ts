import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { dynamoGrantStore } from "../src/aws.ts"
import {
  BEGIN_LIMIT,
  createStudioService,
  memoryGrantStore,
  type GrantStore,
  type StudioGrant,
} from "../src/grants.ts"
import type { PublishStorage } from "../../backend/src/site-manager/core.ts"
import type { ManifestStore } from "../src/catalogue.ts"

type Item = Record<string, unknown>

/**
 * Enough of DocumentClient to run the statements dynamoGrantStore actually
 * sends. Conditions are evaluated; a failed one writes nothing.
 */
class FakeDocuments {
  readonly items = new Map<string, Item>()
  pageSize = Number.POSITIVE_INFINITY
  failNext = false

  async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
    const input = command.input
    switch (command.constructor.name) {
      case "GetCommand":
        return { Item: this.clone(this.items.get(String((input.Key as Item).pk))) }
      case "PutCommand":
        return this.put(input)
      case "UpdateCommand":
        return this.update(input)
      case "DeleteCommand":
        return this.remove(input)
      case "QueryCommand":
        return this.query(input)
      case "TransactWriteCommand":
        return this.transact(input.TransactItems as Array<Record<string, Item>>)
      default:
        throw new Error(`unexpected command ${command.constructor.name}`)
    }
  }

  private clone(item: Item | undefined) {
    return item ? { ...item } : undefined
  }

  private put(input: Record<string, unknown>) {
    const item = { ...(input.Item as Item) }
    const existing = this.items.get(String(item.pk))
    if (!condition(input.ConditionExpression as string | undefined, existing, input)) {
      throw failed()
    }
    this.items.set(String(item.pk), item)
    return {}
  }

  private update(input: Record<string, unknown>) {
    const key = input.Key as Item
    const existing = this.items.get(String(key.pk))
    if (!condition(input.ConditionExpression as string | undefined, existing, input)) throw failed()
    const next = apply(existing ?? { pk: key.pk }, input)
    this.items.set(String(key.pk), next)
    return { Attributes: { ...next } }
  }

  private remove(input: Record<string, unknown>) {
    const key = input.Key as Item
    const existing = this.items.get(String(key.pk))
    if (!condition(input.ConditionExpression as string | undefined, existing, input)) throw failed()
    this.items.delete(String(key.pk))
    return {}
  }

  private query(input: Record<string, unknown>) {
    const values = input.ExpressionAttributeValues as Item
    const rows = [...this.items.values()]
      .filter((item) => item.kind === values[":kind"])
      .sort((a, b) => String(a.pk).localeCompare(String(b.pk)))
    const cursor = input.ExclusiveStartKey as Item | undefined
    const start = cursor ? rows.findIndex((row) => row.pk === cursor.pk) + 1 : 0
    const page = rows.slice(start, start + this.pageSize)
    const last = page[page.length - 1]
    const more = start + page.length < rows.length
    return {
      Items: page.map((row) => ({ ...row })),
      LastEvaluatedKey: more && last ? { pk: last.pk, kind: last.kind } : undefined,
    }
  }

  private transact(actions: Array<Record<string, Item>>) {
    if (this.failNext) {
      this.failNext = false
      throw new Error("injected transaction failure")
    }
    const before = new Map(this.items)
    const reasons = actions.map((action) => {
      const step = action.Update ?? action.Put ?? action.Delete
      const key = (step.Key as Item | undefined)?.pk ?? (step.Item as Item).pk
      const existing = this.items.get(String(key))
      const ok = condition(step.ConditionExpression as string | undefined, existing, step)
      return { Code: ok ? "None" : "ConditionalCheckFailed" }
    })
    if (reasons.some((reason) => reason.Code !== "None")) {
      const error = new Error("Transaction canceled")
      error.name = "TransactionCanceledException"
      ;(error as Error & { CancellationReasons: typeof reasons }).CancellationReasons = reasons
      throw error
    }
    for (const action of actions) {
      if (action.Update) this.update(action.Update)
      else if (action.Put) this.put(action.Put)
      else if (action.Delete) this.remove(action.Delete)
    }
    if (this.items.size < before.size && false) return {}
    return {}
  }
}

const failed = () => {
  const error = new Error("conditional")
  error.name = "ConditionalCheckFailedException"
  return error
}

const namesOf = (input: Record<string, unknown>) =>
  (input.ExpressionAttributeNames as Record<string, string> | undefined) ?? {}

const valuesOf = (input: Record<string, unknown>) =>
  (input.ExpressionAttributeValues as Item | undefined) ?? {}

const attr = (item: Item | undefined, token: string, names: Record<string, string>) => {
  const key = token.startsWith("#") ? names[token] : token
  return { key, present: item !== undefined && Object.prototype.hasOwnProperty.call(item, key), value: item?.[key] }
}

const atom = (text: string, item: Item | undefined, input: Record<string, unknown>) => {
  const names = namesOf(input)
  const values = valuesOf(input)
  const exists = text.match(/^attribute_not_exists\(([^)]+)\)$/)
  if (exists) return !attr(item, exists[1], names).present
  const match = text.match(/^(\S+)\s*(=|>|<)\s*(\S+)$/)
  if (!match || !item) return false
  const left = attr(item, match[1], names).value
  const right = match[3].startsWith(":") ? values[match[3]] : match[3]
  if (match[2] === "=") return left === right
  if (typeof left !== "number" || typeof right !== "number") return false
  return match[2] === ">" ? left > right : left < right
}

const condition = (expression: string | undefined, item: Item | undefined, input: Record<string, unknown>) => {
  if (!expression) return true
  if (expression.includes(" OR ")) return expression.split(" OR ").some((part) => condition(part.trim(), item, input))
  return expression.split(" AND ").every((part) => atom(part.trim(), item, input))
}

const apply = (item: Item, input: Record<string, unknown>) => {
  const next = { ...item }
  const expression = String(input.UpdateExpression)
  const values = valuesOf(input)
  const names = namesOf(input)
  const set = expression.match(/SET\s+([\s\S]*?)(?:\s+REMOVE\s+|$)/)
  const remove = expression.match(/REMOVE\s+(.+)$/)
  if (set) {
    const body = set[1]
    if (body.includes("if_not_exists(#count")) {
      next.count = (typeof next.count === "number" ? next.count : 0) + 1
      next.expiresAt = values[":exp"]
      next.kind = values[":kind"]
    } else {
      for (const part of body.split(",")) {
        const eq = part.indexOf("=")
        const left = part.slice(0, eq).trim()
        const right = part.slice(eq + 1).trim()
        const key = left.startsWith("#") ? names[left] : left
        next[key] = values[right]
      }
    }
  }
  if (remove) {
    for (const token of remove[1].split(",")) {
      const name = token.trim()
      delete next[name.startsWith("#") ? names[name] : name]
    }
  }
  return next
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex")

const sample = (version = 1, token = "token-a"): StudioGrant => ({
  id: "grant-1",
  destinationId: "viz-sounds",
  principalSub: "viz-sub-1111",
  tokenSha256: hash(token),
  version,
  revokedAt: null,
  reconnectRequired: false,
})

const invite = {
  id: "invite-1",
  destinationId: "viz-sounds",
  recipientSub: "viz-sub-1111",
  expiresAt: Date.parse("2026-11-01T00:00:00.000Z"),
  consumedAt: null,
}

const stores = (): Array<[string, () => GrantStore]> => [
  ["memory", () => memoryGrantStore()],
  ["dynamo", () => dynamoGrantStore("Grants", new FakeDocuments() as unknown as DynamoDBDocumentClient)],
]

for (const [name, make] of stores()) {
  test(`${name}: a stale rotate cannot resurrect a revocation`, async () => {
    const store = make()
    const grant = sample()
    assert.ok(await store.createGrantFromInvite(grant, { inviteId: invite.id, recipientSub: invite.recipientSub, now: 1 }) === null)
    await store.putInvite(invite)
    assert.ok(await store.createGrantFromInvite(grant, { inviteId: invite.id, recipientSub: invite.recipientSub, now: 1 }))
    const read = await store.getGrant(grant.id)
    assert.ok(read)
    const revoked = await store.revokeGrant(grant.id, 50)
    assert.equal(revoked?.revokedAt, 50)
    await assert.rejects(
      () => store.rotateGrant(read, hash("token-b")),
      (error: { code: string }) => error.code === "conflict",
    )
    const after = await store.getGrant(grant.id)
    assert.equal(after?.revokedAt, 50)
    assert.equal(after?.tokenSha256, null)
    assert.equal(await store.getGrantByHash(hash("token-a")), null)
    assert.equal(await store.getGrantByHash(hash("token-b")), null)
  })

  test(`${name}: revoke after rotate stays revoked, and only one of two writers wins`, async () => {
    const store = make()
    await store.putInvite(invite)
    await store.createGrantFromInvite(sample(), { inviteId: invite.id, recipientSub: invite.recipientSub, now: 1 })
    const read = await store.getGrant("grant-1")
    assert.ok(read)
    const rotated = await store.rotateGrant(read, hash("token-b"))
    const revoked = await store.revokeGrant(rotated.id, 80)
    assert.equal(revoked?.revokedAt, 80)
    assert.equal(await store.getGrantByHash(hash("token-b")), null)
    const again = await store.getGrant("grant-1")
    assert.ok(again)
    const raced = await Promise.allSettled([
      store.rotateGrant(again, hash("token-c")),
      store.forceReconnect(again),
    ])
    assert.equal(raced.filter((item) => item.status === "rejected").length, 2)
    const held = await store.getGrant("grant-1")
    assert.equal(held?.revokedAt, 80)
  })

  test(`${name}: one snapshot, two reconnects, exactly one lands`, async () => {
    const store = make()
    await store.putInvite(invite)
    await store.createGrantFromInvite(sample(), { inviteId: invite.id, recipientSub: invite.recipientSub, now: 1 })
    const read = await store.getGrant("grant-1")
    assert.ok(read)
    const raced = await Promise.allSettled([
      store.rotateGrant(read, hash("token-c")),
      store.forceReconnect(read),
    ])
    assert.equal(raced.filter((item) => item.status === "fulfilled").length, 1)
    assert.equal(raced.filter((item) => item.status === "rejected").length, 1)
    const held = await store.getGrant("grant-1")
    assert.equal(held?.version, 2)
    assert.equal(held?.revokedAt, null)
  })
}

test("dynamo: a failed transaction consumes nothing", async () => {
  const fake = new FakeDocuments()
  const store = dynamoGrantStore("Grants", fake as unknown as DynamoDBDocumentClient)
  await store.putInvite(invite)
  fake.failNext = true
  await assert.rejects(() => store.createGrantFromInvite(sample(), {
    inviteId: invite.id,
    recipientSub: invite.recipientSub,
    now: 1,
  }))
  const saved = await store.getInvite(invite.id)
  assert.equal(saved?.consumedAt, null)
  assert.equal(await store.getGrant("grant-1"), null)
})

test("dynamo: listGrants follows LastEvaluatedKey", async () => {
  const fake = new FakeDocuments()
  fake.pageSize = 1
  const store = dynamoGrantStore("Grants", fake as unknown as DynamoDBDocumentClient)
  for (const id of ["a", "b", "c"]) {
    await store.putInvite({ ...invite, id: `invite-${id}`, destinationId: "viz-sounds" })
    // A token per grant. Sharing one makes the second collide on the token
    // pointer's attribute_not_exists guard, which is the adapter being right:
    // two live grants must never answer to the same token.
    await store.createGrantFromInvite({ ...sample(1, `token-${id}`), id: `grant-${id}` }, {
      inviteId: `invite-${id}`,
      recipientSub: invite.recipientSub,
      now: 1,
    })
  }
  const listed = await store.listGrants()
  assert.deepEqual(listed.map((grant) => grant.id).sort(), ["grant-a", "grant-b", "grant-c"])
})

test("a begin limit lives in the store and survives a new process", async () => {
  const store = memoryGrantStore()
  let issued = 0
  const files: PublishStorage = {
    async issueUpload(input) {
      return { url: "https://uploads.example.test/x", headers: {}, expiresAt: "2026-10-25T12:15:00.000Z" }
    },
    async inspectUpload() {
      return null
    },
  }
  const catalogue: ManifestStore = {
    async read() { return null },
    async write() { return { etag: "e" } },
  }
  const make = () => createStudioService({
    store,
    manifests: catalogue,
    storage: files,
    receiptSecret: "test-only-receipt-secret-that-is-long-enough",
    admins: new Set(["admin-sub-1"]),
    now: () => Date.parse("2026-10-25T12:00:00.000Z"),
    mintToken: () => `token-${issued++}`,
  })
  const first = make()
  const created = await first.createInvite({ sub: "admin-sub-1" }, { destinationId: "viz-sounds", recipientSub: "viz-sub-1111" })
  const grant = await first.acceptInvite({ sub: "viz-sub-1111" }, created.inviteId)
  const body = {
    filename: "a.mp3",
    mediaKind: "audio",
    contentType: "audio/mpeg",
    contentLength: 11,
    checksumSha256: createHash("sha256").update("audio bytes").digest("base64"),
    destinationId: "viz-sounds",
    title: "In Time",
  }
  for (let n = 0; n < BEGIN_LIMIT; n += 1) await first.begin(`Bearer ${grant.token}`, body)
  await assert.rejects(
    () => first.begin(`Bearer ${grant.token}`, body),
    (error: { status: number; code: string }) => error.status === 429 && error.code === "rate_limited",
  )
  await assert.rejects(
    () => make().begin(`Bearer ${grant.token}`, body),
    (error: { code: string }) => error.code === "rate_limited",
  )
})
