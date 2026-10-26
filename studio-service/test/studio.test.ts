import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { test } from "node:test"
import type { PublishStorage, StoredUpload, UploadDescriptor } from "../../backend/src/site-manager/core.ts"
import { applyCatalogue, type ManifestStore } from "../src/catalogue.ts"
import { UPLOAD_TTL_NOTE } from "../src/destinations.ts"
import { createStudioService, memoryGrantStore } from "../src/grants.ts"
import { handle } from "../src/handler.ts"
import { IdentityError, verifyIdToken } from "../src/identity.ts"

const checksum = createHash("sha256").update("audio bytes").digest("base64")
const ADMIN = "admin-sub-1"
const VIZ = "viz-sub-1111"
const VIZ_EMAIL = "viz@example.test"
const STRANGER = "stranger-sub"
const person = (sub: string, email?: string) => ({
  sub,
  email: email ?? null,
  emailVerified: email !== undefined,
})

const storage = () => {
  const objects = new Map<string, StoredUpload>()
  let issued: UploadDescriptor | undefined
  const fake: PublishStorage = {
    async issueUpload(input) {
      issued = input
      objects.set(input.key, {
        contentType: input.contentType,
        contentLength: input.contentLength,
        checksumSha256: input.checksumSha256,
      })
      return {
        url: `https://uploads.example.test/${input.key}`,
        headers: { "content-type": input.contentType },
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }
    },
    async inspectUpload(key) {
      return objects.get(key) ?? null
    },
  }
  return { fake, issued: () => issued }
}

const manifests = (): ManifestStore & { snapshot: (key: string) => string | null; conflictsLeft: number } => {
  const objects = new Map<string, { body: string; etag: string }>()
  let serial = 1
  const store = {
    conflictsLeft: 0,
    snapshot(key: string) {
      return objects.get(key)?.body ?? null
    },
    async read(key: string) {
      return objects.get(key) ?? null
    },
    async write(key: string, body: string, ifMatch: string | null) {
      if (store.conflictsLeft > 0) {
        store.conflictsLeft -= 1
        return { conflict: true as const }
      }
      const current = objects.get(key) ?? null
      if (ifMatch === null) {
        if (current) return { conflict: true as const }
      } else if (!current || current.etag !== ifMatch) {
        return { conflict: true as const }
      }
      const etag = `e${serial}`
      serial += 1
      objects.set(key, { body, etag })
      return { etag }
    },
  }
  return store
}

const setup = (freshnessMs = 0) => {
  let clock = Date.parse("2026-10-25T12:00:00.000Z")
  let issued = 0
  const files = storage()
  const catalogue = manifests()
  const service = createStudioService({
    store: memoryGrantStore(),
    manifests: catalogue,
    storage: files.fake,
    receiptSecret: "test-only-receipt-secret-that-is-long-enough",
    admins: new Set([ADMIN]),
    now: () => clock,
    freshnessMs,
    mintToken: () => `token-${issued++}`,
  })
  return {
    service,
    catalogue,
    files,
    at: (iso: string) => { clock = Date.parse(iso) },
    advance: (ms: number) => { clock += ms },
    identity: person,
  }
}

const audio = (destinationId: string) => ({
  filename: "../../nope.mp3",
  mediaKind: "audio",
  contentType: "audio/mpeg",
  contentLength: 11,
  checksumSha256: checksum,
  destinationId,
  title: "In Time",
})

test("an ordinary account cannot mint a grant", async () => {
  const { service, identity } = setup()
  await assert.rejects(
    () => service.createInvite(identity(STRANGER), { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL }),
    (error: { status: number; code: string }) => error.status === 403 && error.code === "forbidden",
  )
  assert.deepEqual(await service.list(identity(ADMIN)), [])
})

