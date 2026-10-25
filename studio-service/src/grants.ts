import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import {
  SiteManagerError,
  createSiteManager,
  type PublishStorage,
  type PublishedObject,
} from "../../backend/src/site-manager/core.ts"
import { commitCatalogue, type ManifestStore } from "./catalogue.ts"
import {
  DESTINATIONS,
  UPLOAD_TTL_SECONDS,
  destinationById,
  labelFor,
  type StudioDestination,
} from "./destinations.ts"

/** A warm instance may serve a grant it loaded this recently. Revocation is not instant. */
export const GRANT_FRESHNESS_MS = 30_000
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const BEGIN_LIMIT = 60
const BEGIN_WINDOW_MS = 60 * 60 * 1000

export type StudioGrant = {
  id: string
  destinationId: string
  principalSub: string
  tokenSha256: string
  version: number
  revokedAt: number | null
}

export type StudioInvite = {
  id: string
  destinationId: string
  recipientSub: string
  expiresAt: number
  consumedAt: number | null
}

export interface GrantStore {
  putInvite(invite: StudioInvite): Promise<void>
  getInvite(id: string): Promise<StudioInvite | null>
  /**
   * One successful consume. A second call, a different person, and an expired
   * invite all return null and change nothing.
   */
  consumeInvite(id: string, recipientSub: string, now: number): Promise<StudioInvite | null>
  putGrant(grant: StudioGrant): Promise<void>
  getGrant(id: string): Promise<StudioGrant | null>
  getGrantByHash(tokenSha256: string): Promise<StudioGrant | null>
  listGrants(): Promise<StudioGrant[]>
}

export const memoryGrantStore = (): GrantStore => {
  const invites = new Map<string, StudioInvite>()
  const grants = new Map<string, StudioGrant>()
  return {
    async putInvite(invite) {
      invites.set(invite.id, invite)
    },
    async getInvite(id) {
      return invites.get(id) ?? null
    },
    async consumeInvite(id, recipientSub, now) {
      const invite = invites.get(id)
      if (!invite || invite.consumedAt !== null || invite.expiresAt <= now) return null
      if (!safeEqual(invite.recipientSub, recipientSub)) return null
      const consumed = { ...invite, consumedAt: now }
      invites.set(id, consumed)
      return consumed
    },
    async putGrant(grant) {
      grants.set(grant.id, grant)
    },
    async getGrant(id) {
      return grants.get(id) ?? null
    },
    async getGrantByHash(tokenSha256) {
      for (const grant of grants.values()) {
        if (grant.revokedAt === null && safeEqual(grant.tokenSha256, tokenSha256)) return grant
      }
      return null
    },
    async listGrants() {
      return [...grants.values()]
    },
  }
}

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

