import assert from "node:assert/strict"
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto"
import { test } from "node:test"
import { CONTENT_TYPES, canonicalContentType, type PublishStorage, type StoredUpload, type UploadDescriptor } from "../../backend/src/site-manager/core.ts"
import { applyCatalogue, applySale, artistHandlesFor, commitCatalogue, commitRemoval, commitSale, listCatalogue, pageCatalogue, removeFromCatalogue, type ManifestStore } from "../src/catalogue.ts"
import { storeItemsFor } from "../src/page-items.ts"
import { parseSiteManagerManifest } from "../../storefront/src/lib/site-manager-manifest.ts"
import { destinationById, manifestLocationFor, objectKeyFor, UPLOAD_TTL_NOTE } from "../src/destinations.ts"
import { verifyPublishAssertion } from "../src/assertion.ts"
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
  const deleted: string[] = []
  return {
    fake,
    issued: () => issued,
    deleted,
    deleteObject: async (key: string) => {
      deleted.push(key)
      objects.delete(key)
    },
    has: (key: string) => objects.has(key),
  }
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
    deleteObject: files.deleteObject,
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
  assert.equal(catalogue.releases.length, 1)
  assert.equal(catalogue.releases[0].title, "In Time")
  assert.equal(catalogue.releases[0].audio, catalogue.items[0].id)

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
  assert.equal(after.releases.length, 1)
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

test("a sound can be listed and removed without touching movies or inventing releases", () => {
  const url = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/11111111-1111-4111-8111-111111111111.mp3"
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [{
      id: "11111111-1111-4111-8111-111111111111",
      kind: "audio",
      title: "In Time",
      url,
      contentType: "audio/mpeg",
      bytes: 1,
      publishedAt: "2026-10-28T00:00:00.000Z",
    }],
    movies: [{ id: "film", title: "Time Machine", url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/film.mp4", poster: "", bytes: 2, publishedAt: "2026-10-28T00:00:00.000Z" }],
  })
  assert.equal(listCatalogue(raw, "sounds")[0]?.title, "In Time")
  assert.equal(listCatalogue(raw, "movies")[0]?.title, "Time Machine")
  const destination = destinationById("viz-sounds")
  assert.ok(destination)
  assert.equal(objectKeyFor(destination, url), "site-manager/viz/11111111-1111-4111-8111-111111111111.mp3")
  assert.equal(objectKeyFor(destination, "https://example.test/other.mp3"), null)
  const removal = removeFromCatalogue(raw, { url, section: "sounds" }, "2026-10-28T01:00:00.000Z")
  const next = JSON.parse(removal.body)
  assert.equal(next.items.length, 0)
  assert.equal(next.releases, undefined)
  assert.equal(next.movies.length, 1)
  // No `releases` array means nothing was holding other files together, so
  // there is nothing stranded to report.
  assert.deepEqual(removal.orphaned, [])
})

test("removing a song takes its reel and bundle with it, and leaves a shared artwork alone", () => {
  /*
   What a release is on the way out.

   A release is a song WITH its reel, its artwork and its downloadable bundle.
   Removal used to drop the release and the one named file and leave the other
   three in `items`, where nothing could reach them: `listCatalogue` lists
   releases for sounds, not items, so neither the phone nor the page showed a
   row, and the bytes stayed in the artist's bucket permanently. Found on
   9 November 2026 when one publish-then-remove left a 213 KB .om7 behind.

   The artwork here is deliberately shared with a second release, because the
   obvious fix - delete everything the dropped release named - would take an
   image that is still on the page out from under it.
  */
  const base = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz"
  const item = (id: string, kind: string, ext: string, contentType: string) => ({
    id,
    kind,
    title: id,
    url: `${base}/${id}.${ext}`,
    contentType,
    bytes: 1,
    publishedAt: "2026-11-09T00:00:00.000Z",
  })
  const release = (id: string, parts: Record<string, string | null>) => ({
    id,
    title: id,
    visible: true,
    audio: null,
    reel: null,
    artwork: null,
    bundle: null,
    price: null,
    buyUrl: null,
    publishedAt: "2026-11-09T00:00:00.000Z",
    ...parts,
  })
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T00:00:00.000Z",
    items: [
      item("song-a", "audio", "wav", "audio/wav"),
      item("reel-a", "video", "mp4", "video/mp4"),
      item("shared-art", "image", "png", "image/png"),
      item("bundle-a", "bundle", "om7", "application/octet-stream"),
      item("song-b", "audio", "wav", "audio/wav"),
      item("loose", "audio", "wav", "audio/wav"),
    ],
    releases: [
      release("rel-a", { audio: "song-a", reel: "reel-a", artwork: "shared-art", bundle: "bundle-a" }),
      release("rel-b", { audio: "song-b", artwork: "shared-art" }),
    ],
  })

  const removal = removeFromCatalogue(raw, { url: `${base}/song-a.wav`, section: "sounds" }, "2026-11-09T01:00:00.000Z")
  const next = JSON.parse(removal.body)

  assert.deepEqual(next.releases.map((entry: { id: string }) => entry.id), ["rel-b"])
  assert.deepEqual(
    next.items.map((entry: { id: string }) => entry.id).sort(),
    ["loose", "shared-art", "song-b"].sort(),
  )
  assert.deepEqual(removal.orphaned.sort(), [`${base}/bundle-a.om7`, `${base}/reel-a.mp4`])

  // The page still reads, and still shows the release that survived.
  assert.deepEqual(listCatalogue(removal.body, "sounds").map((entry) => entry.title), ["rel-b"])
})

