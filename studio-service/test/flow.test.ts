import assert from "node:assert/strict"
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto"
import { test } from "node:test"
import type { PublishStorage } from "../../backend/src/site-manager/core.ts"
import type { ManifestStore } from "../src/catalogue.ts"
import { createStudioService, memoryGrantStore } from "../src/grants.ts"
import { handle, type HandlerDeps } from "../src/handler.ts"
import { acceptReceiptSecret, handler, serve, type LambdaEvent } from "../src/index.ts"

const ADMIN = "admin-sub-1"
const VIZ = "viz-sub-1111"
const VIZ_EMAIL = "viz@example.test"
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })

const tokenFor = (sub: string, email?: string) => {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: "https://cognito-idp.us-east-2.amazonaws.com/pool",
    aud: "studio-client",
    token_use: "id",
    exp: Math.floor(Date.now() / 1000) + 600,
    sub,
    ...(email ? { email, email_verified: true } : {}),
  })).toString("base64url")
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")
  return `${header}.${payload}.${signature}`
}

const deps = (): HandlerDeps => {
  let issued = 0
  const storage: PublishStorage = {
    async issueUpload() {
      return { url: "https://uploads.example.test/file", headers: {}, expiresAt: "2026-10-25T12:15:00.000Z" }
    },
    async inspectUpload() { return null },
  }
  const manifests: ManifestStore = {
    async read() { return null },
    async write() { return { etag: "e" } },
  }
  return {
    service: createStudioService({
      store: memoryGrantStore(),
      manifests,
      storage,
      receiptSecret: "test-only-receipt-secret-that-is-long-enough",
      admins: new Set([ADMIN]),
      now: () => Date.parse("2026-10-25T12:00:00.000Z"),
      mintToken: () => `token-${issued++}`,
    }),
    allowedOrigins: ["https://777records777.studio"],
    verifyIdentity: async (authorization) => {
      const match = authorization?.match(/^Bearer ([^\s]+)$/i)
      if (!match) throw new Error("missing")
      const payload = JSON.parse(Buffer.from(match[1].split(".")[1], "base64url").toString()) as {
        sub: string
        email?: string
        email_verified?: boolean
      }
      return {
        sub: payload.sub,
        email: payload.email ?? null,
        emailVerified: payload.email_verified === true,
      }
    },
  }
}

void publicKey