test("the wrong person, an expired invite, and a replay are refused", async () => {
  const rig = setup()
  const created = await rig.service.createInvite(rig.identity(ADMIN), {
    destinationId: "viz-movies",
    recipientEmail: VIZ_EMAIL,
  })
  await assert.rejects(
    () => rig.service.acceptInvite(rig.identity(STRANGER), created.inviteId),
    (error: { code: string }) => error.code === "invite_denied",
  )
  await assert.rejects(
    () => rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-movies", recipientEmail: VIZ }),
    (error: { code: string }) => error.code === "invalid_request",
  )
  rig.advance(8 * 24 * 60 * 60 * 1000)
  await assert.rejects(
    () => rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), created.inviteId),
    (error: { code: string }) => error.code === "invite_denied",
  )
  rig.advance(-8 * 24 * 60 * 60 * 1000)
  const accepted = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), created.inviteId)
  assert.equal(accepted.destination.id, "viz-movies")
  await assert.rejects(
    () => rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), created.inviteId),
    (error: { code: string }) => error.code === "invite_denied",
  )
})

test("an invitation is emailed, and only that verified address can accept it", async () => {
  const sent: string[] = []
  const rig = setup()
  const service = createStudioService({
    store: memoryGrantStore(),
    manifests: rig.catalogue,
    storage: rig.files.fake,
    receiptSecret: "test-only-receipt-secret-that-is-long-enough",
    admins: new Set([ADMIN]),
    now: () => Date.parse("2026-10-25T12:00:00.000Z"),
    mintToken: () => "token-mail",
    sendInvite: async (message) => {
      sent.push(message.to)
      if (message.to.endsWith("@fail.test")) throw new Error("ses down")
    },
  })
  const created = await service.createInvite(person(ADMIN), {
    destinationId: "viz-sounds",
    recipientEmail: "Viz@Example.TEST",
  })
  assert.equal(created.mailed, true)
  assert.deepEqual(sent, ["viz@example.test"])
  assert.match(created.acceptUrl, /invite=/)
  await assert.rejects(
    () => service.acceptInvite({ sub: VIZ, email: "viz@example.test", emailVerified: false }, created.inviteId),
    (error: { code: string }) => error.code === "email_unverified",
  )
  await assert.rejects(
    () => service.viewInvite(person("other-sub", "someone@else.test"), created.inviteId),
    (error: { code: string }) => error.code === "invite_denied",
  )
  const preview = await service.viewInvite(
    { sub: VIZ, email: "Viz@Example.TEST", emailVerified: true },
    created.inviteId,
  )
  assert.equal(preview.destination.id, "viz-sounds")
  const accepted = await service.acceptInvite(
    { sub: VIZ, email: "viz@example.test", emailVerified: true },
    created.inviteId,
  )
  assert.equal(accepted.token, "token-mail")

  const quiet = await service.createInvite(person(ADMIN), {
    destinationId: "viz-movies",
    recipientEmail: "viz@fail.test",
  })
  assert.equal(quiet.mailed, false)
})

test("Viz can publish Sounds and Movies, and cannot use Dion's destination or receipt", async () => {
  const rig = setup()
  const sounds = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL })
  const movies = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-movies", recipientEmail: VIZ_EMAIL })
  const soundGrant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), sounds.inviteId)
  const movieGrant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), movies.inviteId)

  const begun = await rig.service.begin(`Bearer ${soundGrant.token}`, audio("viz-sounds"))
  assert.match(rig.files.issued()?.key ?? "", /^site-manager\/viz\/[0-9a-f-]+\.mp3$/)
  assert.doesNotMatch(rig.files.issued()?.key ?? "", /dion/)
  const done = await rig.service.complete(`Bearer ${soundGrant.token}`, begun.uploadReceipt)
  assert.equal(done.pageUrl, "https://777records777.studio/us/artists/viz")
  const catalogue = JSON.parse(rig.catalogue.snapshot("site-manager/viz/index.json") ?? "{}")
  assert.equal(catalogue.items.length, 1)
  assert.equal(catalogue.items[0].title, "In Time")
  assert.equal(catalogue.releases, undefined)

  await assert.rejects(
    () => rig.service.begin(`Bearer ${soundGrant.token}`, audio("dionysus-savior-sounds")),
    (error: { status: number; code: string }) => error.status === 403 && error.code === "destination_denied",
  )
  await assert.rejects(
    () => rig.service.complete(`Bearer ${movieGrant.token}`, begun.uploadReceipt),
    (error: { status: number; code: string }) => error.status === 403 && error.code === "destination_denied",
  )

  const film = await rig.service.begin(`Bearer ${movieGrant.token}`, {
    ...audio("viz-movies"),
    mediaKind: "video",
    contentType: "video/mp4",
    filename: "film.mp4",
    title: "Time Machine",
  })
  await rig.service.complete(`Bearer ${movieGrant.token}`, film.uploadReceipt)
  const after = JSON.parse(rig.catalogue.snapshot("site-manager/viz/index.json") ?? "{}")
  assert.equal(after.items.length, 1)
  assert.equal(after.movies.length, 1)
  assert.equal(after.movies[0].title, "Time Machine")
  assert.equal(after.releases, undefined)
})

