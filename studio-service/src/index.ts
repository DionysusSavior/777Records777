import { createAdminService } from "./admins.ts"
import { dynamoAdminStore } from "./admin-store.ts"
import { createPublicKey, type KeyObject } from "node:crypto"
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager"
import { S3PublishStorage } from "../../backend/src/site-manager/s3-adapter.ts"
import { DESTINATIONS } from "./destinations.ts"
import { handle, type HandlerDeps } from "./handler.ts"
import { IdentityError, verifyIdToken } from "./identity.ts"
import { createStudioService, memoryGrantStore } from "./grants.ts"
import { dynamoGrantStore, s3ManifestStore } from "./aws.ts"
import { sendStudioInvite } from "./mail.ts"

/**
 * The studio publishing service. Render does not run this file.
 *
 * The environment holds the secret's name, not its value. The value is read
 * once per warm process and kept in memory. It is never logged and never
 * put on a response. A missing or short value refuses every request.
 */
const tableName = process.env.STUDIO_GRANTS_TABLE?.trim() ?? ""
const issuer = process.env.STUDIO_COGNITO_ISSUER?.trim() ?? ""
const audience = process.env.STUDIO_COGNITO_CLIENT_ID?.trim() ?? ""
const admins = new Set(
  (process.env.STUDIO_ADMIN_SUBS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
)

/** Rejects a value that must not be used to sign receipts. The message names no value. */
export const acceptReceiptSecret = (value: string | undefined) => {
  const trimmed = value?.trim() ?? ""
  if (trimmed.length < 32 || trimmed === "PLACEHOLDER") {
    throw new Error("The publishing service is not configured.")
  }
  return trimmed
}

const secrets = new SecretsManagerClient({})
let warm: { id: string; deps: HandlerDeps } | null = null

const depsFor = (receiptSecret: string): HandlerDeps => {
  if (!tableName) throw new Error("The studio membership store is not configured.")
  const people = createAdminService(dynamoAdminStore(tableName), admins, process.env.STUDIO_INVITE_FROM?.trim() ? sendStudioInvite : undefined)
  return ({
  people,
  service: createStudioService({
    store: tableName ? dynamoGrantStore(tableName) : memoryGrantStore(),
    manifests: s3ManifestStore(DESTINATIONS[0].bucket, DESTINATIONS[0].region),
    storage: new S3PublishStorage({
      bucket: DESTINATIONS[0].bucket,
      region: DESTINATIONS[0].region,
    }),
    receiptSecret,
    admins,
    authorizeAdmin: people.authorize,
    sendInvite: process.env.STUDIO_INVITE_FROM?.trim() ? sendStudioInvite : undefined,
  }),
  allowedOrigins: ["https://777records777.studio"],
  verifyIdentity: (authorization) => {
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)
    if (!match) throw new IdentityError("The sign-in token is not valid.")
    return verifyIdToken(match[1], {
      issuer,
      audience,
      getKey: (kid) => jwks(kid),
    })
  },
})
}

const keys = new Map<string, KeyObject>()

const jwks = async (kid: string) => {
  const cached = keys.get(kid)
  if (cached) return cached
  const response = await fetch(`${issuer}/.well-known/jwks.json`)
  if (!response.ok) throw new Error("The sign-in keys could not be read.")
  const body = await response.json() as { keys?: Array<{ kid?: string }> }
  const jwk = body.keys?.find((key) => key.kid === kid)
  if (!jwk) throw new Error("The sign-in token is not valid.")
  const key = createPublicKey({ key: jwk as never, format: "jwk" })
  keys.set(kid, key)
  return key
}

export type LambdaEvent = {
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string | undefined>
  body?: string | null
  isBase64Encoded?: boolean
  requestContext?: { http?: { method?: string }; domainName?: string }
}

const LAMBDA_URL_HOST = /^[a-z0-9]+\.lambda-url\.us-east-2\.on\.aws$/

/**
 * STUDIO_PUBLIC_ORIGIN wins when it is set. A set but unusable value refuses
 * the process rather than falling through to a header. Otherwise only the
 * domain API Gateway puts on a Function URL event is trusted.
 */
export const resolvePublicOrigin = (
  configuredOrigin: string | undefined,
  domainName: string | undefined,
): string | null | "invalid" => {
  const raw = configuredOrigin?.trim() ?? ""
  if (raw) {
    try {
      const url = new URL(raw)
      const bare = url.protocol === "https:" && url.username === "" && url.password === ""
        && (url.pathname === "/" || url.pathname === "") && url.search === "" && url.hash === ""
      return bare ? url.origin : "invalid"
    } catch {
      return "invalid"
    }
  }
  if (domainName && LAMBDA_URL_HOST.test(domainName)) return `https://${domainName}`
  return null
}

const notConfigured = () => ({
  statusCode: 503,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    error: { code: "site_unavailable", message: "The publishing service is not configured." },
  }),
})

export const serve = async (
  event: LambdaEvent,
  service: HandlerDeps | null,
  env: { publicOrigin?: string },
) => {
  if (!service) return notConfigured()
  const origin = resolvePublicOrigin(env.publicOrigin, event.requestContext?.domainName)
  if (origin === "invalid") return notConfigured()
  const headers = new Headers()
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value)
  }
  const method = event.requestContext?.http?.method ?? "GET"
  const body = event.body
    ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body)
    : undefined
  const request = new Request(`https://studio.internal${event.rawPath ?? "/"}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  })
  const response = await handle(request, service, origin)
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  }
}

const receiptFor = async (id: string) => {
  const found = await secrets.send(new GetSecretValueCommand({ SecretId: id }))
  return acceptReceiptSecret(found.SecretString)
}

export const handler = async (event: LambdaEvent) => {
  const id = process.env.STUDIO_RECEIPT_SECRET_ID?.trim() ?? ""
  if (!id) return notConfigured()
  try {
    if (!warm || warm.id !== id) {
      warm = { id, deps: depsFor(await receiptFor(id)) }
    }
    return serve(event, warm.deps, { publicOrigin: process.env.STUDIO_PUBLIC_ORIGIN })
  } catch {
    warm = null
    return notConfigured()
  }
}
