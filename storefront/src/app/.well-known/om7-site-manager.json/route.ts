import { NextResponse } from "next/server"
import { resolveSiteManagerEndpoint } from "@lib/site-manager-discovery"
import { openLinkManifestUrl } from "@lib/open-in-om7"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  /**
   * The endpoint is resolved rather than derived here. It was derived from
   * MEDUSA_BACKEND_URL, which meant publishing could not move off the shop's
   * host without taking the shop with it - see site-manager-discovery.ts for
   * why that mattered on 4 November. OM7_SITE_MANAGER_ENDPOINT now overrides.
   *
   * A malformed value answers 503 instead of throwing. The old code called
   * `new URL()` outside any guard, so a typo in the variable surfaced as a 500
   * from a route whose entire job is to say what IS configured. "Not
   * configured" is the truthful answer and the one a client can act on.
   */
  /**
   * Each variable is named by DIRECT member access, deliberately, and this
   * must not be collapsed back into passing `process.env` itself.
   *
   * Next replaces a literal `process.env.FOO` with its build-time value; it
   * cannot do that for an object passed wholesale, so `resolveSiteManagerEndpoint(process.env, ...)`
   * reads the running Lambda's environment instead. Amplify console variables
   * reach the BUILD, not the SSR runtime, so every read came back undefined,
   * the localhost fallback took over, and requireHttps turned it into a 503 on
   * a correctly configured site. That shipped on 5 November and took discovery
   * down for the length of one build. The old code only worked because it read
   * the variables inline.
   *
   * Necessary, and NOT sufficient: naming a variable here only inlines it if
   * Next is told to inline it. A bare name is not, whatever scope it is set in
   * on Amplify, so OM7_SITE_MANAGER_ENDPOINT is declared in next.config.js's
   * `env` block and discovery named the wrong host for three builds before it
   * was. NEXT_PUBLIC_MEDUSA_BACKEND_URL below needs no such entry - its prefix
   * is what gets it inlined, and it was quietly supplying the old endpoint the
   * whole time.
   */
  const resolved = resolveSiteManagerEndpoint(
    {
      OM7_SITE_MANAGER_ENDPOINT: process.env.OM7_SITE_MANAGER_ENDPOINT,
      MEDUSA_BACKEND_URL: process.env.MEDUSA_BACKEND_URL,
      NEXT_PUBLIC_MEDUSA_BACKEND_URL: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL,
    },
    { requireHttps: process.env.NODE_ENV === "production" }
  )
  if (!resolved.ok) {
    return NextResponse.json({ error: "Site Manager is not configured." }, { status: 503 })
  }
  const endpoint = resolved.endpoint

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

  const manifestUrl = openLinkManifestUrl()

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
    /**
     * Where this site's releases are listed, for a link that opens one in
     * OM7Player. Without it the app reaches this document, finds no manifest
     * named, and tells the listener the site "is not set up to hand releases
     * to OM7Player yet" - which it said for every link until this was added.
     *
     * Optional in the protocol and additive to v1, the way credentialUrl was.
     * One manifest, on a site with two artists: see openLinkManifestUrl for
     * which, and why that is stated and not derived.
     */
    ...(manifestUrl ? { manifestUrl } : {}),
  }, {
    headers: {
      "cache-control": "public, max-age=300",
    },
  })
}