test("a second completion keeps the first release", async () => {
  const rig = setup()
  const invite = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL })
  const grant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), invite.inviteId)
  const existing = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    items: [{
      id: "8efa1310-4fbe-45c8-bfbe-a681f7316f50",
      kind: "audio",
      title: "New Deal",
      url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/old.wav",
      contentType: "audio/wav",
      bytes: 10,
      publishedAt: "2026-09-01T00:00:00.000Z",
    }],
    releases: [{
      id: "b3c1d2e4-5f67-489a-abbc-cdef01234567",
      title: "New Deal",
      audio: "8efa1310-4fbe-45c8-bfbe-a681f7316f50",
      reel: null,
      artwork: null,
      bundle: null,
      price: null,
      buyUrl: null,
      visible: true,
      publishedAt: "2026-09-01T00:00:00.000Z",
    }],
  })
  assert.equal("etag" in await rig.catalogue.write("site-manager/viz/index.json", existing, null), true)

  const first = await rig.service.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  await rig.service.complete(`Bearer ${grant.token}`, first.uploadReceipt)
  const second = await rig.service.begin(`Bearer ${grant.token}`, { ...audio("viz-sounds"), title: "Second" })
  rig.catalogue.conflictsLeft = 1
  await rig.service.complete(`Bearer ${grant.token}`, second.uploadReceipt)
  await rig.service.complete(`Bearer ${grant.token}`, second.uploadReceipt)

  const body = JSON.parse(rig.catalogue.snapshot("site-manager/viz/index.json") ?? "{}")
  assert.equal(body.items.length, 3)
  assert.equal(body.releases.length, 3)
  assert.equal(body.releases[0].title, "New Deal")
  assert.equal(body.items.filter((item: { title: string }) => item.title === "Second").length, 1)
})

test("revocation and rotation are enforced without a deploy", async () => {
  const rig = setup(30_000)
  const invite = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL })
  const grant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), invite.inviteId)
  const listed = await rig.service.list(rig.identity(ADMIN))
  const begun = await rig.service.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  await rig.service.revoke(rig.identity(ADMIN), listed[0].id)
  await assert.rejects(
    () => rig.service.complete(`Bearer ${grant.token}`, begun.uploadReceipt),
    (error: { status: number }) => error.status === 401,
  )
  assert.equal(rig.catalogue.snapshot("site-manager/viz/index.json"), null)
  assert.match(UPLOAD_TTL_NOTE, /15 minutes/)

  const other = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "viz-movies", recipientEmail: VIZ_EMAIL })
  const movie = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), other.inviteId)
  const film = await rig.service.begin(`Bearer ${movie.token}`, {
    ...audio("viz-movies"),
    mediaKind: "video",
    contentType: "video/mp4",
  })
  await rig.service.complete(`Bearer ${movie.token}`, film.uploadReceipt)

  const rotatedInvite = await rig.service.createInvite(rig.identity(ADMIN), { destinationId: "dionysus-savior-sounds", recipientEmail: VIZ_EMAIL })
  const rotatable = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), rotatedInvite.inviteId)
  await rig.service.begin(`Bearer ${rotatable.token}`, audio("dionysus-savior-sounds"))
  const grants = await rig.service.list(rig.identity(ADMIN))
  const target = grants.find((item) => item.destinationId === "dionysus-savior-sounds")
  assert.ok(target)
  const cut = await rig.service.forceReconnect(rig.identity(ADMIN), target.id)
  assert.equal(cut.reconnectRequired, true)
  assert.equal("token" in cut, false)
  await assert.rejects(
    () => rig.service.begin(`Bearer ${rotatable.token}`, audio("dionysus-savior-sounds")),
    (error: { status: number }) => error.status === 401,
  )
  const rotated = await rig.service.rotateOwn(rig.identity(VIZ), target.id)
  const again = await rig.service.begin(`Bearer ${rotated.token}`, audio("dionysus-savior-sounds"))
  await rig.service.complete(`Bearer ${rotated.token}`, again.uploadReceipt)
})

