import { createPublicKey, verify, type JsonWebKey } from "node:crypto"

/**
 * Check an OM7 publishing assertion.
 *
 * The signer lives in the directory (`assertion.mjs`). This is the site's
 * half: signature, the ten-minute lifetime, and that the token was made for
 * THIS site. The caller still has to match `host` to the destination and
 * `sub` to a grant. A valid assertion with no grant publishes nothing.
 */
const ISSUER = "https://om7.foundation"
const KID = "om7-publish-1"
const TTL_SECONDS = 600

export type PublishAssertion = { sub: string; host: string; aud: string }

export const verifyPublishAssertion = (
  token: string,
  jwks: { keys?: JsonWebKey[] },
  expected: { audience: string; now?: number },
): PublishAssertion => {
  const parts = token.split(".")
  if (parts.length !== 3 || token.length > 4096) throw new Error("The publishing assertion is not valid.")
  const [headerPart, payloadPart, signaturePart] = parts
  let header: { alg?: string; kid?: string }
  let payload: { iss?: string; aud?: string; host?: string; sub?: string; iat?: number; exp?: number }
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"))
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"))
  } catch {
    throw new Error("The publishing assertion is not valid.")
  }
  const jwk = (jwks.keys ?? []).find((key) => key.kid === KID && key.alg === "ES256")
  if (!jwk || header.alg !== "ES256" || header.kid !== KID) throw new Error("The publishing assertion is not valid.")
  const ok = verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signaturePart, "base64url"),
  )
  if (!ok) throw new Error("The publishing assertion is not valid.")
  const at = Math.floor((expected.now ?? Date.now()) / 1000)
  if (payload.iss !== ISSUER || payload.aud !== expected.audience) {
    throw new Error("The publishing assertion is not for this site.")
  }
  if (typeof payload.sub !== "string" || !/^[\w-]{1,128}$/.test(payload.sub) || typeof payload.host !== "string") {
    throw new Error("The publishing assertion is not valid.")
  }
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)
    || payload.iat > at + 60 || payload.exp <= at || payload.exp - payload.iat !== TTL_SECONDS) {
    throw new Error("The publishing assertion has expired.")
  }
  return { sub: payload.sub, host: payload.host.toLowerCase(), aud: payload.aud }
}
