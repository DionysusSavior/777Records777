import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const backend = process.env.MEDUSA_BACKEND_URL
    ?? process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
    ?? "http://localhost:9000"
  const backendUrl = new URL(backend)
  if (process.env.NODE_ENV === "production" && backendUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Site Manager is not configured." }, { status: 503 })
  }
  const endpoint = new URL("/om7/site-manager/v1", backendUrl).toString().replace(/\/$/, "")

  /**
   * Where an artist gets the credential, named rather than assumed.
   *
   * Optional in the protocol and omitted unless configured, because a link to
   * a page that does not exist is worse than no link. OM7 ignores it unless it
   * is HTTPS on this exact domain, so a value pointing anywhere else is the
   * same as saying nothing.
   */
  const credentialUrl = process.env.OM7_SITE_MANAGER_CREDENTIAL_URL?.trim()

  return NextResponse.json({
    protocol: "om7.site-manager",
    version: 1,
    endpoint,
    authentication: "site-issued-bearer",
    transport: "direct-put",
    ...(credentialUrl ? { credentialUrl } : {}),
  }, {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
