import { SiteManagerError } from "../../backend/src/site-manager/core.ts"
import { CatalogueError } from "./catalogue.ts"
import { IdentityError, type VerifiedIdentity } from "./identity.ts"
import type { StudioService } from "./grants.ts"

const MAX_BODY = 8_192

export type HandlerDeps = {
  service: StudioService
  allowedOrigins: readonly string[]
  verifyIdentity: (authorization: string | undefined) => Promise<VerifiedIdentity>
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  })

const fail = (error: unknown) => {
  if (error instanceof SiteManagerError || error instanceof CatalogueError) {
    return json(error.status, { error: { code: error.code, message: error.message } })
  }
  if (error instanceof IdentityError) {
    return json(401, { error: { code: "unauthorized", message: error.message } })
  }
  return json(503, {
    error: { code: "site_unavailable", message: "The site's publishing service is unavailable." },
  })
}

const readJson = async (request: Request) => {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    throw new SiteManagerError(413, "invalid_request", "That request is too large.")
  }
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY) {
    throw new SiteManagerError(413, "invalid_request", "That request is too large.")
  }
  if (!text) return {}
  try {
    const body = JSON.parse(text) as unknown
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("shape")
    }
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof SiteManagerError) throw error
    throw new SiteManagerError(400, "invalid_request", "The request could not be read.")
  }
}

/**
 * Bearer tokens, not cookies, so a browser page on the studio origin cannot
 * be talked into a mutation by another site. The publishing token is a
 * different bearer from the sign-in token and is checked in the service.
 */
export const handle = async (request: Request, deps: HandlerDeps): Promise<Response> => {
  const url = new URL(request.url)
  const origin = request.headers.get("origin")
  const allow = origin !== null && deps.allowedOrigins.includes(origin)
  const cors: Record<string, string> = allow
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        vary: "Origin",
      }
    : {}
  if (request.method === "OPTIONS") {
    return new Response(null, { status: allow ? 204 : 403, headers: cors })
  }

  try {
    const path = url.pathname.replace(/\/+$/, "") || "/"
    if (request.method === "GET" && (path === "/" || path === "/discovery")) {
      return json(200, deps.service.discovery(), cors)
    }

    if (request.method === "POST" && path === "/uploads") {
      const body = await readJson(request)
      return json(201, await deps.service.begin(request.headers.get("authorization") ?? undefined, body), cors)
    }
    if (request.method === "POST" && path === "/uploads/complete") {
      const body = await readJson(request)
      return json(200, await deps.service.complete(request.headers.get("authorization") ?? undefined, body.uploadReceipt), cors)
    }

    const identity = await deps.verifyIdentity(request.headers.get("authorization") ?? undefined)
    if (request.method === "POST" && path === "/admin/invites") {
      const body = await readJson(request)
      return json(201, await deps.service.createInvite(identity, body), cors)
    }
    if (request.method === "POST" && path === "/admin/invites/accept") {
      const body = await readJson(request)
      const accepted = await deps.service.acceptInvite(identity, body.inviteId)
      return json(201, {
        ...accepted,
        connection: connectionDocument(url.origin, accepted),
      }, cors)
    }
    if (request.method === "GET" && path === "/admin/grants") {
      return json(200, { grants: await deps.service.list(identity) }, cors)
    }
    if (request.method === "POST" && path === "/admin/grants/revoke") {
      const body = await readJson(request)
      return json(200, await deps.service.revoke(identity, body.grantId), cors)
    }
    if (request.method === "POST" && path === "/admin/grants/rotate") {
      const body = await readJson(request)
      const rotated = await deps.service.rotate(identity, body.grantId)
      return json(200, rotated, cors)
    }
    return json(404, { error: { code: "not_found", message: "Nothing is published at that path." } }, cors)
  } catch (error) {
    const response = fail(error)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(cors)) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
}

const connectionDocument = (
  endpoint: string,
  accepted: { token: string; destination: { id: string; artistName: string; siteHost: string; section: string; pageUrl: string }; prefix: string },
) => {
  const payload = {
    endpoint: endpoint.endsWith("/") ? endpoint : `${endpoint}/`,
    token: accepted.token,
    destinationId: accepted.destination.id,
    artistName: accepted.destination.artistName,
    siteHost: accepted.destination.siteHost,
    section: accepted.destination.section,
    pageUrl: accepted.destination.pageUrl,
    prefix: accepted.prefix,
  }
  return `om7-studio:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`
}