test("the service states each release's own page, and the phone computes nothing", () => {
  /*
   WHY THE SERVICE SAYS IT. The address is derived from the title by a rule
   the website also uses. A Swift copy of that rule would drift, and the first
   time it did the phone would hand somebody a link to a page that is not
   there. Same reasoning as `removable`: stated, never guessed.

   The collision below is the part a naive implementation gets wrong. The rule
   settles a shared title across the WHOLE set, so the service has to look at
   the same set the website does - which is the PARSED manifest, not the raw
   array.
  */
  const destination = destinationById("dionysus-savior-sounds")
  assert.ok(destination)
  const base = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/dion"
  const audio = (id: string) => ({
    id,
    kind: "audio",
    title: id,
    url: `${base}/${id}.wav`,
    contentType: "audio/wav",
    bytes: 1,
    publishedAt: "2026-11-09T00:00:00Z",
  })
  // A release's id is its own, never its audio's - ids are unique across the
  // whole manifest and the parser refuses the document over a duplicate.
  const release = (id: string, audioId: string, title: string, at: string) => ({
    id,
    title,
    visible: true,
    audio: audioId,
    reel: null,
    artwork: null,
    bundle: null,
    price: null,
    buyUrl: null,
    publishedAt: at,
  })
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T00:00:00Z",
    items: [
      audio("11111111-1111-4111-8111-111111111111"),
      audio("22222222-2222-4222-8222-222222222222"),
    ],
    releases: [
      release("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", "DIONYSUS SAVIOR - IN TIME", "2026-10-14T19:52:50Z"),
      release("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "22222222-2222-4222-8222-222222222222", "In Time", "2026-11-01T00:00:00Z"),
    ],
  })

  const entries = pageCatalogue(raw, "sounds", [], "the admin portal", {
    artistName: destination.artistName,
    artistPageUrl: destination.pageUrl,
    manifestUrl: manifestLocationFor(destination).url,
  })

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  // The artist's name is not repeated inside a page already under it, and the
  // earlier publish keeps the bare address.
  assert.equal(
    byId.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")?.pageUrl,
    "https://777records777.studio/us/artists/dionysus-savior/in-time",
  )
  assert.equal(
    byId.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")?.pageUrl,
    "https://777records777.studio/us/artists/dionysus-savior/in-time-bbbbbb",
  )

  /*
   A ROW THE WEBSITE DROPS GETS NO ADDRESS, AND MOVES NOBODY ELSE'S.

   This is the case that makes `addressesFor` read the parsed manifest rather
   than the raw array. The first release below carries a content type the
   service accepts and the parser does not, so the website never renders it
   and it has no page. The service still lists it - the artist should see
   what is on their shelf either way - but with no `pageUrl`, and the phone
   falls back to the page link for it.

   The release AFTER it keeps the bare `in-time`, because the website's set
   contains only one "In Time". Counting the dropped row would have pushed an
   id suffix onto a release whose page is plainly at /in-time.
  */
  const withDropped = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T00:00:00Z",
    items: [
      {
        ...audio("33333333-3333-4333-8333-333333333333"),
        contentType: "audio/x-aiff",
        url: `${base}/33333333-3333-4333-8333-333333333333.aiff`,
      },
      audio("11111111-1111-4111-8111-111111111111"),
    ],
    releases: [
      release("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "33333333-3333-4333-8333-333333333333", "In Time", "2026-09-01T00:00:00Z"),
      release("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", "In Time", "2026-10-14T19:52:50Z"),
    ],
  })
  const mixed = pageCatalogue(withDropped, "sounds", [], "the admin portal", {
    artistName: destination.artistName,
    artistPageUrl: destination.pageUrl,
    manifestUrl: manifestLocationFor(destination).url,
  })
  const mixedById = new Map(mixed.map((entry) => [entry.id, entry]))
  assert.equal(mixed.length, 2)
  assert.equal(mixedById.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc")?.pageUrl, undefined)
  assert.equal(
    mixedById.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")?.pageUrl,
    "https://777records777.studio/us/artists/dionysus-savior/in-time",
  )
})

test("a commerce row and a film are offered no address rather than a wrong one", () => {
  /*
   Only a published RELEASE has a page of its own. A store product's page is
   the shop's, which this service does not own, and a film has no page at all.
   Saying nothing sends the phone to the destination's own page, which is
   true; inventing one would 404 in somebody's feed.
  */
  const sounds = destinationById("dionysus-savior-sounds")
  const movies = destinationById("dionysus-savior-movies")
  assert.ok(sounds)
  assert.ok(movies)
  const page = (destination: typeof sounds) => ({
    artistName: destination.artistName,
    artistPageUrl: destination.pageUrl,
    manifestUrl: manifestLocationFor(destination).url,
  })

  const withStore = pageCatalogue(null, "sounds", [
    { id: "prod_1", title: "Gone Crazy", url: "https://777records777.studio/downloads/gone-crazy.wav" },
  ], "the admin portal", page(sounds))
  assert.equal(withStore.length, 1)
  assert.equal(withStore[0]?.pageUrl, undefined)
  assert.equal(withStore[0]?.removable, false)

  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T00:00:00Z",
    items: [],
    movies: [{
      id: "33333333-3333-4333-8333-333333333333",
      title: "Time Machine",
      url: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/dion/33333333-3333-4333-8333-333333333333.mp4",
      poster: "",
      bytes: 2,
      publishedAt: "2026-11-09T00:00:00Z",
    }],
  })
  const films = pageCatalogue(raw, "movies", [], "the site's code", page(movies))
  assert.equal(films.length, 1)
  assert.equal(films[0]?.pageUrl, undefined)
})