const call = async (
  service: HandlerDeps,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  origin: string | null = "https://example.lambda-url.us-east-2.on.aws",
) => {
  const response = await handle(new Request(`https://studio.internal${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      origin: "https://777records777.studio",
    },
    body: body ? JSON.stringify(body) : undefined,
  }), service, origin)
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

const decode = (connection: string) => {
  const raw = connection.slice("om7-studio:".length).replaceAll("-", "+").replaceAll("_", "/")
  return JSON.parse(Buffer.from(raw, "base64").toString()) as { endpoint: string; token: string; destinationId: string }
}

test("two accounts: only the invited person accepts, and an admin never receives the token", async () => {
  const service = deps()
  const admin = tokenFor(ADMIN)
  const viz = tokenFor(VIZ, VIZ_EMAIL)
  const created = await call(service, "POST", "/admin/invites", admin, {
    destinationId: "viz-sounds",
    recipientEmail: VIZ_EMAIL,
  })
  assert.equal(created.status, 201)
  const inviteId = created.body.inviteId
  assert.equal(created.body.acceptUrl, `https://777records777.studio/admin?invite=${inviteId}`)

  const strangerView = await call(service, "POST", "/me/invites/view", admin, { inviteId })
  assert.equal(strangerView.status, 403)
  const preview = await call(service, "POST", "/me/invites/view", viz, { inviteId })
  assert.equal(preview.status, 200)
  assert.equal((preview.body.destination as { label: string }).label, "Viz → 777records777.studio → Sounds")

  const adminAccept = await call(service, "POST", "/admin/invites/accept", admin, { inviteId })
  assert.equal(adminAccept.status, 403)
  const accepted = await call(service, "POST", "/admin/invites/accept", viz, { inviteId })
  assert.equal(accepted.status, 201)
  const connection = decode(String(accepted.body.connection))
  assert.equal(connection.endpoint, "https://example.lambda-url.us-east-2.on.aws/")
  assert.equal(connection.destinationId, "viz-sounds")
  const replay = await call(service, "POST", "/me/invites/view", viz, { inviteId })
  assert.equal(replay.status, 410)

  const own = await call(service, "GET", "/me/grants", viz)
  const ownGrants = own.body.grants as Array<{ id: string }>
  assert.equal(ownGrants.length, 1)
  const dionOwn = await call(service, "GET", "/me/grants", admin)
  assert.deepEqual(dionOwn.body.grants, [])

  const stolen = await call(service, "POST", "/me/grants/rotate", admin, { grantId: ownGrants[0].id })
  assert.equal(stolen.status, 403)
  const cut = await call(service, "POST", "/admin/grants/rotate", admin, { grantId: ownGrants[0].id })
  assert.equal(cut.status, 200)
  assert.equal(cut.body.reconnectRequired, true)
  assert.equal("token" in cut.body, false)
  assert.equal("connection" in cut.body, false)

  const begin = await handle(new Request("https://studio.internal/uploads", {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      filename: "a.mp3",
      mediaKind: "audio",
      contentType: "audio/mpeg",
      contentLength: 4,
      checksumSha256: "abcd",
      destinationId: "viz-sounds",
    }),
  }), service, connection.endpoint)
  assert.equal(begin.status, 401)

  const fresh = await call(service, "POST", "/me/grants/rotate", viz, { grantId: ownGrants[0].id })
  assert.equal(fresh.status, 200)
  const next = decode(String(fresh.body.connection))
  assert.notEqual(next.token, connection.token)
  assert.equal(next.endpoint, "https://example.lambda-url.us-east-2.on.aws/")
})

test("a spoofed Host header cannot choose the connection endpoint", async () => {
  const service = deps()
  const event: LambdaEvent = {
    rawPath: "/admin/invites",
    headers: { host: "evil.example", authorization: `Bearer ${tokenFor(ADMIN)}`, "content-type": "application/json" },
    body: JSON.stringify({ destinationId: "viz-sounds", recipientEmail: VIZ_EMAIL }),
    requestContext: { http: { method: "POST" }, domainName: "abc123.lambda-url.us-east-2.on.aws" },
  }
  const created = await serve(event, service, {})
  assert.equal(created.statusCode, 201)
  const inviteId = (JSON.parse(created.body) as { inviteId: string }).inviteId
  const accept = await serve({
    rawPath: "/admin/invites/accept",
    headers: { host: "evil.example", authorization: `Bearer ${tokenFor(VIZ, VIZ_EMAIL)}`, "content-type": "application/json" },
    body: JSON.stringify({ inviteId }),
    requestContext: { http: { method: "POST" }, domainName: "abc123.lambda-url.us-east-2.on.aws" },
  }, service, {})
  assert.equal(accept.statusCode, 201)
  const connection = decode((JSON.parse(accept.body) as { connection: string }).connection)
  assert.equal(connection.endpoint, "https://abc123.lambda-url.us-east-2.on.aws/")
})

test("accept with no trustworthy origin does not consume the invite", async () => {
  const service = deps()
  const created = await call(service, "POST", "/admin/invites", tokenFor(ADMIN), {
    destinationId: "viz-sounds",
    recipientEmail: VIZ_EMAIL,
  }, null)
  const inviteId = created.body.inviteId
  const accepted = await call(service, "POST", "/admin/invites/accept", tokenFor(VIZ, VIZ_EMAIL), { inviteId }, null)
  assert.equal(accepted.status, 503)
  const still = await call(service, "POST", "/me/invites/view", tokenFor(VIZ, VIZ_EMAIL), { inviteId }, null)
  assert.equal(still.status, 200)
})

