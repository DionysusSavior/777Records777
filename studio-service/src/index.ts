import { createPublicKey } from "node:crypto"
import { S3PublishStorage } from "../../backend/src/site-manager/s3-adapter.ts"
import { DESTINATIONS } from "./destinations.ts"
import { handle, type HandlerDeps } from "./handler.ts"
import { IdentityError, verifyIdToken } from "./identity.ts"
import { createStudioService, memoryGrantStore } from "./grants.ts"
import { dynamoGrantStore, s3ManifestStore } from "./aws.ts"

/**
 * The studio publishing service. Render does not run this file.
 *
 * The receipt secret is injected by CloudFormation from Secrets Manager at
 * deploy time. This process reads the environment. It does not fetch or log
 * the value. A missing value refuses every request rather than publishing
 * with an empty secret.
 */
const receiptSecret = process.env.STUDIO_RECEIPT_SECRET?.trim() ?? ""
const configured = receiptSecret.length >= 32 && receiptSecret !== "PLACEHOLDER"
const tableName = process.env.STUDIO_GRANTS_TABLE?.trim() ?? ""
const issuer = process.env.STUDIO_COGNITO_ISSUER?.trim() ?? ""
const audience = process.env.STUDIO_COGNITO_CLIENT_ID?.trim() ?? ""
const admins = new Set(
  (process.env.STUDIO_ADMIN_SUBS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
)

const deps: HandlerDeps | null = configured
  ? {
      service: createStudioService({
        store: tableName ? dynamoGrantStore(tableName) : memoryGrantStore(),
        manifests: s3ManifestStore(DESTINATIONS[0].bucket, DESTINATIONS[0].region),
        storage: new S3PublishStorage({
          bucket: DESTINATIONS[0].bucket,
          region: DESTINATIONS[0].region,
        }),
        receiptSecret,
        admins,
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
    }
  : null

const keys = new Map<string, ReturnType<typeof createPublicKey>>()

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

type LambdaEvent = {
  rawPath?: string
  rawQueryString?: string
  headers?: Record<string, string | undefined>
  body?: string | null
  isBase64Encoded?: boolean
  requestContext?: { http?: { method?: string } }
}

export const handler = async (event: LambdaEvent) => {
  if (!deps) {
    return {
      statusCode: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: { code: "site_unavailable", message: "The publishing service is not configured." },
      }),
    }
  }
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
  const response = await handle(request, deps)
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  }
}
