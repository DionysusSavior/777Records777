import type { createAdminService } from "./admins.ts"
import { SiteManagerError } from "../../backend/src/site-manager/core.ts"
import { CatalogueError } from "./catalogue.ts"
import { IdentityError, type VerifiedIdentity } from "./identity.ts"
import type { StudioService } from "./grants.ts"

const MAX_BODY = 8_192

export type HandlerDeps = {
  people?: ReturnType<typeof createAdminService>
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
/**
 * `publicOrigin` is the address the phone will call. It is never taken from
 * the Host header: a caller who can set that header must not be able to point
 * a connection string at a site they control. Null refuses the two calls that
 * hand a connection to a person, before any invite is consumed or any grant
 * changes.
 */
export const handle = async (
  request: Request,
  deps: HandlerDeps,
  publicOrigin: string | null = null,
): Promise<Response> => {
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

  const requireOrigin = () => {
    if (!publicOrigin) {
      throw new SiteManagerError(503, "site_unavailable", "The publishing service has no public address yet.")
    }
    return publicOrigin
  }

  try {
    const path = url.pathname.replace(/\/+$/, "") || "/"
    if (request.method === "GET" && (path === "/" || path === "/discovery")) {
      return json(200, deps.service.discovery(), cors)
    }

    if (request.method === "GET" && path === "/catalogue") {
      return json(200, await deps.service.catalogue(
        request.headers.get("authorization") ?? undefined,
        url.searchParams.get("destinationId"),
      ), cors)
    }
    if (request.method === "POST" && path === "/catalogue/remove") {
      const body = await readJson(request)
      return json(200, await deps.service.removePublished(
        request.headers.get("authorization") ?? undefined,
        body.destinationId,
        body.url,
      ), cors)
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
    if (deps.people && path.startsWith("/people/")) {
      const people = deps.people
      if (request.method === "GET" && path === "/people/status") return json(200, await people.status(identity), cors)
      if (request.method === "POST") {
        const body = await readJson(request)
        if (path === "/people/setup") return json(200, await people.setup(identity), cors)
        if (path === "/people/invite") return json(201, await people.invite(identity, body.email), cors)
        if (path === "/people/accept") return json(200, await people.accept(identity, body.inviteId), cors)
        if (path === "/people/remove") return json(200, await people.remove(identity, body.sub), cors)
        if (path === "/people/cancel") return json(200, await people.cancel(identity, body.inviteId), cors)
      }
    }
    if (request.method === "POST" && path === "/admin/invites") {
      const body = await readJson(request)
      return json(201, await deps.service.createInvite(identity, body), cors)
    }
    if (request.method === "POST" && path === "/me/invites/view") {
      const body = await readJson(request)
      return json(200, await deps.service.viewInvite(identity, body.inviteId), cors)
    }
    if (request.method === "POST" && path === "/admin/invites/accept") {
      const endpoint = requireOrigin()
      const body = await readJson(request)
      const accepted = await deps.service.acceptInvite(identity, body.inviteId)
      return json(201, { ...accepted, connection: connectionDocument(endpoint, accepted) }, cors)
    }
    if (request.method === "GET" && path === "/me/grants") {
      return json(200, { grants: await deps.service.listOwn(identity) }, cors)
    }
    if (request.method === "POST" && path === "/me/grants/rotate") {
      const endpoint = requireOrigin()
      const body = await readJson(request)
      const rotated = await deps.service.rotateOwn(identity, body.grantId)
      return json(200, { ...rotated, connection: connectionDocument(endpoint, rotated) }, cors)
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
      return json(200, await deps.service.forceReconnect(identity, body.grantId), cors)
    }
    return json(404, { error: { code: "not_found", message: "Nothing is published at that path." } }, cors)
  } catch (error) {
    const response = fail(error)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(cors)) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
}

export const connectionDocument = (
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
