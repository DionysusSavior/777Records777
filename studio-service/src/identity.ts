import { verify as verifySignature, type KeyObject } from "node:crypto"

export type VerifiedIdentity = { sub: string }

export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
  }
}

const decode = (segment: string) => Buffer.from(segment, "base64url").toString("utf8")

/**
 * An ID token from the studio's Cognito client.
 *
 * Membership in the user pool is not authority. This only answers who is
 * speaking. Grants answer what they may do. The token is never written to a
 * log from here.
 */
export const verifyIdToken = async (
  token: string,
  options: {
    issuer: string
    audience: string
    now?: number
    getKey: (kid: string) => Promise<KeyObject>
  },
): Promise<VerifiedIdentity> => {
  const parts = token.split(".")
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new IdentityError("The sign-in token is not valid.")
  }
  let header: { alg?: string; kid?: string }
  let payload: {
    iss?: string
    aud?: string | string[]
    exp?: number
    token_use?: string
    sub?: string
  }
  try {
    header = JSON.parse(decode(parts[0]))
    payload = JSON.parse(decode(parts[1]))
  } catch {
    throw new IdentityError("The sign-in token is not valid.")
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new IdentityError("The sign-in token is not valid.")
  }
  const key = await options.getKey(header.kid)
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
  const signature = Buffer.from(parts[2], "base64url")
  if (!verifySignature("RSA-SHA256", signed, key, signature)) {
    throw new IdentityError("The sign-in token is not valid.")
  }
  const now = options.now ?? Date.now()
  const audience = payload.aud
  const audienceOk = audience === options.audience ||
    (Array.isArray(audience) && audience.includes(options.audience))
  if (
    payload.iss !== options.issuer ||
    !audienceOk ||
    payload.token_use !== "id" ||
    typeof payload.exp !== "number" ||
    payload.exp * 1000 < now - 60_000 ||
    typeof payload.sub !== "string" ||
    payload.sub.length < 8
  ) {
    throw new IdentityError("The sign-in token is not valid.")
  }
  return { sub: payload.sub }
}
