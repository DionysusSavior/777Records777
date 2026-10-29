import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import {
  SiteManagerError,
  createSiteManager,
  type PublishStorage,
  type PublishedObject,
} from "../../backend/src/site-manager/core.ts"
import { commitCatalogue, commitRemoval, pageCatalogue, type ManifestStore } from "./catalogue.ts"
import {
  DESTINATIONS,
  UPLOAD_TTL_SECONDS,
  destinationById,
  labelFor,
  objectKeyFor,
  type StudioDestination,
} from "./destinations.ts"
import { storeItemsFor } from "./page-items.ts"

/**
 * A warm instance may serve a grant it loaded this recently. Revocation is not
 * instant. The bound only holds because every authority read is strongly
 * consistent; an eventually consistent read could add its own staleness.
 */
export const GRANT_FRESHNESS_MS = 30_000
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const BEGIN_LIMIT = 60
export const BEGIN_WINDOW_MS = 60 * 60 * 1000
const ADMIN_PAGE = "https://777records777.studio/admin"

export type StudioGrant = {
  id: string
  destinationId: string
  principalSub: string
  /** Null once an administrator forces a reconnect, and after revocation. */
  tokenSha256: string | null
  version: number
  revokedAt: number | null
  reconnectRequired: boolean
}

export type StudioInvite = {
  id: string
  destinationId: string
  /** Lower case. The link is not enough: the signed-in account's verified email has to match. */
  recipientEmail: string
  expiresAt: number
  consumedAt: number | null
}

/**
 * Every grant change is conditional on the version the caller read, so two
 * changes made from one snapshot cannot both land. A token and the pointer
 * that finds it change together or not at all. Nothing un-revokes a grant.
 */
/** The roster version observed when this caller was confirmed as an administrator. */
export type AdminProof = { sub: string; version: number }

export interface GrantStore {
  putInvite(invite: StudioInvite, admin?: AdminProof): Promise<void>
  getInvite(id: string): Promise<StudioInvite | null>
  /**
   * Consumes the invite and creates the grant and its token pointer at once.
   * Null, with nothing changed, when the invite is missing, used, expired, for
   * somebody else or for another destination.
   */
  createGrantFromInvite(
    grant: StudioGrant,
    consume: { inviteId: string; recipientEmail: string; now: number },
  ): Promise<StudioGrant | null>
  getGrant(id: string): Promise<StudioGrant | null>
  getGrantByHash(tokenSha256: string): Promise<StudioGrant | null>
  listGrants(): Promise<StudioGrant[]>
  /** New token, next version, reconnect cleared. Throws `conflict` unless `expected` is current and unrevoked. */
  rotateGrant(expected: StudioGrant, tokenSha256: string): Promise<StudioGrant>
  /** No token, next version, reconnect required. Throws `conflict` on the same terms as rotateGrant. */
  forceReconnect(expected: StudioGrant, admin?: AdminProof): Promise<StudioGrant>
  /** Final and idempotent. Retries past a concurrent change instead of losing to it. Null for an unknown grant. */
  revokeGrant(grantId: string, now: number, admin?: AdminProof): Promise<StudioGrant | null>
  /** Counts one begin in the window. False, without counting, once `limit` are counted. */
  noteBegin(input: { grantId: string; windowStart: number; limit: number; expiresAt: number }): Promise<boolean>
}

export const grantConflict = () =>
  new SiteManagerError(409, "conflict", "The grant changed. Reload and try again.")