/**
 * A Lambda event in, a decoded connection out.
 *
 * The connection document tells a phone where to publish for as long as the
 * grant lives, so the endpoint inside it is the one value in this service that
 * must never come from the caller. An earlier version built it from the
 * request URL, which on a Function URL means the Host header - so anyone able
 * to send a request could mint a connection pointing a phone at their own
 * host. These two tests are the contract: the event decides, and a header
 * cannot argue with it.
 */
const acceptThrough = async (
  service: HandlerDeps,
  event: Partial<LambdaEvent>,
  env: { publicOrigin?: string },
) => {
  const created = await call(service, "POST", "/admin/invites", tokenFor(ADMIN), {
    destinationId: "viz-sounds",
    recipientEmail: VIZ_EMAIL,
  })
  assert.equal(created.status, 201)
  return serve(
    {
      ...event,
      rawPath: "/admin/invites/accept",
      // Merged last and deliberately: a spread of `event` would replace the
      // whole headers object and quietly drop the authorization, which fails
      // as a 401 that looks nothing like the thing under test.
      headers: {
        authorization: `Bearer ${tokenFor(VIZ, VIZ_EMAIL)}`,
        "content-type": "application/json",
        origin: "https://777records777.studio",
        ...(event.headers ?? {}),
      },
      body: JSON.stringify({ inviteId: created.body.inviteId }),
      requestContext: { http: { method: "POST" }, ...(event.requestContext ?? {}) },
    } as LambdaEvent,
    service,
    env,
  )
}

test("the connection endpoint comes from the event, and a Host header cannot move it", async () => {
  const response = await acceptThrough(
    deps(),
    {
      headers: { host: "attacker.example.com", "x-forwarded-host": "attacker.example.com" },
      requestContext: { http: { method: "POST" }, domainName: "abc123.lambda-url.us-east-2.on.aws" },
    },
    {},
  )
  assert.equal(response.statusCode, 201)
  const { endpoint } = decode((JSON.parse(response.body) as { connection: string }).connection)
  assert.equal(endpoint, "https://abc123.lambda-url.us-east-2.on.aws/")
})

test("a configured public origin wins over the event's own domain", async () => {
  const response = await acceptThrough(
    deps(),
    { requestContext: { http: { method: "POST" }, domainName: "abc123.lambda-url.us-east-2.on.aws" } },
    { publicOrigin: "https://publish.777records777.studio" },
  )
  assert.equal(response.statusCode, 201)
  const { endpoint } = decode((JSON.parse(response.body) as { connection: string }).connection)
  assert.equal(endpoint, "https://publish.777records777.studio/")
})

test("a short receipt secret is refused without the value being named", () => {
  assert.throws(() => acceptReceiptSecret("too-short"), /not configured/)
  assert.throws(() => acceptReceiptSecret("PLACEHOLDER"), /not configured/)
  assert.equal(acceptReceiptSecret("x".repeat(32)).length, 32)
})

test("the service refuses to run until it is told which secret to read", async () => {
  const previous = process.env.STUDIO_RECEIPT_SECRET_ID
  delete process.env.STUDIO_RECEIPT_SECRET_ID
  const response = await handler({ rawPath: "/discovery", requestContext: { http: { method: "GET" } } })
  if (previous === undefined) delete process.env.STUDIO_RECEIPT_SECRET_ID
  else process.env.STUDIO_RECEIPT_SECRET_ID = previous
  assert.equal(response.statusCode, 503)
  assert.equal(response.body.includes("studio/publishing-receipt"), false)
})

test("an unusable configured origin refuses to serve", async () => {
  const refused = await serve({ rawPath: "/discovery", requestContext: { http: { method: "GET" } } }, deps(), {
    publicOrigin: "http://studio.internal/extra",
  })
  assert.equal(refused.statusCode, 503)
})

void (null as KeyObject | null)