const bearer = (authorization: string | undefined) => {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

export type StudioIdentity = { sub: string }

export type StudioService = ReturnType<typeof createStudioService>

export const createStudioService = (options: {
  store: GrantStore
  manifests: ManifestStore
  storage: PublishStorage
  receiptSecret: string
  admins: ReadonlySet<string>
  now?: () => number
  freshnessMs?: number
  mintToken?: () => string
}) => {
  const now = options.now ?? Date.now
  const freshnessMs = options.freshnessMs ?? GRANT_FRESHNESS_MS
  const mintToken = options.mintToken ?? (() => randomBytes(32).toString("base64url"))
  const cache = new Map<string, { grant: StudioGrant; at: number }>()
  const begins = new Map<string, { window: number; count: number }>()

  const requireAdmin = (identity: StudioIdentity) => {
    if (!options.admins.has(identity.sub)) {
      throw new SiteManagerError(403, "forbidden", "This account is not a studio administrator.")
    }
  }

  const requireSub = (value: unknown) => {
    if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{8,128}$/.test(value)) {
      throw new SiteManagerError(400, "invalid_request", "The recipient has to be their account id, not an email address.")
    }
    return value
  }

  const forget = (tokenSha256: string) => {
    cache.delete(tokenSha256)
  }

  const resolveGrant = async (authorization: string | undefined, destinationId: unknown) => {
    const destination = destinationById(destinationId)
    if (!destination) {
      throw new SiteManagerError(403, "destination_denied", "That is not a publishing destination on this site.")
    }
    const token = bearer(authorization)
    if (!token) {
      throw new SiteManagerError(401, "unauthorized", "The publishing credential is not valid.")
    }
    const tokenSha256 = hashToken(token)
    const hit = cache.get(tokenSha256)
    const fresh = hit !== undefined && now() - hit.at < freshnessMs
    const grant = fresh ? hit.grant : await options.store.getGrantByHash(tokenSha256)
    if (!fresh && grant) cache.set(tokenSha256, { grant, at: now() })
    if (!grant || grant.revokedAt !== null || !safeEqual(grant.tokenSha256, tokenSha256)) {
      cache.delete(tokenSha256)
      throw new SiteManagerError(401, "unauthorized", "The publishing credential is not valid.")
    }
    if (grant.destinationId !== destination.id) {
      throw new SiteManagerError(403, "destination_denied", "This credential does not publish to that destination.")
    }
    return {
      keyPrefix: destination.prefix,
      publicBaseUrl: destination.publicBaseUrl,
      destinationId: destination.id,
      grantId: grant.id,
      grantVersion: grant.version,
      section: destination.section,
    }
  }

  const noteBegin = (grantId: string) => {
    const at = now()
    const current = begins.get(grantId)
    if (!current || at - current.window >= BEGIN_WINDOW_MS) {
      begins.set(grantId, { window: at, count: 1 })
      return
    }
    if (current.count >= BEGIN_LIMIT) {
      throw new SiteManagerError(429, "rate_limited", "Too many uploads were started for this destination. Wait and retry.")
    }
    current.count += 1
  }

  const manager = createSiteManager({
    tokenSha256: "0".repeat(64),
    receiptSecret: options.receiptSecret,
    publicBaseUrl: DESTINATIONS[0].publicBaseUrl,
    keyPrefix: "unused",
    maxBytes: 5 * 1024 * 1024 * 1024,
    uploadTtlSeconds: UPLOAD_TTL_SECONDS,
    receiptTtlSeconds: 86_400,
    resolveGrant,
    onPublished: async (published: PublishedObject) => {
      const destination = destinationById(published.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That is not a publishing destination on this site.")
      }
      await commitCatalogue(
        options.manifests,
        destination.manifestKey,
        published,
        new Date(now()).toISOString(),
      )
      return { pageUrl: destination.pageUrl }
    },
  }, options.storage)

  const publicDestination = (destination: StudioDestination) => ({
    id: destination.id,
    artistName: destination.artistName,
    siteHost: destination.siteHost,
    section: destination.section,
    pageUrl: destination.pageUrl,
    label: labelFor(destination),
  })

  return {
    discovery: () => ({
      protocol: "om7.site-manager",
      version: 1,
      capabilities: ["destinations"],
      credentialUrl: "https://777records777.studio/studio-admin",
      destinations: DESTINATIONS.map(publicDestination),
    }),
    begin: async (authorization: string | undefined, raw: Parameters<typeof manager.begin>[1]) => {
      const scope = await resolveGrant(authorization, raw.destinationId)
      noteBegin(scope.grantId)
      return manager.begin(authorization, raw)
    },
    complete: manager.complete,
    async createInvite(identity: StudioIdentity, body: { destinationId?: unknown; recipientSub?: unknown }) {
      requireAdmin(identity)
      const destination = destinationById(body.destinationId)
      if (!destination) {
        throw new SiteManagerError(400, "invalid_request", "Choose one artist and one section.")
      }
      const recipientSub = requireSub(body.recipientSub)
      const invite: StudioInvite = {
        id: randomUUID(),
        destinationId: destination.id,
        recipientSub,
        expiresAt: now() + INVITE_TTL_MS,
        consumedAt: null,
      }
      await options.store.putInvite(invite)
      return {
        inviteId: invite.id,
        expiresAt: new Date(invite.expiresAt).toISOString(),
        destination: publicDestination(destination),
      }
    },
    async acceptInvite(identity: StudioIdentity, inviteId: unknown) {
      if (typeof inviteId !== "string") {
        throw new SiteManagerError(400, "invalid_request", "The invitation is missing.")
      }
      const invite = await options.store.consumeInvite(inviteId, identity.sub, now())
      if (!invite) {
        throw new SiteManagerError(403, "invite_denied", "That invitation is not for this account, or it has already been used.")
      }
      const destination = destinationById(invite.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That destination no longer exists.")
      }
      const token = mintToken()
      const grant: StudioGrant = {
        id: randomUUID(),
        destinationId: destination.id,
        principalSub: identity.sub,
        tokenSha256: hashToken(token),
        version: 1,
        revokedAt: null,
      }
      await options.store.putGrant(grant)
      return {
        token,
        destination: publicDestination(destination),
        prefix: destination.prefix,
        label: labelFor(destination),
      }
    },
    async revoke(identity: StudioIdentity, grantId: unknown) {
      requireAdmin(identity)
      if (typeof grantId !== "string") {
        throw new SiteManagerError(400, "invalid_request", "Name the grant to revoke.")
      }
      const grant = await options.store.getGrant(grantId)
      if (!grant) throw new SiteManagerError(404, "not_found", "That grant does not exist.")
      const revoked = { ...grant, revokedAt: now() }
      await options.store.putGrant(revoked)
      forget(grant.tokenSha256)
      return { grantId: grant.id, revoked: true }
    },
    async rotate(identity: StudioIdentity, grantId: unknown) {
      requireAdmin(identity)
      if (typeof grantId !== "string") {
        throw new SiteManagerError(400, "invalid_request", "Name the grant to rotate.")
      }
      const grant = await options.store.getGrant(grantId)
      if (!grant || grant.revokedAt !== null) {
        throw new SiteManagerError(404, "not_found", "That grant does not exist.")
      }
      const destination = destinationById(grant.destinationId)
      if (!destination) throw new SiteManagerError(404, "not_found", "That destination does not exist.")
      const token = mintToken()
      const next = { ...grant, tokenSha256: hashToken(token), version: grant.version + 1 }
      await options.store.putGrant(next)
      forget(grant.tokenSha256)
      return { token, version: next.version, label: labelFor(destination) }
    },
    async list(identity: StudioIdentity) {
      requireAdmin(identity)
      const grants = await options.store.listGrants()
      return grants.map((grant) => ({
        id: grant.id,
        destinationId: grant.destinationId,
        principalSub: grant.principalSub,
        version: grant.version,
        revoked: grant.revokedAt !== null,
        label: destinationById(grant.destinationId)
          ? labelFor(destinationById(grant.destinationId) as StudioDestination)
          : grant.destinationId,
      }))
    },
  }
}