export const memoryGrantStore = (roster?: {
  holds(sub: string, version: number): boolean
}): GrantStore => {
  const invites = new Map<string, StudioInvite>()
  const grants = new Map<string, StudioGrant>()
  const pointers = new Map<string, string>()
  const begins = new Map<string, number>()

  const current = (expected: StudioGrant) => {
    const found = grants.get(expected.id)
    if (!found || found.version !== expected.version || found.revokedAt !== null) throw grantConflict()
    return found
  }

  const commit = (previous: StudioGrant, next: StudioGrant) => {
    if (next.tokenSha256 !== null && pointers.has(next.tokenSha256)) throw grantConflict()
    if (previous.tokenSha256 !== null) pointers.delete(previous.tokenSha256)
    if (next.tokenSha256 !== null) pointers.set(next.tokenSha256, next.id)
    grants.set(next.id, next)
    return { ...next }
  }

  const getGrant = async (id: string) => {
    const found = grants.get(id)
    return found ? { ...found } : null
  }

  const hold = (admin?: AdminProof) => {
    if (!admin) return
    if (!roster?.holds(admin.sub, admin.version)) throw grantConflict()
  }

  return {
    async putInvite(invite, admin) {
      hold(admin)
      invites.set(invite.id, { ...invite })
    },
    async getInvite(id) {
      const found = invites.get(id)
      return found ? { ...found } : null
    },
    async createGrantFromInvite(grant, consume) {
      const invite = invites.get(consume.inviteId)
      if (
        !invite ||
        invite.consumedAt !== null ||
        invite.expiresAt <= consume.now ||
        invite.destinationId !== grant.destinationId ||
        !safeEqual(invite.recipientEmail, consume.recipientEmail)
      ) {
        return null
      }
      if (grant.tokenSha256 === null || grants.has(grant.id) || pointers.has(grant.tokenSha256)) {
        throw grantConflict()
      }
      invites.set(invite.id, { ...invite, consumedAt: consume.now })
      grants.set(grant.id, { ...grant })
      pointers.set(grant.tokenSha256, grant.id)
      return { ...grant }
    },
    getGrant,
    async getGrantByHash(tokenSha256) {
      const grantId = pointers.get(tokenSha256)
      const grant = grantId === undefined ? null : await getGrant(grantId)
      if (!grant || grant.revokedAt !== null || grant.tokenSha256 !== tokenSha256) return null
      return grant
    },
    async listGrants() {
      return [...grants.values()].map((grant) => ({ ...grant }))
    },
    async rotateGrant(expected, tokenSha256) {
      const found = current(expected)
      return commit(found, { ...found, tokenSha256, version: found.version + 1, reconnectRequired: false })
    },
    async forceReconnect(expected, admin) {
      hold(admin)
      const found = current(expected)
      return commit(found, { ...found, tokenSha256: null, version: found.version + 1, reconnectRequired: true })
    },
    async revokeGrant(grantId, now, admin) {
      hold(admin)
      const found = grants.get(grantId)
      if (!found) return null
      if (found.revokedAt !== null) return { ...found }
      return commit(found, { ...found, tokenSha256: null, version: found.version + 1, revokedAt: now })
    },
    async noteBegin({ grantId, windowStart, limit }) {
      const key = `${grantId}#${windowStart}`
      const count = begins.get(key) ?? 0
      if (count >= limit) return false
      begins.set(key, count + 1)
      return true
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

export type StudioIdentity = { sub: string; email?: string | null; emailVerified?: boolean }

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/

export const normalizeEmail = (value: unknown) => {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return EMAIL.test(email) ? email : null
}

export type StudioService = ReturnType<typeof createStudioService>

export const createStudioService = (options: {
  store: GrantStore
  manifests: ManifestStore
  storage: PublishStorage
  receiptSecret: string
  admins: ReadonlySet<string>
  authorizeAdmin?: (identity: StudioIdentity) => Promise<number>
  now?: () => number
  freshnessMs?: number
  mintToken?: () => string
  sendInvite?: (message: { to: string; acceptUrl: string; label: string }) => Promise<void>
  deleteObject?: (key: string) => Promise<void>
}) => {
  const now = options.now ?? Date.now
  const freshnessMs = options.freshnessMs ?? GRANT_FRESHNESS_MS
  const mintToken = options.mintToken ?? (() => randomBytes(32).toString("base64url"))
  const cache = new Map<string, { grant: StudioGrant; at: number }>()

  const requireAdmin = async (identity: StudioIdentity): Promise<AdminProof | null> => {
    if (options.authorizeAdmin) {
      return { sub: identity.sub, version: await options.authorizeAdmin(identity) }
    }
    if (!options.admins.has(identity.sub)) {
      throw new SiteManagerError(403, "forbidden", "This account is not a studio administrator.")
    }
    return null
  }

  const asAdmin = async <T>(identity: StudioIdentity, run: (admin: AdminProof | null) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const admin = await requireAdmin(identity)
      try {
        return await run(admin)
      } catch (error) {
        if (!(error instanceof SiteManagerError) || error.code !== "conflict" || attempt === 7) throw error
      }
    }
    throw grantConflict()
  }

  const requireEmail = (value: unknown) => {
    const email = normalizeEmail(value)
    if (!email) {
      throw new SiteManagerError(400, "invalid_request", "Enter the person's email address.")
    }
    return email
  }

  const emailMatches = (identity: StudioIdentity, recipientEmail: string) => {
    const email = normalizeEmail(identity.email)
    return identity.emailVerified === true && email !== null && safeEqual(email, recipientEmail)
  }

  const requireEmailMatch = (identity: StudioIdentity, recipientEmail: string) => {
    const email = normalizeEmail(identity.email)
    if (email !== null && safeEqual(email, recipientEmail) && identity.emailVerified !== true) {
      throw new SiteManagerError(403, "email_unverified", "That account's email is not confirmed yet.")
    }
    if (!emailMatches(identity, recipientEmail)) throw inviteDenied()
  }

  const requireId = (value: unknown, message: string) => {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      throw new SiteManagerError(400, "invalid_request", message)
    }
    return value
  }

  const inviteDenied = () =>
    new SiteManagerError(403, "invite_denied", "That invitation is not for this account, or it has already been used.")

  const grantNotFound = () => new SiteManagerError(404, "not_found", "That grant does not exist.")

  const forgetGrant = (grantId: string) => {
    for (const [tokenSha256, entry] of cache) {
      if (entry.grant.id === grantId) cache.delete(tokenSha256)
    }
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
    if (
      !grant ||
      grant.revokedAt !== null ||
      grant.tokenSha256 === null ||
      !safeEqual(grant.tokenSha256, tokenSha256)
    ) {
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

  const noteBegin = async (grantId: string) => {
    const windowStart = Math.floor(now() / BEGIN_WINDOW_MS) * BEGIN_WINDOW_MS
    const counted = await options.store.noteBegin({
      grantId,
      windowStart,
      limit: BEGIN_LIMIT,
      expiresAt: Math.ceil((windowStart + 2 * BEGIN_WINDOW_MS) / 1000),
    })
    if (!counted) {
      throw new SiteManagerError(429, "rate_limited", "Too many uploads were started for this destination. Wait and retry.")
    }
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

  const labelOf = (grant: StudioGrant) => {
    const destination = destinationById(grant.destinationId)
    return destination ? labelFor(destination) : grant.destinationId
  }

  const issued = (grant: StudioGrant, token: string, destination: StudioDestination) => ({
    grantId: grant.id,
    version: grant.version,
    token,
    destination: publicDestination(destination),
    prefix: destination.prefix,
    label: labelFor(destination),
  })

  return {
    discovery: () => ({
      protocol: "om7.site-manager",
      version: 1,
      capabilities: ["destinations"],
      credentialUrl: ADMIN_PAGE,
      destinations: DESTINATIONS.map(publicDestination),
    }),
    begin: async (authorization: string | undefined, raw: Parameters<typeof manager.begin>[1]) => {
      const scope = await resolveGrant(authorization, raw.destinationId)
      await noteBegin(scope.grantId)
      return manager.begin(authorization, raw)
    },
    complete: manager.complete,
    async createInvite(identity: StudioIdentity, body: { destinationId?: unknown; recipientEmail?: unknown }) {
      const destination = destinationById(body.destinationId)
      if (!destination) {
        throw new SiteManagerError(400, "invalid_request", "Choose one artist and one section.")
      }
      const recipientEmail = requireEmail(body.recipientEmail)
      const invite: StudioInvite = {
        id: randomUUID(),
        destinationId: destination.id,
        recipientEmail,
        expiresAt: now() + INVITE_TTL_MS,
        consumedAt: null,
      }
      await asAdmin(identity, (admin) => options.store.putInvite(invite, admin ?? undefined))
      const acceptUrl = `${ADMIN_PAGE}?invite=${encodeURIComponent(invite.id)}`
      let mailed = false
      if (options.sendInvite) {
        try {
          await options.sendInvite({ to: recipientEmail, acceptUrl, label: labelFor(destination) })
          mailed = true
        } catch {
          mailed = false
        }
      }
      return {
        inviteId: invite.id,
        expiresAt: new Date(invite.expiresAt).toISOString(),
        destination: publicDestination(destination),
        acceptUrl,
        mailed,
      }
    },
    /** A missing invite and somebody else's invite look the same, so an id proves nothing to a stranger. */
    async viewInvite(identity: StudioIdentity, inviteId: unknown) {
      const id = requireId(inviteId, "The invitation is missing.")
      const invite = await options.store.getInvite(id)
      if (!invite) throw inviteDenied()
      requireEmailMatch(identity, invite.recipientEmail)
      if (invite.consumedAt !== null) {
        throw new SiteManagerError(410, "invite_used", "This invitation has already been accepted.")
      }
      if (invite.expiresAt <= now()) {
        throw new SiteManagerError(410, "invite_expired", "This invitation has expired. Ask for a new one.")
      }
      const destination = destinationById(invite.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That destination no longer exists.")
      }
      return {
        inviteId: invite.id,
        expiresAt: new Date(invite.expiresAt).toISOString(),
        destination: publicDestination(destination),
      }
    },
    async acceptInvite(identity: StudioIdentity, inviteId: unknown) {
      const id = requireId(inviteId, "The invitation is missing.")
      const at = now()
      const invite = await options.store.getInvite(id)
      if (
        !invite ||
        invite.consumedAt !== null ||
        invite.expiresAt <= at
      ) {
        throw inviteDenied()
      }
      requireEmailMatch(identity, invite.recipientEmail)
      const destination = destinationById(invite.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That destination no longer exists.")
      }
      const token = mintToken()
      const grant = await options.store.createGrantFromInvite({
        id: randomUUID(),
        destinationId: destination.id,
        principalSub: identity.sub,
        tokenSha256: hashToken(token),
        version: 1,
        revokedAt: null,
        reconnectRequired: false,
      }, { inviteId: id, recipientEmail: invite.recipientEmail, now: at })
      if (!grant) throw inviteDenied()
      return issued(grant, token, destination)
    },
    async listOwn(identity: StudioIdentity) {
      const grants = await options.store.listGrants()
      return grants
        .filter((grant) => safeEqual(grant.principalSub, identity.sub))
        .map((grant) => ({
          id: grant.id,
          destinationId: grant.destinationId,
          label: labelOf(grant),
          version: grant.version,
          revoked: grant.revokedAt !== null,
          reconnectRequired: grant.reconnectRequired,
        }))
    },
    async rotateOwn(identity: StudioIdentity, grantId: unknown) {
      const id = requireId(grantId, "Name the grant to rotate.")
      const grant = await options.store.getGrant(id)
      if (!grant) throw grantNotFound()
      if (!safeEqual(grant.principalSub, identity.sub)) {
        throw new SiteManagerError(403, "forbidden", "That grant belongs to another account.")
      }
      const destination = destinationById(grant.destinationId)
      if (grant.revokedAt !== null || !destination) throw grantNotFound()
      const token = mintToken()
      const next = await options.store.rotateGrant(grant, hashToken(token))
      forgetGrant(grant.id)
      return issued(next, token, destination)
    },
    async revoke(identity: StudioIdentity, grantId: unknown) {
      const id = requireId(grantId, "Name the grant to revoke.")
      const revoked = await asAdmin(identity, (admin) => options.store.revokeGrant(id, now(), admin ?? undefined))
      if (!revoked) throw grantNotFound()
      forgetGrant(id)
      return { grantId: id, revoked: true }
    },
    /** The administrator never sees the artist's token. The holder fetches a new one with rotateOwn. */
    async forceReconnect(identity: StudioIdentity, grantId: unknown) {
      const id = requireId(grantId, "Name the grant to rotate.")
      const grant = await options.store.getGrant(id)
      if (!grant || grant.revokedAt !== null) throw grantNotFound()
      const next = await asAdmin(identity, (admin) => options.store.forceReconnect(grant, admin ?? undefined))
      forgetGrant(grant.id)
      return { grantId: next.id, version: next.version, reconnectRequired: true }
    },
    async catalogue(authorization: string | undefined, destinationId: unknown) {
      const scope = await resolveGrant(authorization, destinationId)
      const destination = destinationById(scope.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That is not a publishing destination on this site.")
      }
      const current = await options.manifests.read(destination.manifestKey)
      return {
        entries: pageCatalogue(
          current?.body ?? null,
          destination.section,
          storeItemsFor(destination),
          // Where it actually is. A film on the Movies page is a few lines in
          // the website's own source, not a product anybody can open in the
          // admin portal, and sending the artist there would waste a trip.
          destination.section === "movies" ? "the site's code" : "the admin portal",
        ),
      }
    },
    async removePublished(authorization: string | undefined, destinationId: unknown, url: unknown) {
      if (typeof url !== "string") {
        throw new SiteManagerError(400, "invalid_request", "Name the file to remove.")
      }
      const scope = await resolveGrant(authorization, destinationId)
      const destination = destinationById(scope.destinationId)
      if (!destination) {
        throw new SiteManagerError(403, "destination_denied", "That is not a publishing destination on this site.")
      }
      const key = objectKeyFor(destination, url)
      if (!key) {
        throw new SiteManagerError(403, "destination_denied", "That file is not on this page.")
      }
      await commitRemoval(
        options.manifests,
        destination.manifestKey,
        { url, section: destination.section },
        new Date(now()).toISOString(),
      )
      if (options.deleteObject) {
        await options.deleteObject(key)
      }
      return { removed: true }
    },
    async list(identity: StudioIdentity) {
      await requireAdmin(identity)
      const grants = await options.store.listGrants()
      return grants.map((grant) => ({
        id: grant.id,
        destinationId: grant.destinationId,
        principalSub: grant.principalSub,
        label: labelOf(grant),
        version: grant.version,
        revoked: grant.revokedAt !== null,
        reconnectRequired: grant.reconnectRequired,
      }))
    },
  }
}
