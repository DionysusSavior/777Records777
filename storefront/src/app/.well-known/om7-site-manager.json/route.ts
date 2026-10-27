import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
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
   * Optional in the protocol, and it used to be omitted unless configured, on
   * the reasoning that a link to a page that does not exist is worse than no
   * link. True in general and wrong for this template: /admin ships WITH the
   * template, so on any site built from it the page is always there and the
   * variable was never set - here included. The result was a phone that found
   * a valid endpoint, had no idea where connections came from, and said so.
   *
   * So it now defaults to this site's own /admin and the variable stays as an
   * override for a site that issues them somewhere else. A fork that deletes
   * the admin page must set it, or point it at whatever replaced it.
   *
   * Derived from the request rather than from NEXT_PUBLIC_BASE_URL, which on
   * this deployment carries a trailing space. OM7 ignores a credentialUrl
   * whose host is not the proved domain, and the request's host IS the domain
   * the phone proved, so this is the one source that cannot drift out of it.
   */
  const forwardedHost = request.headers.get("x-forwarded-host")
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https"
  const siteOrigin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(request.url).origin
  const credentialUrl = process.env.OM7_SITE_MANAGER_CREDENTIAL_URL?.trim()
    || `${siteOrigin}/admin`

  return NextResponse.json({
    protocol: "om7.site-manager",
    version: 1,
    endpoint,
    /**
     * This names the endpoint above, which takes a bearer credential, and it
     * is accurate. It is also incomplete, and the gap cost real confusion:
     * /admin does not issue a bearer token, it issues an om7-studio:
     * connection with its own endpoint inside it. Two generations of the same
     * feature are live at once and the document described only the older one,
     * so a phone following it arrived at the wrong field holding the right
     * string.
     *
     * `connection` names the newer one beside it rather than replacing it,
     * because the bearer endpoint is still live and still answers. OM7 reads
     * neither field today; it is here so the next reader is not misled the
     * way this one was.
     */
    authentication: "site-issued-bearer",
    connection: "om7-studio",
    transport: "direct-put",
    ...(credentialUrl ? { credentialUrl } : {}),
  }, {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