test("an item no release ever named is not this removal's to sweep", () => {
  /*
   Restraint, stated as a test.

   A loose item may well be an orphan from an older failure, but it is not
   THIS removal's to judge. Sweeping files nobody asked about is how a delete
   becomes something an artist is afraid to press.
  */
  const base = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz"
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T00:00:00.000Z",
    items: [
      { id: "song", kind: "audio", title: "Song", url: `${base}/song.wav`, contentType: "audio/wav", bytes: 1, publishedAt: "2026-11-09T00:00:00.000Z" },
      { id: "stray", kind: "bundle", title: "Stray", url: `${base}/stray.om7`, contentType: "application/octet-stream", bytes: 1, publishedAt: "2026-11-09T00:00:00.000Z" },
    ],
    releases: [
      { id: "rel", title: "Song", visible: true, audio: "song", reel: null, artwork: null, bundle: null, price: null, buyUrl: null, publishedAt: "2026-11-09T00:00:00.000Z" },
    ],
  })

  const removal = removeFromCatalogue(raw, { url: `${base}/song.wav`, section: "sounds" }, "2026-11-09T01:00:00.000Z")
  assert.deepEqual(removal.orphaned, [])
  assert.deepEqual(JSON.parse(removal.body).items.map((entry: { id: string }) => entry.id), ["stray"])
})

test("an orphan can be removed, and removing nothing is still a 404", async () => {
  /*
   The gap that made four files unreachable.

   An upload that stores its bytes and then fails to write the manifest leaves
   an object with no catalogue entry. removePublished used to commit the entry
   removal FIRST, and commitRemoval throws 404 when there is no entry - so the
   delete never ran and the object could only be cleared from the AWS console.
   That is how the three 503s of 2 November 2026 turned into orphans.

   Here `begin` alone produces exactly that state: the fake storage holds the
   key the moment the upload is issued, and nothing has completed.
  */
  const rig = setup()
  const invited = await rig.service.createInvite(rig.identity(ADMIN), {
    destinationId: "viz-sounds",
    recipientEmail: VIZ_EMAIL,
  })
  const grant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), invited.inviteId)

  await rig.service.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  const key = rig.files.issued()?.key ?? ""
  assert.match(key, /^site-manager\/viz\/[0-9a-f-]+\.mp3$/)
  assert.equal(rig.catalogue.snapshot("site-manager/viz/index.json"), null)
  assert.ok(rig.files.has(key))

  const url = `https://777records777productpageassets.s3.us-east-2.amazonaws.com/${key}`
  assert.deepEqual(
    await rig.service.removePublished(`Bearer ${grant.token}`, "viz-sounds", url),
    { removed: true },
  )
  assert.deepEqual(rig.files.deleted, [key])
  assert.equal(rig.files.has(key), false)

  // Removing it twice is removing nothing: no entry, no object, so 404 rather
  // than a cheerful lie. This is the case the orphan path must not swallow.
  await assert.rejects(
    () => rig.service.removePublished(`Bearer ${grant.token}`, "viz-sounds", url),
    (error: { status: number; code: string }) => error.status === 404 && error.code === "not_found",
  )
  assert.deepEqual(rig.files.deleted, [key])

  // And a key outside this destination's prefix is still refused outright,
  // before anything is read or deleted.
  await assert.rejects(
    () => rig.service.removePublished(
      `Bearer ${grant.token}`,
      "viz-sounds",
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/product-pages/anything.jpg",
    ),
    (error: { status: number; code: string }) => error.status === 403 && error.code === "destination_denied",
  )
})

test("a published file still leaves the catalogue and the object together", async () => {
  const rig = setup()
  const invited = await rig.service.createInvite(rig.identity(ADMIN), {
    destinationId: "viz-sounds",
    recipientEmail: VIZ_EMAIL,
  })
  const grant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), invited.inviteId)
  const begun = await rig.service.begin(`Bearer ${grant.token}`, audio("viz-sounds"))
  const key = rig.files.issued()?.key ?? ""
  await rig.service.complete(`Bearer ${grant.token}`, begun.uploadReceipt)
  assert.equal(JSON.parse(rig.catalogue.snapshot("site-manager/viz/index.json") ?? "{}").items.length, 1)

  const url = `https://777records777productpageassets.s3.us-east-2.amazonaws.com/${key}`
  assert.deepEqual(
    await rig.service.removePublished(`Bearer ${grant.token}`, "viz-sounds", url),
    { removed: true },
  )
  assert.equal(JSON.parse(rig.catalogue.snapshot("site-manager/viz/index.json") ?? "{}").items.length, 0)
  assert.deepEqual(rig.files.deleted, [key])
})

