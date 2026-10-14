import { randomBytes, createHash } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Issue a Site Manager publishing credential, from the artist's own admin.
 *
 * The problem this exists to solve: the OM7 app showed a field labelled
 * "Publishing credential" and there was nowhere on earth to get one. The
 * answer lived in `runtime.ts` as an environment variable name, which is a
 * fine answer for whoever wrote it and no answer at all for an artist.
 *
 * WHAT IS AND IS NOT STORED. This route mints a random token, returns it once,
 * and keeps nothing. The server only ever holds the SHA-256 digest, which is
 * what `OM7_SITE_MANAGER_TOKEN_SHA256` is compared against with
 * `timingSafeEqual`. A digest cannot be turned back into a token, so even
 * somebody holding the whole environment cannot publish with it. That is why
 * the page says the token is shown once and means it - there is no second copy
 * to go and look at.
 */

const TOKEN_BYTES = 32

const digestOf = (token: string) => createHash("sha256").update(token).digest("hex")

/**
 * What is configured right now, without revealing any of it.
 *
 * Booleans rather than values. The page needs to tell somebody whether
 * publishing will work and which piece is missing; it does not need to show a
 * bucket name or a receipt secret to do that, and an admin screen is still a
 * web page.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const present = (name: string) => Boolean(process.env[name]?.trim())
  const digest = process.env.OM7_SITE_MANAGER_TOKEN_SHA256?.trim() ?? ""

  return res.json({
    configured:
      /^[a-f0-9]{64}$/i.test(digest) &&
      present("OM7_SITE_MANAGER_PUBLIC_BASE_URL") &&
      present("OM7_SITE_MANAGER_RECEIPT_SECRET") &&
      present("OM7_SITE_MANAGER_S3_BUCKET") &&
      present("OM7_SITE_MANAGER_S3_REGION"),
    settings: [
      { name: "OM7_SITE_MANAGER_TOKEN_SHA256", set: /^[a-f0-9]{64}$/i.test(digest) },
      { name: "OM7_SITE_MANAGER_PUBLIC_BASE_URL", set: present("OM7_SITE_MANAGER_PUBLIC_BASE_URL") },
      { name: "OM7_SITE_MANAGER_RECEIPT_SECRET", set: present("OM7_SITE_MANAGER_RECEIPT_SECRET") },
      { name: "OM7_SITE_MANAGER_S3_BUCKET", set: present("OM7_SITE_MANAGER_S3_BUCKET") },
      { name: "OM7_SITE_MANAGER_S3_REGION", set: present("OM7_SITE_MANAGER_S3_REGION") },
    ],
  })
}

export async function POST(_req: MedusaRequest, res: MedusaResponse) {
  // base64url, so it survives being copied through a phone keyboard and a
  // shell without a quoting accident changing it.
  const token = randomBytes(TOKEN_BYTES).toString("base64url")

  return res.status(201).json({
    token,
    tokenSha256: digestOf(token),
    envName: "OM7_SITE_MANAGER_TOKEN_SHA256",
  })
}