test("a warm cache serves a revoked grant only inside the freshness bound", async () => {
  let clock = Date.parse("2026-10-25T12:00:00.000Z")
  const store = memoryGrantStore()
  const files = storage()
  const catalogue = manifests()
  const shared = {
    store,
    manifests: catalogue,
    storage: files.fake,
    receiptSecret: "test-only-receipt-secret-that-is-long-enough",
    admins: new Set([ADMIN]),
    now: () => clock,
    freshnessMs: 30_000,
    mintToken: () => "token-warm",
  }
  const phone = createStudioService(shared)
  const admin = createStudioService(shared)
  const invite = await admin.createInvite({ sub: ADMIN }, { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL })
  const grant = await phone.acceptInvite(person(VIZ, VIZ_EMAIL), invite.inviteId)
  await phone.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  const [row] = await admin.list({ sub: ADMIN })
  await admin.revoke({ sub: ADMIN }, row.id)
  await phone.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  clock += 30_001
  await assert.rejects(
    () => phone.begin(`Bearer ${grant.token}`, audio("viz-sounds")),
    (error: { status: number }) => error.status === 401,
  )
})

test("anonymous and cross-origin admin calls are denied", async () => {
  const rig = setup()
  const denied = await handle(new Request("https://studio.example/admin/invites", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL }),
  }), {
    service: rig.service,
    allowedOrigins: ["https://777records777.studio"],
    verifyIdentity: async () => { throw new IdentityError("The sign-in token is not valid.") },
  })
  assert.equal(denied.status, 401)
  const body = await denied.json() as { error: { code: string } }
  assert.equal(body.error.code, "unauthorized")
  assert.equal(denied.headers.get("access-control-allow-origin"), null)
})

test("an ID token is checked, and a pool member is not thereby an admin", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: "https://cognito-idp.us-east-2.amazonaws.com/pool",
    aud: "studio-client",
    token_use: "id",
    exp: Math.floor(Date.now() / 1000) + 600,
    sub: STRANGER,
  })).toString("base64url")
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")
  const identity = await verifyIdToken(`${header}.${payload}.${signature}`, {
    issuer: "https://cognito-idp.us-east-2.amazonaws.com/pool",
    audience: "studio-client",
    getKey: async () => publicKey,
  })
  assert.equal(identity.sub, STRANGER)
  const rig = setup()
  await assert.rejects(
    () => rig.service.createInvite(identity, { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL }),
    (error: { status: number }) => error.status === 403,
  )
})

test("catalogue apply refuses a malformed manifest and keeps both additions", () => {
  assert.throws(
    () => applyCatalogue("{", {
      key: "site-manager/viz/11111111-1111-4111-8111-111111111111.mp3",
      publicUrl: "https://example.test/a.mp3",
      mediaKind: "audio",
      contentType: "audio/mpeg",
      contentLength: 1,
      checksumSha256: checksum,
      downloadName: "a.mp3",
      title: "A",
      destinationId: "viz-sounds",
      section: "sounds",
    }, "2026-10-25T00:00:00.000Z"),
    (error: { code: string }) => error.code === "catalogue_malformed",
  )
})