test("every publishable media type survives the website's parser", async () => {
  /*
   The guard the two tables never had.

   core.ts decides what may be uploaded; the storefront decides what may be
   rendered. They were written apart and drifted: SIX of the service's content
   types were absent from MEDIA_RULES, and because that parser refuses the
   WHOLE document over one unreadable row, publishing any of them would have
   emptied the artist's shelf instead of adding to it - silently, since the
   page just falls back to its static content.

   Checking the lists against each other would not have caught it: the service
   records the type the CLIENT sent, so the question is what ends up in the
   manifest, not what the table says. So this publishes one real file of every
   type the service accepts and hands the result to the website's own parser.
  */
  for (const [contentType, rule] of Object.entries(CONTENT_TYPES)) {
    const mediaKind = rule.kinds[0]
    // movies take video and nothing else; sounds take everything but video.
    const toMovies = rule.kinds.includes("video") && mediaKind === "video"
    const destinationId = toMovies ? "viz-movies" : "viz-sounds"
    const manifestUrl =
      "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/index.json"

    const rig = setup()
    const invited = await rig.service.createInvite(rig.identity(ADMIN), {
      destinationId,
      recipientEmail: VIZ_EMAIL,
    })
    const grant = await rig.service.acceptInvite(rig.identity(VIZ, VIZ_EMAIL), invited.inviteId)
    const begun = await rig.service.begin(`Bearer ${grant.token}`, {
      ...audio(destinationId),
      mediaKind,
      contentType,
      filename: `master.${rule.extension}`,
      title: `A ${contentType} file`,
    })
    await rig.service.complete(`Bearer ${grant.token}`, begun.uploadReceipt)

    const written = rig.catalogue.snapshot("site-manager/viz/index.json")
    assert.ok(written, `${contentType}: nothing was written`)
    assert.ok(
      parseSiteManagerManifest(written, manifestUrl),
      `${contentType} published a manifest the website refuses, which empties the whole shelf`
    )

    // And the manifest records the canonical spelling, not the alias, because
    // the alias is exactly what the website cannot read.
    const parsed = JSON.parse(written)
    const row = [...(parsed.items ?? []), ...(parsed.movies ?? [])][0]
    assert.ok(row, `${contentType}: no row in the manifest`)
    if (!toMovies) {
      assert.equal(
        row.contentType,
        canonicalContentType(contentType),
        `${contentType}: the manifest kept the alias`
      )
    }
  }
})

test("what the service writes, the website accepts - bundle included", () => {
  /*
   The guard this file did not have.

   Every other test here asks whether the manifest is what this service meant
   to write. None asked whether the WEBSITE would take it, and the two have
   separate rules: the storefront's parser rejects a manifest in which an item
   id is also a release id, because one id must name one thing, and it rejects
   the WHOLE manifest rather than the offending row.

   A bundle's key is its release - that is what makes a rebuild overwrite
   rather than orphan a 70 MB object - and `itemId` reads an id off the key,
   so the bundle item arrived carrying the release's own id. The first bundle
   anybody built would have taken that artist's entire Site Manager shelf off
   their page, films included, while the upload reported success. Caught by
   running the real parser, which is why it is imported here rather than
   restated.
  */
  const manifestUrl = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/dion/index.json"
  const base = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/dion"
  const release = "036b3a02-7a65-44d9-9e6f-a5bdc7b820ae"
  const at = "2026-10-29T00:00:00.000Z"

  const publish = (raw: string | null, over: Record<string, unknown>) =>
    applyCatalogue(raw, {
      contentLength: 1,
      checksumSha256: checksum,
      destinationId: "dionysus-savior-sounds",
      section: "sounds",
      releaseId: release,
      ...over,
    } as never, at).body

  // A manifest with no `releases` array never grows one - that is deliberate,
  // and documented in applyCatalogue - so the page starts as a release page.
  const seeded = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: at,
    items: [],
    releases: [],
  })

  let raw = publish(seeded, {
    key: `${release.replace("036b", "11cc")}.wav`,
    publicUrl: `${base}/${release.replace("036b", "11cc")}.wav`,
    title: "IN TIME",
    contentType: "audio/wav",
    mediaKind: "audio",
  })
  assert.ok(parseSiteManagerManifest(raw, manifestUrl), "the audio alone is accepted")

  // The bundle's key IS the release. That is deliberate and must stay.
  raw = publish(raw, {
    key: `${release}.om7`,
    publicUrl: `${base}/${release}.om7`,
    title: "IN TIME",
    contentType: "application/octet-stream",
    mediaKind: "bundle",
  })

  const written = JSON.parse(raw)
  const bundle = written.items.find((item: { kind: string }) => item.kind === "bundle")
  assert.equal(written.releases.length, 1, "the bundle joined the release, it did not start one")
  assert.equal(written.releases[0].bundle, bundle.id)
  assert.notEqual(bundle.id, written.releases[0].id, "an item id is never a release id")

  const parsed = parseSiteManagerManifest(raw, manifestUrl)
  assert.ok(parsed, "the website still accepts the manifest once a bundle is in it")
  assert.equal(parsed.items.length, 2)
  assert.equal(parsed.releases?.length, 1)

  // Same release, rebuilt: same key, same id, still accepted, still one item.
  const again = publish(raw, {
    key: `${release}.om7`,
    publicUrl: `${base}/${release}.om7`,
    title: "IN TIME",
    contentType: "application/octet-stream",
    mediaKind: "bundle",
    contentLength: 2,
  })
  const rebuilt = JSON.parse(again)
  assert.equal(rebuilt.items.length, 2, "a rebuild replaces the bundle, it does not add one")
  assert.equal(rebuilt.items.find((i: { kind: string }) => i.kind === "bundle").id, bundle.id)
  assert.ok(parseSiteManagerManifest(again, manifestUrl), "and the rebuild is still accepted")
})

test("the page list names the commerce releases too, and refuses to remove one", () => {
  /*
   Gone Crazy, New Deal on Dion's page, and Goddess of Love are releases
   now. New Deal is still a commerce product on Viz's page. The service has
   no authority over it, so it is named and the removal path refuses it.
  */
  const destination = destinationById("viz-sounds")
  assert.ok(destination)
  const store = storeItemsFor(destination)
  assert.deepEqual(store.map((item) => item.title), ["New Deal"])

  const published = "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/22222222-2222-4222-8222-222222222222.wav"
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [{
      id: "22222222-2222-4222-8222-222222222222",
      kind: "audio",
      title: "DIONYSUS SAVIOR - IN TIME",
      url: published,
      contentType: "audio/wav",
      bytes: 1,
      publishedAt: "2026-10-29T00:00:00.000Z",
    }],
  })

  const entries = pageCatalogue(raw, "sounds", store, "the admin portal")
  assert.deepEqual(entries.map((entry) => [entry.title, entry.removable]), [
    ["DIONYSUS SAVIOR - IN TIME", true],
    ["New Deal", false],
  ])
  assert.equal(entries[1]?.managedBy, "the admin portal")

  // What the phone is told, and what the service would actually allow, are
  // two different checks. A caller that ignores the flag still gets nowhere.
  for (const item of store) {
    assert.equal(objectKeyFor(destination, item.url), null)
  }

  // A declared item already in the manifest is one row, not two.
  const twice = pageCatalogue(raw, "sounds", [...store, { id: "x", title: "In Time again", url: published }], "the admin portal")
  assert.equal(twice.length, 2)
})

test("a first publish starts a release, and an old list without one stays a list", () => {
  const audio = {
    key: "site-manager/viz/33333333-3333-4333-8333-333333333333.wav",
    publicUrl: "https://example.test/song.wav",
    mediaKind: "audio" as const,
    contentType: "audio/wav",
    contentLength: 1,
    checksumSha256: checksum,
    downloadName: "song.wav",
    title: "Goddess of Love",
    destinationId: "viz-sounds" as const,
    section: "sounds" as const,
    releaseId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  }
  const created = JSON.parse(applyCatalogue(null, audio, "2026-11-13T00:00:00.000Z").body)
  assert.equal(created.releases.length, 1)
  assert.equal(created.releases[0].title, "Goddess of Love")
  assert.equal(created.releases[0].audio, "33333333-3333-4333-8333-333333333333")
  assert.ok(parseSiteManagerManifest(JSON.stringify(created), "https://example.test/index.json", "store"))

  const older = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [],
  })
  const kept = JSON.parse(applyCatalogue(older, audio, "2026-11-13T00:00:00.000Z").body)
  assert.equal(kept.releases, undefined)
  assert.equal(kept.items.length, 1)
})

test("credited names match the roster and land as handles on the release", () => {
  /*
   The shop shows a release on every page named in artistHandles, and never
   compares names. Matching here, with no approval step, is safe today only
   because an admin issues every publishing grant.
  */
  assert.deepEqual(artistHandlesFor(["Dionysus Savior", "Viz"]), [
    "dionysus-savior",
    "viz",
  ])
  assert.equal(artistHandlesFor(["Nobody"]), undefined)

  const body = applyCatalogue(
    JSON.stringify({
      protocol: "om7.site-manager.manifest",
      version: 1,
      items: [],
      releases: [],
    }),
    {
      key: "site-manager/dion/dddddddd-4444-4444-8444-dddddddddddd.wav",
      publicUrl: "https://example.test/dddddddd-4444-4444-8444-dddddddddddd.wav",
      mediaKind: "audio",
      contentType: "audio/wav",
      contentLength: 1,
      checksumSha256: checksum,
      downloadName: "song.wav",
      title: "New Deal",
      destinationId: "dionysus-savior-sounds",
      section: "sounds",
      releaseId: "cccccccc-3333-4333-8333-cccccccccccc",
      artists: ["Dionysus Savior", "Viz"],
    },
    "2026-11-14T00:00:00.000Z"
  ).body
  const parsed = JSON.parse(body)
  assert.deepEqual(parsed.releases[0].artists, ["Dionysus Savior", "Viz"])
  assert.deepEqual(parsed.releases[0].artistHandles, ["dionysus-savior", "viz"])
  assert.ok(parseSiteManagerManifest(body, "https://example.test/index.json", "store"))
})

test("a reel joins its audio when both carry the same release id", () => {
  /*
   Every completion used to append a release with one role filled, so a song
   and the reel that plays behind it arrived as two entries and nothing could
   pair them. The id travels inside the signed receipt.
  */
  const releaseId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
  const base = {
    contentLength: 1,
    checksumSha256: checksum,
    destinationId: "viz-sounds" as const,
    section: "sounds" as const,
    releaseId,
  }
  const empty = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [],
    releases: [],
  })

  // The reel lands first, which is the order that used to break it.
  const afterReel = applyCatalogue(empty, {
    ...base,
    key: "site-manager/viz/22222222-2222-4222-8222-222222222222.mp4",
    publicUrl: "https://example.test/loop.mp4",
    mediaKind: "reel",
    contentType: "video/mp4",
    downloadName: "loop.mp4",
    title: "In Time (loop)",
  }, "2026-10-28T00:00:00.000Z").body

  const afterAudio = applyCatalogue(afterReel, {
    ...base,
    key: "site-manager/viz/33333333-3333-4333-8333-333333333333.mp3",
    publicUrl: "https://example.test/in-time.mp3",
    mediaKind: "audio",
    contentType: "audio/mpeg",
    downloadName: "in-time.mp3",
    title: "In Time",
  }, "2026-10-28T00:01:00.000Z").body

  const manifest = JSON.parse(afterAudio)
  assert.equal(manifest.items.length, 2)
  assert.equal(manifest.releases.length, 1, "one song, not two")
  const release = manifest.releases[0]
  assert.equal(release.id, releaseId)
  assert.equal(release.audio, "33333333-3333-4333-8333-333333333333")
  assert.equal(release.reel, "22222222-2222-4222-8222-222222222222")
  // The audio names the song even though the reel was published first.
  assert.equal(release.title, "In Time")
  // And the page lists it once.
  assert.equal(listCatalogue(afterAudio, "sounds").length, 1)
})

test("a rebuilt bundle replaces itself instead of orphaning the last one", () => {
  /*
   A bundle's key is its release, so the second build lands on the same URL
   with different bytes. Everything else at a URL already present is a
   retried completion and must stay unchanged.
  */
  const releaseId = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
  const url = `https://example.test/${releaseId}.om7`
  const bundle = (bytes: number) => ({
    key: `site-manager/viz/${releaseId}.om7`,
    publicUrl: url,
    mediaKind: "bundle" as const,
    contentType: "application/zip",
    contentLength: bytes,
    checksumSha256: checksum,
    downloadName: "release.om7",
    title: "In Time",
    destinationId: "viz-sounds" as const,
    section: "sounds" as const,
    releaseId,
  })
  const empty = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [],
    releases: [],
  })

  const first = applyCatalogue(empty, bundle(100), "2026-10-28T00:00:00.000Z")
  assert.equal(first.unchanged, false)
  const second = applyCatalogue(first.body, bundle(250), "2026-10-28T00:05:00.000Z")
  assert.equal(second.unchanged, false, "a rebuild is a real change")

  const manifest = JSON.parse(second.body)
  assert.equal(manifest.items.length, 1, "one bundle, not an orphan beside it")
  assert.equal(manifest.items[0].bytes, 250, "the size describes what is in storage")
  assert.equal(manifest.releases.length, 1)
  // The release POINTS AT the bundle item; it is not the same id. The key is
  // still the release - that is what makes the rebuild overwrite - but an id
  // that named both would make the website reject the whole manifest.
  assert.equal(manifest.releases[0].bundle, manifest.items[0].id)
  assert.notEqual(manifest.items[0].id, releaseId)
})

test("a retried completion of anything else is still unchanged", () => {
  const published = {
    key: "site-manager/viz/66666666-6666-4666-8666-666666666666.mp3",
    publicUrl: "https://example.test/retry.mp3",
    mediaKind: "audio" as const,
    contentType: "audio/mpeg",
    contentLength: 1,
    checksumSha256: checksum,
    downloadName: "retry.mp3",
    title: "Retry",
    destinationId: "viz-sounds" as const,
    section: "sounds" as const,
  }
  const empty = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [],
    releases: [],
  })
  const once = applyCatalogue(empty, published, "2026-10-28T00:00:00.000Z")
  const twice = applyCatalogue(once.body, published, "2026-10-28T00:05:00.000Z")
  assert.equal(twice.unchanged, true)
  assert.equal(JSON.parse(twice.body).items.length, 1)
})

test("without a release id each file is still its own release", () => {
  const empty = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    items: [],
    releases: [],
  })
  const one = applyCatalogue(empty, {
    key: "site-manager/viz/44444444-4444-4444-8444-444444444444.mp3",
    publicUrl: "https://example.test/one.mp3",
    mediaKind: "audio",
    contentType: "audio/mpeg",
    contentLength: 1,
    checksumSha256: checksum,
    downloadName: "one.mp3",
    title: "One",
    destinationId: "viz-sounds",
    section: "sounds",
  }, "2026-10-28T00:00:00.000Z").body
  const two = applyCatalogue(one, {
    key: "site-manager/viz/55555555-5555-4555-8555-555555555555.mp3",
    publicUrl: "https://example.test/two.mp3",
    mediaKind: "audio",
    contentType: "audio/mpeg",
    contentLength: 1,
    checksumSha256: checksum,
    downloadName: "two.mp3",
    title: "Two",
    destinationId: "viz-sounds",
    section: "sounds",
  }, "2026-10-28T00:01:00.000Z").body
  assert.equal(JSON.parse(two).releases.length, 2)
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

/*
 The three below are about the guard in front of every manifest write, and
 they share a fixture: a row this service would store and the website cannot
 read. `audio/x-aiff` is the real thing rather than a stand-in - it is one of
 the three aliases CONTENT_TYPES accepts and MEDIA_RULES has never had, and
 the only reason a published AIFF is readable today is the canonicalisation
 added on 7 November 2026. Remove that and these tests fail here, at the
 write, instead of on the artist's page.
*/
const VIZ_MANIFEST = manifestLocationFor(destinationById("viz-sounds")!)

const unreadableRow = (id: string) => ({
  id,
  kind: "audio",
  title: "AIFF master",
  url: `https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/${id}.aiff`,
  contentType: "audio/x-aiff",
  bytes: 1024,
  publishedAt: "2026-11-07T00:00:00.000Z",
})

const brokenPage = (...ids: string[]) => JSON.stringify({
  protocol: "om7.site-manager.manifest",
  version: 1,
  updatedAt: "2026-11-07T00:00:00.000Z",
  items: ids.map(unreadableRow),
})

test("the writer refuses a row the website cannot read, and leaves nothing behind", async () => {
  /*
   Refuse at the writer, not at the reader.

   Fixing the four faults made the writer's output a subset of what the parser
   accepts, and `every publishable media type survives the website's parser`
   holds that true. But the two tables are in different packages and were
   already edited apart once, at a cost of weeks. So the parser now runs on
   the body before it is written, and a manifest the website would refuse is
   never stored in the first place.

   The store is asserted empty afterwards because refusing late is the one
   outcome that would be worse than not refusing: a page half replaced is a
   page nobody can reason about.
  */
  const store = manifests()
  await assert.rejects(
    () => commitCatalogue(store, VIZ_MANIFEST, {
      key: "site-manager/viz/22222222-2222-4222-8222-222222222222.aiff",
      publicUrl: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/22222222-2222-4222-8222-222222222222.aiff",
      mediaKind: "audio",
      contentType: "audio/x-aiff",
      contentLength: 1024,
      checksumSha256: checksum,
      downloadName: "master.aiff",
      title: "AIFF master",
      destinationId: "viz-sounds",
      section: "sounds",
    }, "2026-11-07T00:00:00.000Z"),
    (error: { code: string; status: number }) =>
      error.code === "catalogue_unreadable" && error.status === 500,
  )
  assert.equal(store.snapshot(VIZ_MANIFEST.key), null, "the page was written anyway")
})

test("a page the website already refuses is still publishable, not locked", async () => {
  /*
   The exception is the point of the guard, not a hole in it.

   Refusing every write that leaves the page unreadable would mean an artist
   whose manifest is ALREADY unreadable - written before the fixes, or by the
   phone's direct mode, which replaces the object without this protocol - could
   never publish again. The page is no worse for another good row, and the
   artist is much worse off unable to touch it.
  */
  const store = manifests()
  await store.write(VIZ_MANIFEST.key, brokenPage("33333333-3333-4333-8333-333333333333"), null)
  const before = store.snapshot(VIZ_MANIFEST.key)
  assert.equal(parseSiteManagerManifest(before!, VIZ_MANIFEST.url, "store"), null, "the fixture is not broken")

  await commitCatalogue(store, VIZ_MANIFEST, {
    key: "site-manager/viz/44444444-4444-4444-8444-444444444444.wav",
    publicUrl: "https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/44444444-4444-4444-8444-444444444444.wav",
    mediaKind: "audio",
    contentType: "audio/wav",
    contentLength: 2048,
    checksumSha256: checksum,
    downloadName: "master.wav",
    title: "A readable one",
    destinationId: "viz-sounds",
    section: "sounds",
  }, "2026-11-07T01:00:00.000Z")

  const written = JSON.parse(store.snapshot(VIZ_MANIFEST.key) ?? "{}")
  assert.equal(written.items.length, 2, "the good row was not added")
})

test("a broken page can be repaired one removal at a time", async () => {
  /*
   The recovery path, and the reason the exception above is not optional.

   Two unreadable rows take two removals, and after the first one the page is
   still unreadable. A guard without the exception would refuse that first
   removal and the artist could never reach the second - stuck on a page that
   shows none of their work, with the one control that would fix it disabled.
  */
  const store = manifests()
  const first = "55555555-5555-4555-8555-555555555555"
  const second = "66666666-6666-4666-8666-666666666666"
  await store.write(VIZ_MANIFEST.key, brokenPage(first, second), null)

  await commitRemoval(
    store,
    VIZ_MANIFEST,
    { url: unreadableRow(first).url, section: "sounds" },
    "2026-11-07T02:00:00.000Z",
  )
  const halfway = store.snapshot(VIZ_MANIFEST.key)
  assert.equal(JSON.parse(halfway ?? "{}").items.length, 1, "the first removal was refused")
  assert.equal(parseSiteManagerManifest(halfway!, VIZ_MANIFEST.url, "store"), null, "still unreadable, as expected")

  await commitRemoval(
    store,
    VIZ_MANIFEST,
    { url: unreadableRow(second).url, section: "sounds" },
    "2026-11-07T03:00:00.000Z",
  )
  const repaired = store.snapshot(VIZ_MANIFEST.key)
  assert.ok(
    parseSiteManagerManifest(repaired!, VIZ_MANIFEST.url),
    "the page is readable again once the bad rows are gone",
  )
})

test("a photo with a price is listed and removed, and a later upload keeps the price", async () => {
  const artId = "c4d2e3f5-6071-490b-bccd-def012345678"
  const releaseId = "f7a8b9c0-d1e2-4f30-8a4b-5c6d7e8f9012"
  const artUrl = `https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/${artId}.jpg`
  const raw = JSON.stringify({
    protocol: "om7.site-manager.manifest",
    version: 1,
    updatedAt: "2026-11-09T12:00:00.000Z",
    items: [{
      id: artId, kind: "image", title: "Tour Tee", url: artUrl,
      contentType: "image/jpeg", bytes: 220000, publishedAt: "2026-11-09T12:00:00.000Z",
    }],
    releases: [{
      id: releaseId, title: "Tour Tee - Black", audio: null, reel: null,
      artwork: artId, bundle: null, price: null, buyUrl: null, visible: true,
      publishedAt: "2026-11-09T12:00:00.000Z",
    }],
  })
  const listed = listCatalogue(raw, "sounds")
  assert.equal(listed.length, 1, "a photo with nothing to play still has to list")
  assert.equal(listed[0]?.url, artUrl)

  const priced = applySale(raw, releaseId, { price: 3500, buyUrl: "https://buy.stripe.com/test_tee" }, { price: true, buyUrl: true }, "2026-11-09T13:00:00.000Z")
  const afterSale = JSON.parse(priced.body)
  assert.equal(afterSale.releases[0].price, 3500)

  const audioId = "33333333-3333-4333-8333-333333333333"
  const uploaded = applyCatalogue(priced.body, {
    key: `site-manager/viz/${audioId}.mp3`,
    publicUrl: `https://777records777productpageassets.s3.us-east-2.amazonaws.com/site-manager/viz/${audioId}.mp3`,
    mediaKind: "audio",
    contentType: "audio/mpeg",
    contentLength: 2048,
    checksumSha256: checksum,
    downloadName: "tee.mp3",
    title: "In Time",
    destinationId: "viz-sounds",
    section: "sounds",
    releaseId,
  }, "2026-11-09T14:00:00.000Z").body
  const afterUpload = JSON.parse(uploaded)
  assert.equal(afterUpload.releases[0].price, 3500, "the upload wrote over the price")
  assert.equal(afterUpload.releases[0].buyUrl, "https://buy.stripe.com/test_tee")
  assert.equal(afterUpload.releases[0].title, "In Time")

  const removed = removeFromCatalogue(priced.body, { url: artUrl, section: "sounds" }, "2026-11-09T15:00:00.000Z")
  assert.equal(JSON.parse(removed.body).releases.length, 0)
  assert.equal(listCatalogue(removed.body, "sounds").length, 0)

  const store = manifests()
  await store.write(VIZ_MANIFEST.key, raw, null)
  await commitSale(store, VIZ_MANIFEST, releaseId, { price: null, buyUrl: null }, { price: true, buyUrl: true }, "2026-11-09T16:00:00.000Z")
  assert.equal(JSON.parse(store.snapshot(VIZ_MANIFEST.key) ?? "{}").releases[0].price, null)
})

test("an assertion publishes for an invited account and stops when the grant is revoked", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const jwk = { ...publicKey.export({ format: "jwk" }), alg: "ES256", use: "sig", kid: "om7-publish-1" }
  const pem = privateKey.export({ type: "pkcs8", format: "pem" })
  const now = Date.parse("2026-11-10T16:00:00Z")
  const iat = Math.floor(now / 1000)
  const header = Buffer.from(JSON.stringify({ alg: "ES256", typ: "om7-assertion", kid: "om7-publish-1" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: "https://om7.foundation", sub: VIZ, aud: "https://publish.777records777.studio",
    host: "777records777.studio", iat, exp: iat + 600, jti: "fixed",
  })).toString("base64url")
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(pem), dsaEncoding: "ieee-p1363",
  }).toString("base64url")
  const assertion = `${header}.${payload}.${signature}`
  const readAssertion = async (token: string) => verifyPublishAssertion(token, { keys: [jwk] }, {
    audience: "https://publish.777records777.studio", now,
  })
  const files = storage()
  const service = createStudioService({
    store: memoryGrantStore(),
    manifests: manifests(),
    storage: files.fake,
    receiptSecret: "test-only-receipt-secret-that-is-long-enough",
    admins: new Set([ADMIN]),
    readAssertion,
  })
  const invite = await service.createInvite(person(ADMIN), { destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL })
  const accepted = await service.acceptInvite(person(VIZ, VIZ_EMAIL), invite.inviteId)
  const begun = await service.begin(`Bearer ${assertion}`, audio("viz-sounds"))
  assert.ok(begun.uploadReceipt)
  await service.revoke(person(ADMIN), accepted.grantId)
  await assert.rejects(() => service.begin(`Bearer ${assertion}`, audio("viz-sounds")), /not invited/)
})
